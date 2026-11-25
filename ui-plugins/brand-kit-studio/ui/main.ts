import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, sendMessage, toast } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

type Layout = "hero" | "split" | "minimal";
interface Brand { name: string; tagline: string; colors: { primary: string; secondary: string; background: string; text: string }; logoTone: "auto" | "original" | "white" | "dark" }
interface AssetOptions { enabled?: boolean; layout?: Layout; title?: string; subtitle?: string }
interface Project { version: 1; brand: Brand; logo?: string; mark?: string; assets: Record<string, AssetOptions>; outputDir: string }
interface AssetDef { id: string; label: string; label_zh: string; group: "icon" | "social" | "cover"; width: number; height: number; layout?: Layout; file: string }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);

const state: {
  project?: Project;
  projectPath: string;
  assets: AssetDef[];
  previews: Map<string, { src: string; warnings: string[] }>;
  selected?: string;
  images: string[];
  result?: { files: string[]; warnings: string[]; outputDir: string };
} = { projectPath: "brand.brandkit.json", assets: [], previews: new Map(), images: [] };

const root = document.getElementById("root")!;

async function busy<T>(work: () => Promise<T>): Promise<T | undefined> {
  root.classList.add("busy");
  try {
    return await work();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
    return undefined;
  } finally {
    root.classList.remove("busy");
  }
}

function load(value: Record<string, unknown>) {
  state.project = value.project as Project;
  state.assets = (value.assets as AssetDef[]) ?? state.assets;
  if (typeof value.projectPath === "string") state.projectPath = value.projectPath;
  state.previews.clear();
  state.selected ??= "og-image";
  state.result = undefined;
  render();
  void refreshAll();
}

// ---------------------------------------------------------------- 预览

let generation = 0;
async function refreshAll() {
  const token = ++generation;
  for (const def of state.assets) {
    if (token !== generation) return;
    await refreshOne(def.id);
  }
  if (token === generation && state.selected) await refreshOne(state.selected, true);
}

async function refreshOne(id: string, large = false) {
  if (!state.project) return;
  try {
    const result = await call<{ image: string; mime: string; warnings: string[] }>("brand_preview", { project: state.project, asset: id, width: large ? 900 : 340 });
    const src = `data:${result.mime};base64,${result.image}`;
    if (large) {
      const img = document.getElementById("large") as HTMLImageElement | null;
      if (img) img.src = src;
      renderWarnings(result.warnings);
    } else {
      state.previews.set(id, { src, warnings: result.warnings });
      document.querySelector(`.thumb[data-id="${id}"]`)?.replaceWith(thumb(state.assets.find((a) => a.id === id)!));
    }
  } catch (error) {
    if (large) toast(error instanceof Error ? error.message : String(error), "error");
  }
}

function renderWarnings(warnings: string[]) {
  const box = document.getElementById("warnings");
  if (!box) return;
  box.replaceChildren(...(warnings.length ? warnings.map((w) => h("div", { class: "badge bad" }, w.replace(/^[\w-]+: /, ""))) : [h("span", { class: "badge ok" }, T("排版正常", "Layout fits"))]));
}

let debounce: ReturnType<typeof setTimeout> | undefined;
function changed(scope: "all" | "one") {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (scope === "all") void refreshAll();
    else if (state.selected) {
      void refreshOne(state.selected);
      void refreshOne(state.selected, true);
    }
  }, 300);
}

// ---------------------------------------------------------------- 界面

function render() {
  applyTheme();
  root.replaceChildren(state.project ? editor() : start());
}

function imageSelect(value: string | undefined, onChange: (v: string | undefined) => void) {
  const options = [...new Set([...(value ? [value] : []), ...state.images])];
  return h("select", { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value || undefined) },
    h("option", { value: "" }, T("（无）", "(none)")),
    ...options.map((file) => h("option", { value: file, selected: file === value }, file)));
}

async function loadImages() {
  if (state.images.length) return;
  const result = await call<{ files: string[] }>("workspace_images").catch(() => ({ files: [] as string[] }));
  state.images = result.files;
  render();
}

function start() {
  const draft: { name: string; tagline: string; logo?: string; mark?: string } = { name: "", tagline: "" };
  void loadImages();
  return h("div", {},
    h("h1", {}, T("品牌素材套装", "Brand Kit Studio")),
    h("p", { class: "muted" }, T("输入品牌名、标语和 logo，一次生成网站图标、App 图标、社媒头像、分享图和各平台横幅，风格统一。", "Enter a brand name, tagline and logo to generate favicons, app icons, avatars, share images and platform banners in one consistent style.")),
    h("div", { class: "card controls" },
      h("label", {}, T("品牌名", "Brand name"), h("input", { type: "text", oninput: (e: Event) => (draft.name = (e.target as HTMLInputElement).value) })),
      h("label", {}, T("标语", "Tagline"), h("input", { type: "text", oninput: (e: Event) => (draft.tagline = (e.target as HTMLInputElement).value) })),
      h("label", { class: "pick" }, "Logo", imageSelect(undefined, (v) => (draft.logo = v))),
      h("label", { class: "pick" }, T("方形标志（可选）", "Square mark (optional)"), imageSelect(undefined, (v) => (draft.mark = v))),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => (draft.name || draft.logo) && open(draft) }, T("生成素材", "Generate"))),
    ),
  );
}

async function open(args: Record<string, unknown>) {
  const result = await busy(() => call<Record<string, unknown>>("brand_open", args, 300_000));
  if (result) load(result);
}


function brandControls(project: Project) {
  const b = project.brand;
  const color = (key: keyof Brand["colors"], label: string) =>
    h("label", {}, h("input", { type: "color", value: b.colors[key], oninput: (e: Event) => { b.colors[key] = (e.target as HTMLInputElement).value; changed("all"); } }), label);
  return h("div", { class: "controls" },
    h("label", {}, T("品牌名", "Name"), h("input", { type: "text", value: b.name, oninput: (e: Event) => { b.name = (e.target as HTMLInputElement).value; changed("all"); } })),
    h("label", {}, T("标语", "Tagline"), h("input", { type: "text", value: b.tagline, oninput: (e: Event) => { b.tagline = (e.target as HTMLInputElement).value; changed("all"); } })),
    h("label", { class: "pick" }, "Logo", imageSelect(project.logo, (v) => { project.logo = v; changed("all"); })),
    h("label", { class: "pick" }, T("方形标志", "Mark"), imageSelect(project.mark, (v) => { project.mark = v; changed("all"); })),
    h("div", { class: "colors" }, color("primary", T("主色", "Primary")), color("secondary", T("辅色", "Secondary")), color("background", T("背景", "Background")), color("text", T("文字", "Text"))),
    h("label", {}, T("Logo 颜色", "Logo colour"), h("select", { onchange: (e: Event) => { b.logoTone = (e.target as HTMLSelectElement).value as Brand["logoTone"]; changed("all"); } },
      ...([["auto", T("自动", "Auto")], ["original", T("原色", "Original")], ["white", T("白色", "White")], ["dark", T("深色", "Dark")]] as const).map(([v, l]) => h("option", { value: v, selected: b.logoTone === v }, l)))),
  );
}

function thumb(def: AssetDef) {
  const preview = state.previews.get(def.id);
  const off = state.project?.assets[def.id]?.enabled === false;
  const card = h("div", { class: `thumb ${def.id === state.selected ? "selected" : ""} ${off ? "off" : ""} ${preview?.warnings.length ? "warn" : ""}`, onclick: () => select(def.id) },
    preview ? h("img", { src: preview.src, alt: def.label }) : h("div", { class: "placeholder" }, "…"),
    h("div", { class: "cap" }, h("input", { type: "checkbox", checked: !off, onclick: (e: Event) => e.stopPropagation(), onchange: (e: Event) => {
      state.project!.assets[def.id] = { ...state.project!.assets[def.id], enabled: (e.target as HTMLInputElement).checked };
      card.classList.toggle("off", !(e.target as HTMLInputElement).checked);
    } }), ` ${locale() === "zh" ? def.label_zh : def.label}`),
    preview?.warnings.length ? h("span", { class: "flag", title: preview.warnings.join("\n") }, "!") : null,
  );
  card.dataset.id = def.id;
  return card;
}

function select(id: string) {
  state.selected = id;
  render();
  void refreshOne(id, true);
}

function editor() {
  const project = state.project!;
  void loadImages();
  const def = state.assets.find((a) => a.id === state.selected);
  const options = def ? (project.assets[def.id] ??= {}) : undefined;
  const groups: [AssetDef["group"], string][] = [["icon", T("图标", "Icons")], ["social", T("社交媒体", "Social")], ["cover", T("横幅 / 封面", "Banners & covers")]];
  return h("div", {},
    h("div", { class: "toolbar" },
      h("strong", {}, project.brand.name || T("品牌素材", "Brand kit")),
      h("span", { class: "spacer" }),
      h("label", {}, T("输出到", "Output"), h("input", { value: project.outputDir, size: 14, oninput: (e: Event) => (project.outputDir = (e.target as HTMLInputElement).value) })),
      h("input", { value: state.projectPath, size: 22, title: T("项目文件", "Project file"), oninput: (e: Event) => (state.projectPath = (e.target as HTMLInputElement).value) }),
      h("button", { onclick: save }, T("保存项目", "Save project")),
      h("button", { class: "primary", onclick: exportAll }, T("导出全部", "Export all")),
    ),
    h("div", { class: "layout" },
      h("div", { class: "side" }, h("div", { class: "card" }, h("h2", {}, T("品牌", "Brand")), brandControls(project))),
      h("div", { class: "main" },
        def && options ? h("div", { class: "card detail" },
          h("div", { class: "detail-img" }, h("img", { id: "large", alt: def.label })),
          h("div", { class: "controls" },
            h("h2", {}, `${locale() === "zh" ? def.label_zh : def.label}`),
            h("div", { class: "muted small" }, `${def.width}×${def.height} → ${project.outputDir}/${def.file}`),
            h("div", { id: "warnings", class: "row" }),
            def.group === "icon" || def.id === "avatar" ? h("div", { class: "muted small" }, T("图标使用方形标志；没有时用 logo 或品牌名首字。", "Icons use the square mark, else the logo or the first letter of the name.")) : h("div", { class: "controls" },
              h("label", {}, T("版式", "Layout"), h("select", { onchange: (e: Event) => { options.layout = (e.target as HTMLSelectElement).value as Layout; changed("one"); } },
                ...([["hero", T("居中渐变", "Centered gradient")], ["split", T("左文右标", "Text + logo panel")], ["minimal", T("简洁留白", "Minimal")]] as const).map(([v, l]) => h("option", { value: v, selected: (options.layout ?? def.layout ?? "hero") === v }, l)))),
              h("label", {}, T("标题", "Title"), h("input", { type: "text", value: options.title ?? "", placeholder: project.brand.name, oninput: (e: Event) => { const v = (e.target as HTMLInputElement).value; options.title = v || undefined; changed("one"); } })),
              h("label", {}, T("副标题", "Subtitle"), h("input", { type: "text", value: options.subtitle ?? "", placeholder: project.brand.tagline, oninput: (e: Event) => { const v = (e.target as HTMLInputElement).value; options.subtitle = v || undefined; changed("one"); } })),
            ),
            h("div", { class: "row" }, h("button", { onclick: () => exportSome([def.id]) }, T("只导出这一个", "Export this one"))),
          ),
        ) : null,
        ...groups.flatMap(([group, label]) => [h("div", { class: "group" }, label), h("div", { class: "grid" }, ...state.assets.filter((a) => a.group === group).map(thumb))]),
        state.result ? h("div", { class: "card" },
          h("h2", {}, T(`已导出 ${state.result.files.length} 个文件到 ${state.result.outputDir}/`, `Exported ${state.result.files.length} files to ${state.result.outputDir}/`)),
          h("div", { class: "muted small" }, T("打开 index.html 查看全部素材；favicon/head-snippet.html 是网页 <head> 代码。", "Open index.html for an overview; favicon/head-snippet.html has the <head> tags.")),
          ...state.result.warnings.map((w) => h("div", { class: "muted small" }, w)),
          h("button", { onclick: () => sendMessage(T(`品牌素材已导出到 ${state.result!.outputDir}/，请帮我把 favicon/head-snippet.html 里的标签加到网站的 <head> 里，并把图标文件放到网站根目录。`, `The brand kit is in ${state.result!.outputDir}/. Please add the tags from favicon/head-snippet.html to the site's <head> and put the icon files at the web root.`)) }, T("让 Agent 接入网站", "Ask the agent to wire it into the site")),
        ) : null,
      ),
    ),
  );
}

async function save() {
  const result = await busy(() => call<{ path: string }>("project_save", { path: state.projectPath, project: state.project }));
  if (result) {
    state.projectPath = result.path;
    toast(T(`已保存 ${result.path}`, `Saved ${result.path}`));
  }
}

async function exportAll() {
  const result = await busy(() => call<{ files: string[]; warnings: string[]; outputDir: string }>("brand_export", { project: state.project }, 600_000));
  if (result) {
    state.result = result;
    render();
    if (state.selected) void refreshOne(state.selected, true);
    toast(T(`已导出 ${result.files.length} 个文件`, `Exported ${result.files.length} files`));
  }
}

async function exportSome(ids: string[]) {
  const result = await busy(() => call<{ files: string[] }>("brand_export", { project: state.project, assets: ids }));
  if (result) toast(T(`已导出：${result.files.filter((f) => !/brand\.json|index\.html|templates\//.test(f)).join("、")}`, `Exported: ${result.files.join(", ")}`));
}

onToolResult((value) => {
  if (!value || value.error) return;
  if (value.kind === "project") load(value);
  else if (value.kind === "exported" && state.project) {
    state.result = value as never;
    render();
  } else if (value.kind === "saved" && state.project) state.projectPath = value.path as string;
});
onHostContext(() => applyTheme());
render();
void initHost("brand-kit-studio", "0.1.0").then(() => render());
