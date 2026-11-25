import { App } from "@modelcontextprotocol/ext-apps";
import { PLUGIN_VERSION, type CardMetrics } from "./metrics.js";

const isDetails = document.documentElement.dataset.presentation === "details";
const app = new App(
  { name: "Token statistics", version: PLUGIN_VERSION },
  { availableDisplayModes: isDetails ? ["fullscreen"] : ["inline"] },
);
let result: CardMetrics | undefined;
let failed = false;

function element(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function text(id: string, content: string): void {
  element(id).textContent = content;
}

function render(): void {
  const host = app.getHostContext();
  const isChinese = host?.locale?.toLowerCase().startsWith("zh") ?? false;
  const locale = isChinese ? "zh-CN" : "en-US";
  document.documentElement.lang = locale;
  if (host?.theme) document.documentElement.dataset.theme = host.theme;
  for (const [name, value] of Object.entries(host?.styles?.variables ?? {})) {
    if (name.startsWith("--") && typeof value === "string") {
      document.documentElement.style.setProperty(name, value);
    }
  }
  const count = new Intl.NumberFormat(locale);
  const rate = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const duration = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const latest = result?.latest;
  const context = result?.contextInput;

  text("title", isChinese ? "Token 统计" : "Token statistics");
  text("model", latest?.modelId ?? "");
  element("empty").hidden = Boolean(latest);
  text(
    "empty",
    failed
      ? isChinese
        ? "无法读取统计。"
        : "Statistics are unavailable."
      : result
        ? isChinese
          ? "此会话暂无可统计的生成指标。"
          : "No measured generation in this session yet."
        : isChinese
          ? "正在读取统计…"
          : "Waiting for statistics…",
  );

  element("generation").hidden = !latest;
  if (latest && result) {
    text("speed-label", isChinese ? "最近输出速度" : "Latest output speed");
    text("speed", `${rate.format(latest.outputTokensPerSecond)} tok/s`);
    text("output-label", isChinese ? "最近输出" : "Latest output");
    text("output", `${count.format(latest.outputTokens)} tok`);
    element("first-group").hidden = latest.timeToFirstTokenMs === undefined;
    if (latest.timeToFirstTokenMs !== undefined) {
      text("first-label", isChinese ? "首 Token 用时" : "Time to first token");
      text("first", `${duration.format(latest.timeToFirstTokenMs / 1000)} s`);
    }
    const requests = result.observedRequests;
    text(
      "total-label",
      isChinese
        ? `已观测 ${count.format(requests)} 次输出合计`
        : `Output across ${count.format(requests)} measured ${requests === 1 ? "request" : "requests"}`,
    );
    text("total", `${count.format(result.observedOutputTokens ?? 0)} tok`);
  }
  element("context").hidden = !result;
  text("context-label", isChinese ? "最近上下文输入" : "Latest context input");
  text(
    "context-input",
    context
      ? `${count.format(context.inputTokens)} tok`
      : isChinese
        ? "暂无实测数据"
        : "No measured data",
  );
  element("context-model-group").hidden = !context;
  text("context-model", context?.modelId ?? "");
}

app.ontoolresult = (message) => {
  failed = Boolean(message.isError);
  result = message.structuredContent as CardMetrics | undefined;
  render();
};
app.onhostcontextchanged = render;
app.ontoolcancelled = () => {
  failed = true;
  result = undefined;
  render();
};
void app
  .connect()
  .then(async () => {
    render();
    if (!isDetails) return;
    const message = await app.callServerTool({ name: "snapshot", arguments: {} });
    failed = Boolean(message.isError);
    result = message.structuredContent as CardMetrics | undefined;
    render();
  })
  .catch(() => {
    failed = true;
    render();
  });
