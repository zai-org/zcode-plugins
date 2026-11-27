import css from "./kit.css";
import appCss from "./app.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, openLink, put, toast } from "./kit.ts";

type L = [string, string];
const t = (zh: string, en: string) => (locale() === "zh" ? zh : en);
const T = ([zh, en]: L) => t(zh, en);

type WorkflowCard = {
  id: string;
  url: string;
  titleZh: string;
  titleEn: string;
  hintZh: string;
  hintEn: string;
};

const WORKFLOWS: WorkflowCard[] = [
  { id: "white", url: "https://whitebackground.app/make-background-white", titleZh: "做成白底图", titleEn: "White background", hintZh: "在编辑器里选一张照片，检查边缘后下载白底 JPG 或 PNG。免费导出最长边 2200 px，不放大主体。", hintEn: "Choose a photo in the editor, check the edges, then download a white JPG or PNG. Free exports are capped at 2200 px and do not enlarge the subject." },
  { id: "transparent", url: "https://whitebackground.app/transparent-background-maker", titleZh: "透明 PNG 抠图", titleEn: "Transparent PNG", hintZh: "在编辑器里选照片，检查轮廓后下载透明 PNG。JPG 不能保存透明。", hintEn: "Choose a photo in the editor, inspect the cutout, then download a transparent PNG. JPG cannot store transparency." },
  { id: "png_to_white", url: "https://whitebackground.app/add-white-background-to-png", titleZh: "透明 PNG 铺到白底", titleEn: "PNG onto white", hintZh: "选择已有的透明 PNG，沿用现成抠图铺到白底，不再做一次去背。", hintEn: "Choose an existing transparent PNG. Its cutout is composed on white without another removal pass." },
  { id: "square", url: "https://whitebackground.app/make-image-square", titleZh: "做成不裁切的正方形", titleEn: "Square without cropping", hintZh: "选图前先取消勾选去背，即可保留整张原图并加白边。主体占比默认 85%，可在 70%–95% 调整。", hintEn: "Leave background removal unchecked before choosing the photo to keep the whole scene and add white padding. Subject fill defaults to 85% and can be set from 70% to 95%." },
  { id: "shopify", url: "https://whitebackground.app/shopify-image-resizer", titleZh: "Shopify 商品图尺寸", titleEn: "Shopify sizing", hintZh: "使用 2048 px 预设或自定义画布，下载前核对实际导出尺寸。", hintEn: "Use the 2048 px preset or a custom canvas, and check the actual export dimensions before downloading." },
  { id: "enhance", url: "https://whitebackground.app/product-photo-enhancer", titleZh: "本地放大商品图", titleEn: "Local enlargement", hintZh: "比较普通放大与 AI 放大。保护文字和 logo。2× 输出最长边最多 2200 px，4× 最多 4096 px；AI 可能改变细节。", hintEn: "Compare standard and AI enlargement. Protect lettering and logos. 2× outputs up to 2200 px, 4× up to 4096 px; AI may change fine details." },
];

const PRESETS = [
  { w: 1024, h: 1024, label: "1024" },
  { w: 2048, h: 2048, label: "2048" },
  { w: 4096, h: 4096, label: "4096" },
  { w: 1600, h: 1200, label: "1600×1200" },
];

const PRICING = "https://whitebackground.app/pricing";

type CanvasResult = {
  path?: string;
  width?: number;
  height?: number;
  previewDataUrl?: string;
  downloadUrl?: string;
};
type EditorResult = { workflow?: string; url?: string };

const state: { canvas: CanvasResult | null; editor: EditorResult | null; busy: boolean } = {
  canvas: null,
  editor: null,
  busy: false,
};

async function safeOpen(url: string) {
  try {
    await openLink(url);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}

export function startApp(name: string, version: string) {
  const style = document.createElement("style");
  style.textContent = css + appCss;
  document.head.append(style);
  const root = document.getElementById("root") ?? document.body.appendChild(h("div", { id: "root" }));

  async function run<T extends Record<string, unknown>>(tool: string, args: Record<string, unknown>): Promise<T | undefined> {
    if (state.busy) return;
    state.busy = true;
    render();
    try {
      const result = await call<T>(tool, args);
      applyResult(tool, result);
      return result;
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      state.busy = false;
      render();
    }
  }

  function applyResult(tool: string | undefined, value: Record<string, unknown> | undefined) {
    if (!value || value.error) return;
    if (tool === "canvas_create" || value.previewDataUrl || value.path) {
      state.canvas = {
        path: String(value.path ?? ""),
        width: Number(value.width),
        height: Number(value.height),
        previewDataUrl: typeof value.previewDataUrl === "string" ? value.previewDataUrl : undefined,
        downloadUrl: typeof value.downloadUrl === "string" ? value.downloadUrl : undefined,
      };
    }
    if (tool === "editor_open" || value.workflow && value.url) {
      state.editor = { workflow: String(value.workflow ?? ""), url: String(value.url ?? "") };
    }
  }

  function createCanvas() {
    const width = Number((document.getElementById("width") as HTMLInputElement | null)?.value);
    const height = Number((document.getElementById("height") as HTMLInputElement | null)?.value);
    return run("canvas_create", { width, height });
  }

  function setSize(width: number, height: number) {
    const w = document.getElementById("width") as HTMLInputElement | null;
    const hEl = document.getElementById("height") as HTMLInputElement | null;
    if (w) w.value = String(width);
    if (hEl) hEl.value = String(height);
  }

  function render() {
    const title = t("白底图", "WhiteBackground");
    put(
      root,
      h("div", { class: state.busy ? "busy" : undefined },
        h("div", { class: "hero" },
          h("h1", {}, title),
          h("span", { id: "status", class: "muted" }, state.busy ? t("处理中…", "Working…") : ""),
          h("p", {}, t(
            "生成纯白 PNG 画布，或打开 WhiteBackground 官方本机编辑器处理商品照。免费路径不会上传照片，也不会消耗积分。",
            "Create a pure white PNG, or open WhiteBackground’s official local editor for a product photo. The free path never uploads a photo and never spends credits.",
          )),
        ),
        h("h2", {}, t("纯白画布", "Blank white canvas")),
        h("div", { class: "row size-row" },
          h("label", {}, t("宽", "Width"), h("input", { id: "width", type: "number", min: 1, max: 8192, value: state.canvas?.width || 2048 })),
          h("label", {}, t("高", "Height"), h("input", { id: "height", type: "number", min: 1, max: 8192, value: state.canvas?.height || 2048 })),
          h("button", { class: "primary", id: "create", disabled: state.busy, onclick: () => { void createCanvas(); } }, t("生成并保存", "Create and save")),
        ),
        h("div", { class: "presets" },
          ...PRESETS.map((p) => h("button", { type: "button", onclick: () => setSize(p.w, p.h) }, p.label)),
        ),
        h("p", { class: "muted" }, t("每边 1–8192 px，总像素不超过 3200 万。结果保存到工作区，已有文件不会被覆盖。", "Each side 1–8192 px, at most 32 million pixels. Saved in the workspace; existing files are not overwritten.")),
        h("div", { class: "preview", id: "preview" },
          state.canvas?.previewDataUrl
            ? h("img", { alt: t("纯白画布预览", "White canvas preview"), src: state.canvas.previewDataUrl })
            : h("div", { class: "empty" }, t("还没有画布。填好尺寸后点生成。", "No canvas yet. Set a size and create one.")),
        ),
        state.canvas?.path
          ? h("p", { class: "path", id: "saved-path" }, t("已保存：", "Saved: ") + state.canvas.path)
          : null,
        state.canvas?.downloadUrl
          ? h("p", {}, h("button", { class: "link", onclick: () => { void safeOpen(state.canvas!.downloadUrl!); } }, t("打开官方下载链接", "Open official download link")))
          : null,
        h("h2", {}, t("本机照片编辑器", "Local photo editors")),
        h("p", { class: "muted" }, t(
          "在官方编辑器里由你选择照片、预览并下载。本插件不能读取聊天附件或工作区图片。",
          "You choose the photo, preview, and download in the official editor. This plugin cannot read chat attachments or workspace images.",
        )),
        h("div", { class: "workflows" },
          ...WORKFLOWS.map((flow) => {
            const open = state.editor?.workflow === flow.id;
            return h("div", { class: "wf", "data-workflow": flow.id },
              h("h3", {}, t(flow.titleZh, flow.titleEn)),
              h("p", {}, t(flow.hintZh, flow.hintEn)),
              h("div", { class: "row" },
                h("button", { type: "button", class: "primary", "data-open": flow.id, disabled: state.busy, onclick: () => { void run("editor_open", { workflow: flow.id }); } }, t("打开编辑器", "Open editor")),
              ),
              open && state.editor?.url
                ? h("p", { class: "url" },
                    h("button", { class: "link", "data-link": state.editor.url, onclick: () => { void safeOpen(state.editor!.url!); } }, t("在浏览器中打开：", "Open in browser: ") + state.editor.url),
                  )
                : null,
            );
          }),
        ),
        h("div", { class: "foot" },
          h("p", {}, t(
            "单张本机处理免费、无需账号或 API 密钥。批量、4K 导出或高质量云端处理请查看定价页；本插件不会代为购买或自动扣费。",
            "Single-photo local editing is free and needs no account or API key. For batch work, 4K export, or high-quality cloud processing, see the pricing page. This plugin never buys a plan or spends credits for you.",
          )),
          h("p", {},
            h("button", { class: "link", id: "pricing", onclick: () => { void safeOpen(PRICING); } }, t("查看定价", "View pricing")),
            " · ",
            t("这与「电商商品图助手」不同：那个插件只在本地去掉纯色棚拍背景并批量套尺寸；复杂背景请用这里的官方编辑器。", "This is not Product Photo Studio, which only removes plain studio backdrops locally and batch-exports sizes. Use this official editor for complex backgrounds."),
          ),
        ),
      ),
    );
  }

  onToolResult((value) => {
    applyResult(undefined, value);
    render();
  });
  onHostContext(() => {
    applyTheme();
    render();
  });
  applyTheme();
  render();
  initHost(name, version).then(() => {
    applyTheme();
    render();
  }).catch((error) => toast(String(error?.message ?? error), "error"));
}
