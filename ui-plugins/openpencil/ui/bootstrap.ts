import { getClient } from "#ui/client.ts";

(async () => {
  async function resource(name: string) {
    const r = await getClient().readResource("ui://openpencil/assets/" + name);
    if (!r.contents[0] || !("text" in r.contents[0]) || !r.contents[0].text)
      throw Error("Empty asset " + name);
    return r.contents[0].text;
  }
  const manifest = JSON.parse(await resource("assets.json"));
  const [css, ...parts] = await Promise.all([
    resource("panel.css"),
    ...manifest.scripts.map(resource),
  ]);
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  document.getElementById("root")!.removeAttribute("style");
  const script = document.createElement("script");
  script.type = "module";
  const readyEvent = "openpencil:module-ready";
  script.textContent = `${parts.join("")}\n;window.dispatchEvent(new Event("${readyEvent}"));`;
  // append 不等待模块求值；Yoga 顶层 await 或语法错误曾绕过外层 catch，让 Loading 永远保留。
  // 内联模块没有可靠的 load 事件，用模块末尾的完成事件撤销监听，避免误报后续编辑异常。
  await new Promise<void>((resolve, reject) => {
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    const fail = (error: unknown) => {
      listeners.abort();
      reject(error);
    };
    window.addEventListener(
      "error",
      (event) => fail(event.error ?? new Error(event.message)),
      options,
    );
    window.addEventListener("unhandledrejection", (event) => fail(event.reason), options);
    script.addEventListener(
      "error",
      () => fail(new Error("Editor module failed to load")),
      options,
    );
    window.addEventListener(
      readyEvent,
      () => {
        listeners.abort();
        resolve();
      },
      options,
    );
    document.body.append(script);
  });
})().catch((e) => {
  document.getElementById("root")!.textContent =
    "设计稿编辑器加载失败 / Failed to load: " + (e instanceof Error ? e.message : String(e));
});
