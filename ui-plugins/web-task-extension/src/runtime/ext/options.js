/* global t, el, zh, i18nPage, describe, taskReady */
const $ = (id) => document.getElementById(id);
(async () => {
  i18nPage();
  const task = await taskReady;
  document.title = `${task.name} – ${t("settings")}`;
  $("name").textContent = task.name;
  $("desc").textContent = task.description || "";
  const { settings: saved = {} } = await chrome.storage.local.get("settings");
  const fields = [...(task.settings || []), { key: "__timeout", label: t("timeoutLabel"), type: "number", default: String(task.timeoutMs || 15000), help: t("timeoutHelp") }];
  $("form").replaceChildren(...fields.map((s) => {
    const value = saved[s.key] ?? s.default ?? "";
    const input = s.type === "select"
      ? el("select", { name: s.key }, ...(s.options || []).map((o) => el("option", { value: o, text: o, selected: o === value })))
      : el("input", { name: s.key, type: s.type === "number" ? "number" : s.type === "date" ? "date" : "text", value, placeholder: s.placeholder || "", required: s.required });
    return el("label", {}, el("span", { text: (s.label || s.key) + (s.required ? " *" : "") }), input, s.help ? el("small", { class: "muted", text: s.help }) : null);
  }));
  $("save").onclick = async (e) => {
    e.preventDefault();
    const next = {};
    for (const f of $("form").elements) if (f.name) next[f.name] = f.value;
    await chrome.storage.local.set({ settings: next });
    $("saved").hidden = false;
    setTimeout(() => { $("saved").hidden = true; }, 2000);
  };
  $("steps").replaceChildren(...task.steps.map((s) => el("li", { text: s.note || describe(s) })));
  $("perms").replaceChildren(...(task.permissions || []).map((p) => el("tr", {}, el("td", {}, el("code", { text: p.name })), el("td", { text: zh ? p.zh : p.en }))));
})();
