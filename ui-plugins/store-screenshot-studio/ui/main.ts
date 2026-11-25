import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, sendMessage, toast } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Theme { background: string; background2?: string; textColor: string; frame: "auto" | "iphone" | "android" | "none"; frameColor: string; textPosition: "top" | "bottom"; deviceScale: number; bleed: boolean; titleScale: number }
interface Slide { image: string; tabletImage?: string; text: Record<string, { title?: string; subtitle?: string }>; background?: string; background2?: string }
interface Project { version: 1; locales: string[]; slides: Slide[]; theme: Theme; presets: string[]; outputDir: string }
interface Preset { id: string; label: string; width: number; height: number; device: string; store: string }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);

const state: {
  project?: Project;
  projectPath: string;
  presets: Preset[];
  previews: Map<number, { src: string; warnings: string[] }>;
  selected: number;
  locale: string;
  preset: string;
  images: string[];
  result?: { files: string[]; problems: string[]; outputDir: string };
} = { projectPath: "listing.storeshots.json", presets: [], previews: new Map(), selected: 0, locale: "", preset: "", images: [] };

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
  state.presets = (value.presets as Preset[]) ?? state.presets;
  if (typeof value.projectPath === "string") state.projectPath = value.projectPath;
  if (!state.project.locales.includes(state.locale)) state.locale = state.project.locales[0];
  if (!state.project.presets.includes(state.preset)) state.preset = state.project.presets[0];
  state.selected = Math.min(state.selected, Math.max(0, state.project.slides.length - 1));
  state.previews.clear();
  state.result = undefined;
  render();
  void refreshAll();
}

let generation = 0;
async function refreshAll() {
  const token = ++generation;
  const count = state.project?.slides.length ?? 0;
  for (let i = 0; i < count; i++) {
    if (token !== generation) return;
    await refreshOne(i);
  }
  if (token === generation) await refreshOne(state.selected, true);
}

async function refreshOne(index: number, large = false) {
  const project = state.project;
  if (!project?.slides[index]) return;
  try {
    const result = await call<{ image: string; mime: string; warnings: string[] }>("shots_preview", { project, index, preset: state.preset, locale: state.locale, width: large ? 600 : 300 });
    const src = `data:${result.mime};base64,${result.image}`;
    if (large) {
      const img = document.getElementById("large") as HTMLImageElement | null;
      if (img) img.src = src;
      const box = document.getElementById("warnings");
      box?.replaceChildren(...(result.warnings.length ? result.warnings.map((w) => h("div", { class: "badge bad" }, w)) : [h("span", { class: "badge ok" }, T("没问题", "Looks good"))]));
    } else {
      state.previews.set(index, { src, warnings: result.warnings });
      document.querySelector(`.thumb[data-index="${index}"]`)?.replaceWith(thumb(index));
    }
  } catch (error) {
    if (large) toast(error instanceof Error ? error.message : String(error), "error");
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
function changed(scope: "all" | "one") {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (scope === "all") void refreshAll();
    else {
      void refreshOne(state.selected);
      void refreshOne(state.selected, true);
    }
  }, 350);
}

function render() {
  applyTheme();
  root.replaceChildren(state.project ? editor() : picker());
}

async function loadImages() {
  if (state.images.length) return;
  const result = await call<{ files: string[] }>("workspace_images").catch(() => ({ files: [] as string[] }));
  state.images = result.files;
  if (result.files.length) render();
}

function picker() {
  void loadImages();
  const chosen: string[] = [];
  return h("div", {},
    h("h1", {}, T("应用商店截图制作", "Store Screenshot Studio")),
    h("p", { class: "muted" }, T("把 App 原始截图做成 App Store / Google Play 的宣传图：加标题、设备边框和背景，多语言、多尺寸一键导出。", "Turn raw app screenshots into App Store / Google Play listing images with headlines, device frames and backgrounds — many languages and sizes at once.")),
    h("div", { class: "card" },
      h("div", { class: "pick-list" }, ...(state.images.length
        ? state.images.map((file) => h("label", {}, h("input", { type: "checkbox", onchange: (e: Event) => { const on = (e.target as HTMLInputElement).checked; if (on) chosen.push(file); else chosen.splice(chosen.indexOf(file), 1); } }), file))
        : [h("div", { class: "empty" }, T("工作区里还没有截图（PNG/JPG）", "No PNG/JPG screenshots in the workspace yet"))])),
      h("div", { class: "row" }, h("span", { class: "muted small" }, T("按勾选顺序排列", "Slides follow the order you tick")), h("button", { class: "primary", onclick: () => chosen.length && open({ paths: chosen }) }, T("开始制作", "Start"))),
    ),
  );
}

async function open(args: Record<string, unknown>) {
  const result = await busy(() => call<Record<string, unknown>>("shots_open", args, 300_000));
  if (result) load(result);
}

function slider(label: string, value: number, min: number, max: number, step: number, format: (v: number) => string, onInput: (v: number) => void) {
  const out = h("span", { class: "value" }, format(value));
  return h("label", { class: "slider" }, h("span", {}, label),
    h("input", { type: "range", min, max, step, value, oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); out.textContent = format(v); onInput(v); } }), out);
}

function themeControls(theme: Theme) {
  const set = (patch: Partial<Theme>) => { Object.assign(theme, patch); changed("all"); };
  return h("div", { class: "controls" },
    h("label", {}, h("input", { type: "color", value: theme.background, oninput: (e: Event) => set({ background: (e.target as HTMLInputElement).value }) }), T("背景", "Background"),
      h("input", { type: "checkbox", checked: !!theme.background2, onchange: (e: Event) => { set({ background2: (e.target as HTMLInputElement).checked ? theme.background : undefined }); render(); } }), T("渐变", "Gradient"),
      theme.background2 ? h("input", { type: "color", value: theme.background2, oninput: (e: Event) => set({ background2: (e.target as HTMLInputElement).value }) }) : null),
    h("label", {}, h("input", { type: "checkbox", checked: theme.textColor === "auto", onchange: (e: Event) => { set({ textColor: (e.target as HTMLInputElement).checked ? "auto" : "#111827" }); render(); } }), T("文字颜色自动", "Auto text colour"),
      theme.textColor !== "auto" ? h("input", { type: "color", value: theme.textColor, oninput: (e: Event) => set({ textColor: (e.target as HTMLInputElement).value }) }) : null),
    h("label", {}, T("设备边框", "Device frame"), h("select", { onchange: (e: Event) => set({ frame: (e.target as HTMLSelectElement).value as Theme["frame"] }) },
      ...([["auto", T("自动（iPhone）", "Auto (iPhone)")], ["iphone", "iPhone"], ["android", "Android"], ["none", T("无边框", "None")]] as const).map(([v, l]) => h("option", { value: v, selected: theme.frame === v }, l)))),
    h("label", {}, h("input", { type: "color", value: theme.frameColor, oninput: (e: Event) => set({ frameColor: (e.target as HTMLInputElement).value }) }), T("机身颜色", "Frame colour")),
    h("label", {}, T("文字位置", "Text"), h("select", { onchange: (e: Event) => set({ textPosition: (e.target as HTMLSelectElement).value as Theme["textPosition"] }) },
      h("option", { value: "top", selected: theme.textPosition === "top" }, T("上方", "Top")), h("option", { value: "bottom", selected: theme.textPosition === "bottom" }, T("下方", "Bottom")))),
    slider(T("设备大小", "Device size"), theme.deviceScale, 0.5, 0.95, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => set({ deviceScale: v })),
    slider(T("标题大小", "Title size"), theme.titleScale, 0.6, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => set({ titleScale: v })),
    h("label", {}, h("input", { type: "checkbox", checked: theme.bleed, onchange: (e: Event) => set({ bleed: (e.target as HTMLInputElement).checked }) }), T("设备超出画面边缘", "Let the device bleed off the edge")),
  );
}

function thumb(index: number) {
  const preview = state.previews.get(index);
  const slide = state.project!.slides[index];
  const card = h("div", { class: `thumb ${index === state.selected ? "selected" : ""} ${preview?.warnings.length ? "warn" : ""}`, onclick: () => { state.selected = index; render(); void refreshOne(index, true); } },
    preview ? h("img", { src: preview.src, alt: slide.image }) : h("div", { class: "placeholder" }, "…"),
    h("div", { class: "cap" }, `${index + 1}. ${slide.image.split("/").pop()}`),
    preview?.warnings.length ? h("span", { class: "flag", title: preview.warnings.join("\n") }, "!") : null,
  );
  card.dataset.index = String(index);
  return card;
}

function editor() {
  const project = state.project!;
  void loadImages();
  const slide = project.slides[state.selected];
  const text = slide ? (slide.text[state.locale] ??= {}) : undefined;
  const newLocale = h("input", { type: "text", size: 7, placeholder: "en-US" });
  const move = (delta: number) => {
    const j = state.selected + delta;
    if (j < 0 || j >= project.slides.length) return;
    [project.slides[state.selected], project.slides[j]] = [project.slides[j], project.slides[state.selected]];
    state.selected = j;
    state.previews.clear();
    render();
    changed("all");
  };
  return h("div", {},
    h("div", { class: "toolbar" },
      h("div", { class: "tabs" }, ...project.locales.map((l) => h("button", { class: l === state.locale ? "on" : "", onclick: () => { state.locale = l; state.previews.clear(); render(); changed("all"); } }, l))),
      newLocale, h("button", { onclick: () => { const v = newLocale.value.trim(); if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v) && !project.locales.includes(v)) { project.locales.push(v); state.locale = v; state.previews.clear(); render(); changed("all"); } } }, T("+ 语言", "+ Language")),
      h("select", { onchange: (e: Event) => { state.preset = (e.target as HTMLSelectElement).value; state.previews.clear(); render(); changed("all"); } },
        ...state.presets.filter((p) => project.presets.includes(p.id)).map((p) => h("option", { value: p.id, selected: p.id === state.preset }, p.label))),
      h("span", { class: "spacer" }),
      h("input", { value: state.projectPath, size: 22, title: T("项目文件", "Project file"), oninput: (e: Event) => (state.projectPath = (e.target as HTMLInputElement).value) }),
      h("button", { onclick: save }, T("保存项目", "Save project")),
      h("button", { class: "primary", onclick: exportAll }, T("导出全部", "Export all")),
    ),
    h("div", { class: "layout" },
      h("div", { class: "side" },
        h("div", { class: "card" }, h("h2", {}, T("样式（所有截图）", "Style (all slides)")), themeControls(project.theme)),
        h("div", { class: "card controls" }, h("h2", {}, T("导出尺寸", "Sizes")),
          ...state.presets.map((p) => h("label", {}, h("input", { type: "checkbox", checked: project.presets.includes(p.id), onchange: (e: Event) => {
            project.presets = (e.target as HTMLInputElement).checked ? [...project.presets, p.id] : project.presets.filter((id) => id !== p.id);
            if (!project.presets.includes(state.preset)) state.preset = project.presets[0] ?? "";
            render();
          } }), p.label)),
          h("label", {}, T("输出到", "Output"), h("input", { type: "text", value: project.outputDir, oninput: (e: Event) => (project.outputDir = (e.target as HTMLInputElement).value) })),
        ),
      ),
      h("div", { class: "main" },
        h("div", { class: "strip" }, ...project.slides.map((_, i) => thumb(i))),
        slide && text ? h("div", { class: "card detail" },
          h("div", { class: "detail-img" }, h("img", { id: "large", alt: slide.image })),
          h("div", { class: "controls" },
            h("h2", {}, `${state.selected + 1}. ${slide.image} · ${state.locale}`),
            h("div", { id: "warnings", class: "row" }),
            h("label", {}, T("标题", "Headline")), h("textarea", { oninput: (e: Event) => { text.title = (e.target as HTMLTextAreaElement).value; changed("one"); } }, text.title ?? ""),
            h("label", {}, T("副标题", "Subheadline")), h("textarea", { oninput: (e: Event) => { text.subtitle = (e.target as HTMLTextAreaElement).value; changed("one"); } }, text.subtitle ?? ""),
            h("label", {}, h("input", { type: "checkbox", checked: !!slide.background, onchange: (e: Event) => { slide.background = (e.target as HTMLInputElement).checked ? project.theme.background : undefined; slide.background2 = undefined; render(); changed("one"); } }), T("这张单独设背景", "Own background"),
              slide.background ? h("input", { type: "color", value: slide.background, oninput: (e: Event) => { slide.background = (e.target as HTMLInputElement).value; changed("one"); } }) : null),
            h("label", {}, T("平板截图", "Tablet screenshot"), h("select", { onchange: (e: Event) => { slide.tabletImage = (e.target as HTMLSelectElement).value || undefined; changed("one"); } },
              h("option", { value: "" }, T("（用手机截图）", "(use phone screenshot)")), ...state.images.map((f) => h("option", { value: f, selected: f === slide.tabletImage }, f)))),
            h("div", { class: "row" },
              h("button", { onclick: () => move(-1) }, "←"), h("button", { onclick: () => move(1) }, "→"),
              h("button", { onclick: () => { project.slides.splice(state.selected, 1); state.selected = Math.max(0, state.selected - 1); state.previews.clear(); render(); changed("all"); } }, T("移除", "Remove")),
              h("button", { onclick: () => sendMessage(T(`请根据第 ${state.selected + 1} 张截图（${slide.image}）的内容，为 ${project.locales.join("、")} 各写一个简短的商店宣传标题和副标题，更新到项目里。`, `Please write a short store headline and subheadline for screenshot ${state.selected + 1} (${slide.image}) in ${project.locales.join(", ")} and update the project.`)) }, T("让 Agent 写文案", "Ask the agent for copy")),
            ),
            project.slides.length < 10 ? h("label", {}, T("添加截图", "Add screenshot"), h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) { project.slides.push({ image: v, text: {} }); state.selected = project.slides.length - 1; render(); changed("all"); } } },
              h("option", { value: "" }, "…"), ...state.images.map((f) => h("option", { value: f }, f)))) : null,
          ),
        ) : h("div", { class: "empty" }, T("没有截图", "No screenshots")),
        state.result ? h("div", { class: "card" },
          h("h2", {}, T(`已导出 ${state.result.files.length} 张到 ${state.result.outputDir}/`, `Exported ${state.result.files.length} images to ${state.result.outputDir}/`)),
          ...state.result.problems.slice(0, 20).map((p) => h("div", { class: "muted small" }, p)),
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
  const result = await busy(() => call<{ files: string[]; problems: string[]; outputDir: string }>("shots_export", { project: state.project }, 900_000));
  if (result) {
    state.result = result;
    render();
    void refreshOne(state.selected, true);
    toast(T(`已导出 ${result.files.length} 张`, `Exported ${result.files.length} images`));
  }
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
void initHost("store-screenshot-studio", "0.1.0").then(() => render());
