/* global t, el, i18nPage, describe, taskReady */
const $ = (id) => document.getElementById(id);
let task;

async function needSettings() {
  const { settings: saved = {} } = await chrome.storage.local.get("settings");
  return (task.settings || []).filter((s) => s.required && !String(saved[s.key] ?? s.default ?? "").trim());
}
function show(run) {
  const items = $("steps").children;
  task.steps.forEach((_, i) => { items[i].className = run?.status?.[i] || "pending"; });
  $("run").disabled = !!run?.running;
  $("run").textContent = run?.running ? t("running") : t("run");
  $("err").hidden = !run?.error;
  $("err").textContent = run?.error || "";
  const sets = Object.entries(run?.data || {});
  $("result").hidden = !sets.length && !run?.downloads?.length;
  $("sets").replaceChildren(...sets.map(([key, rows]) => {
    const cols = [...new Set([...(run.columns?.[key] || []), ...rows.slice(0, 50).flatMap((r) => Object.keys(r))])];
    const table = el("table", {}, el("tr", {}, ...cols.map((c) => el("th", { text: c }))), ...rows.slice(0, 5).map((r) => el("tr", {}, ...cols.map((c) => el("td", { text: r[c] ?? "", title: r[c] ?? "" })))));
    const canDl = !!chrome.downloads;
    return el("div", { class: "set", "data-key": key },
      el("div", { class: "row" }, el("b", { text: t("rowsIn", [String(rows.length), key]) }),
        canDl ? el("button", { class: "small dl", "data-format": "csv" }, "CSV") : null,
        canDl ? el("button", { class: "small dl", "data-format": "json" }, "JSON") : null),
      el("div", { class: "scroll" }, table));
  }), ...(run?.downloads || []).map((d) => el("div", { class: "muted dlrow", text: `↓ ${d.name}${d.rows != null ? ` (${d.rows})` : ""}` })));
  for (const b of $("sets").querySelectorAll("button.dl")) b.onclick = () => chrome.runtime.sendMessage({ type: "redownload", key: b.closest(".set").dataset.key, format: b.dataset.format });
  $("when").textContent = run?.finishedAt ? t("lastRun", [new Date(run.finishedAt).toLocaleString()]) : "";
}

(async () => {
  i18nPage();
  task = await taskReady;
  document.title = task.name;
  $("name").textContent = task.name;
  $("desc").textContent = task.description || "";
  $("steps").replaceChildren(...task.steps.map((s) => el("li", { text: s.note || describe(s) })));
  const missing = await needSettings();
  if (missing.length) { $("need").hidden = false; $("need").textContent = t("needSettings", [missing.map((s) => s.label || s.key).join(", ")]); }
  $("opts").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
  $("run").onclick = async () => {
    if ((await needSettings()).length) { chrome.runtime.openOptionsPage(); return; }
    const [tab] = task.steps[0]?.action === "open" ? [] : await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.runtime.sendMessage({ type: "run", tabId: tab?.id });
  };
  const { lastRun } = await chrome.storage.local.get("lastRun");
  show(lastRun);
  chrome.storage.onChanged.addListener((c) => { if (c.lastRun) show(c.lastRun.newValue); });
})();
