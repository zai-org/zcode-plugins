/* Service worker: runs the task's steps one by one in a tab and keeps the progress in chrome.storage.local. */
importScripts("steps.js");

let running = false;
const taskP = fetch(chrome.runtime.getURL("task.json")).then((r) => r.json());
const msg = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settings(task) {
  const { settings: saved = {} } = await chrome.storage.local.get("settings");
  const out = {};
  for (const s of task.settings || []) out[s.key] = saved[s.key] ?? s.default ?? "";
  return out;
}
function fill(text, vars) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const builtin = { today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, now: `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}` };
  return String(text ?? "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : k in builtin ? builtin[k] : ""));
}
function render(step, vars) {
  const s = { ...step };
  for (const k of ["url", "value", "filename", "text"]) if (typeof s[k] === "string") s[k] = fill(s[k], vars);
  if (s.action === "open" && s.url) s.url = s.url.replace(/\{\{[^}]*\}\}/g, "");
  return s;
}
function waitLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { done(); reject(new Error(msg("errTimeoutLoad"))); }, timeoutMs);
    const onUpd = (id, info) => { if (id === tabId && info.status === "complete") { done(); resolve(); } };
    const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpd); };
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete" && t.url && t.url !== "about:blank") { done(); resolve(); } }).catch(() => undefined);
  });
}
async function settle(tabId, timeoutMs) {
  await sleep(350);
  const t = await chrome.tabs.get(tabId);
  if (t.status === "loading") await waitLoad(tabId, timeoutMs);
}
async function inPage(tabId, step, timeoutMs) {
  let res;
  try {
    [res] = await chrome.scripting.executeScript({ target: { tabId }, func: pageStep, args: [step, timeoutMs] });
  } catch (e) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (t?.url && !/^https?:/.test(t.url)) throw new Error(msg("errNotWebPage"));
    if (/cannot access|permission|host/i.test(String(e.message))) throw new Error(msg("errNoAccess", [t?.url ? new URL(t.url).host : "?"]));
    throw e;
  }
  const r = res?.result;
  if (!r) throw new Error(msg("errNoResult"));
  if (!r.ok) throw new Error(r.error);
  return r;
}
// Chrome hands results back with keys sorted, so the column order comes from the extract step's fields.
function toCsv(rows, order) {
  const cols = [...(order || [])];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
  return "\ufeff" + [cols.map(esc).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}
function dataUrl(text, type) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}
const ordered = (rows, order) => (order ? rows.map((r) => Object.fromEntries([...order.filter((k) => k in r).map((k) => [k, r[k]]), ...Object.entries(r).filter(([k]) => !order.includes(k))])) : rows);
async function saveData(name, rows, format, filename, order) {
  const json = format === "json";
  const id = await chrome.downloads.download({ url: dataUrl(json ? JSON.stringify(ordered(rows, order), null, 2) : toCsv(rows, order), json ? "application/json" : "text/csv"), filename: filename.replace(/^\/+/, "").replace(/\.\.+/g, "."), conflictAction: "uniquify", saveAs: false });
  return id;
}

async function run(startTabId) {
  if (running) return;
  running = true;
  const task = await taskP;
  const vars = await settings(task);
  const timeoutMs = Math.max(1000, Number(vars.__timeout) || task.timeoutMs || 15000);
  const state = { running: true, startedAt: Date.now(), step: 0, status: task.steps.map(() => "pending"), log: [], data: {}, columns: {}, downloads: [], error: null };
  const save = () => chrome.storage.local.set({ lastRun: state });
  const log = (line) => { state.log.push(line); save(); };
  let tabId = startTabId ?? null;
  try {
    const empty = (task.settings || []).filter((s) => s.required && !String(vars[s.key] ?? "").trim());
    if (empty.length) throw new Error(msg("errSettings", [empty.map((s) => s.label || s.key).join(", ")]));
    for (let i = 0; i < task.steps.length; i++) {
      const step = render(task.steps[i], vars);
      const t = step.timeoutMs || timeoutMs;
      state.step = i; state.status[i] = "running"; await save();
      if (step.action === "open") {
        if (tabId == null || step.newTab) tabId = (await chrome.tabs.create({ url: step.url, active: true })).id;
        else await chrome.tabs.update(tabId, { url: step.url });
        await waitLoad(tabId, t);
      } else {
        if (tabId == null) throw new Error(msg("errNoTab"));
        if (step.action === "click") { const r = await inPage(tabId, step, t); if (!r.skipped) await settle(tabId, t); }
        else if (step.action === "fill") { await inPage(tabId, step, t); if (step.submit) await settle(tabId, t); }
        else if (step.action === "wait") await inPage(tabId, step, t);
        else if (step.action === "extract") {
          const key = step.into || "rows";
          const rows = (state.data[key] = state.data[key] || []);
          state.columns[key] = [...new Set([...(state.columns[key] || []), ...Object.keys(step.fields || { text: 1 })])];
          const maxPages = step.next ? Math.max(1, step.maxPages || 5) : 1;
          for (let page = 1; page <= maxPages; page++) {
            const r = await inPage(tabId, step, t);
            rows.push(...r.rows);
            log(msg("logExtracted", [String(r.rows.length), String(page)]));
            if (step.limit && rows.length >= step.limit) { rows.length = step.limit; break; }
            if (page === maxPages) break;
            const nx = await inPage(tabId, { action: "click", selector: step.next, optional: true }, Math.min(t, 3000));
            if (nx.skipped) break;
            await settle(tabId, t);
          }
          await save();
        } else if (step.action === "download") {
          if (step.selector) {
            const r = await inPage(tabId, { action: "links", selector: step.selector }, t);
            const urls = [...new Set(r.urls)].slice(0, step.limit || 20);
            for (const url of urls) state.downloads.push({ id: await chrome.downloads.download({ url, conflictAction: "uniquify", saveAs: false, ...(step.filename && urls.length === 1 ? { filename: step.filename } : {}) }), name: url.split("/").pop() || url });
            log(msg("logLinks", [String(urls.length)]));
          } else {
            const key = step.from || "rows";
            const rows = state.data[key] || [];
            const format = step.format || "csv";
            const filename = step.filename || `${key}-${fill("{{now}}", {})}.${format}`;
            state.downloads.push({ id: await saveData(key, rows, format, filename, state.columns[key]), name: filename, rows: rows.length });
            log(msg("logSaved", [filename, String(rows.length)]));
          }
        }
      }
      state.status[i] = "done";
      await save();
    }
    log(msg("logDone"));
  } catch (e) {
    state.status[state.step] = "failed";
    state.error = `${msg("stepN", [String(state.step + 1)])}: ${e.message || e}`;
  } finally {
    state.running = false; state.finishedAt = Date.now();
    await save();
    running = false;
  }
}

chrome.runtime.onMessage.addListener((m, _sender, reply) => {
  if (m?.type === "run") { run(m.tabId); reply({ started: true }); }
  else if (m?.type === "redownload") {
    chrome.storage.local.get("lastRun").then(async ({ lastRun }) => {
      const rows = lastRun?.data?.[m.key] || [];
      await saveData(m.key, rows, m.format, `${m.key}-${fill("{{now}}", {})}.${m.format}`, lastRun?.columns?.[m.key]);
      reply({ ok: true });
    });
    return true;
  }
  return false;
});
