/* Runs one step inside the page. Injected with chrome.scripting.executeScript, so it must stay self-contained. */
async function pageStep(step, timeoutMs) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const find = (sel, text) => {
    const all = Array.from(document.querySelectorAll(sel));
    if (text) { const t = String(text).trim().toLowerCase(); return all.find((e) => (e.textContent || e.value || "").trim().toLowerCase().includes(t)) || null; }
    return all.find(visible) || all[0] || null;
  };
  const waitFor = async (sel, text, gone) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const el = find(sel, text);
      if (gone ? !el : el) return el || true;
      if (Date.now() > end) return null;
      await sleep(150);
    }
  };
  const read = (row, spec) => {
    spec = String(spec || "").trim();
    let sel = spec, attr = "";
    const at = spec.lastIndexOf("@");
    if (at >= 0 && !/[\]"']/.test(spec.slice(at))) { sel = spec.slice(0, at).trim(); attr = spec.slice(at + 1).trim(); }
    const el = !sel || sel === "." ? row : row.querySelector(sel);
    if (!el) return "";
    if (!attr) return (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
    if ((attr === "href" || attr === "src") && el[attr]) return String(el[attr]);
    return el.getAttribute(attr) ?? "";
  };
  const missing = (what) => (step.optional ? { ok: true, skipped: true } : { ok: false, error: `No element matches ${what} (waited ${Math.round(timeoutMs / 1000)} s)` });
  try {
    switch (step.action) {
      case "click": {
        const el = await waitFor(step.selector, step.text);
        if (!el) return missing(step.selector + (step.text ? ` containing "${step.text}"` : ""));
        el.scrollIntoView({ block: "center" });
        el.click();
        return { ok: true };
      }
      case "fill": {
        const el = await waitFor(step.selector);
        if (!el) return missing(step.selector);
        const v = String(step.value ?? "");
        el.focus();
        if (el.tagName === "SELECT") {
          const opt = Array.from(el.options).find((o) => o.value === v) || Array.from(el.options).find((o) => o.text.trim().toLowerCase() === v.trim().toLowerCase());
          if (!opt) return { ok: false, error: `${step.selector} has no option "${v}"` };
          el.value = opt.value;
        } else if (el.type === "checkbox" || el.type === "radio") {
          el.checked = /^(true|1|yes|on|checked)$/i.test(v);
        } else {
          const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) setter.call(el, v); else if (el.isContentEditable) el.textContent = v; else el.value = v;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        if (step.submit) { const form = el.form || el.closest("form"); if (form) form.requestSubmit ? form.requestSubmit() : form.submit(); else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
        return { ok: true };
      }
      case "wait": {
        if (!step.selector) { await sleep(step.ms || 1000); return { ok: true }; }
        const el = await waitFor(step.selector, step.text, !!step.gone);
        if (!el) return missing(step.selector + (step.gone ? " to disappear" : ""));
        if (step.ms) await sleep(step.ms);
        return { ok: true };
      }
      case "extract": {
        const el = await waitFor(step.selector);
        if (!el) return step.optional ? { ok: true, rows: [] } : missing(step.selector);
        const rows = Array.from(document.querySelectorAll(step.selector)).map((row) => {
          if (!step.fields) return { text: read(row, "") };
          const rec = {};
          for (const [k, spec] of Object.entries(step.fields)) rec[k] = read(row, spec);
          return rec;
        });
        return { ok: true, rows, url: location.href };
      }
      case "links": {
        const el = await waitFor(step.selector);
        if (!el) return missing(step.selector);
        const urls = Array.from(document.querySelectorAll(step.selector)).map((e) => e.href || e.src || e.getAttribute("data-href") || "").filter(Boolean);
        return { ok: true, urls };
      }
      default:
        return { ok: false, error: `Unknown step ${step.action}` };
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
