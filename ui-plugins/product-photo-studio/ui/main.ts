import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, sendMessage, toast } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Settings { removeBackground: "auto" | "off"; tolerance: number; fill: number; offsetY: number; align: "center" | "bottom"; shadow: "none" | "ground" | "drop"; shadowOpacity: number; background: string }
interface Preset { id: string; label: string; width: number; height: number; format: "jpg" | "png"; transparent?: boolean }
interface Project { version: 1; images: { path: string; overrides?: Partial<Settings> }[]; settings: Settings; presets: string[]; customPresets?: Preset[]; outputDir: string }
interface Report { borderUniform: number; removed: number; hadAlpha: boolean; touchesEdge: boolean; warnings: string[] }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const WARN = (w: string) =>
  (({
    background_not_uniform: T("背景不是纯色，去背可能不准", "Busy background — removal may be inaccurate"),
    little_background_removed: T("几乎没去掉背景，可调高容差", "Little background removed — raise tolerance"),
    subject_touches_edge: T("商品贴到照片边缘，原图可能被裁切", "Product touches the photo edge"),
    empty_subject: T("去背后什么都没剩，请调低容差", "Nothing left — lower tolerance"),
  }) as Record<string, string>)[w] ?? w;

const state: {
  project?: Project;
  projectPath: string;
  presets: Preset[];
  previews: Map<number, { src: string; report: Report }>;
  selected: number;
  previewPreset?: string;
  result?: { files: string[]; problems: string[]; outputDir: string };
} = { projectPath: "product-photos.photostudio.json", presets: [], previews: new Map(), selected: 0 };

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

function allPresets(): Preset[] {
  return [...state.presets, ...(state.project?.customPresets ?? [])];
}

function load(value: Record<string, unknown>) {
  state.project = value.project as Project;
  state.presets = (value.presets as Preset[]) ?? state.presets;
  if (typeof value.projectPath === "string") state.projectPath = value.projectPath;
  state.previews.clear();
  state.selected = 0;
  state.result = undefined;
  state.previewPreset = state.project.presets[0];
  render();
  void refreshAll();
}

// ---------------------------------------------------------------- 预览

let generation = 0;
async function refreshAll() {
  const token = ++generation;
  const project = state.project;
  if (!project) return;
  for (let index = 0; index < project.images.length; index++) {
    if (token !== generation) return;
    await refreshOne(index, 260);
  }
  if (token === generation) await refreshOne(state.selected, 560, true);
}

async function refreshOne(index: number, size: number, large = false) {
  const project = state.project;
  if (!project?.images[index]) return;
  try {
    const result = await call<{ image: string; mime: string; report: Report }>("photos_preview", { project, index, preset: state.previewPreset, size });
    const src = `data:${result.mime};base64,${result.image}`;
    if (large) {
      const img = document.getElementById("large") as HTMLImageElement | null;
      if (img) img.src = src;
    } else {
      state.previews.set(index, { src, report: result.report });
      const card = document.querySelector(`.thumb[data-index="${index}"]`);
      if (card) card.replaceWith(thumb(index));
    }
    if (index === state.selected) renderWarnings(result.report);
  } catch (error) {
    if (index === state.selected) toast(error instanceof Error ? error.message : String(error), "error");
  }
}

function renderWarnings(report: Report) {
  const box = document.getElementById("warnings");
  if (!box) return;
  box.replaceChildren(
    ...(report.warnings.length ? report.warnings.map((w) => h("div", { class: "badge bad" }, WARN(w))) : [h("span", { class: "badge ok" }, T("看起来没问题", "Looks clean"))]),
    h("span", { class: "muted small" }, T(` 去掉背景 ${Math.round(report.removed * 100)}%`, ` ${Math.round(report.removed * 100)}% background removed`)),
  );
}

let debounce: ReturnType<typeof setTimeout> | undefined;
function changed(scope: "all" | "one") {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (scope === "all") void refreshAll();
    else {
      void refreshOne(state.selected, 260);
      void refreshOne(state.selected, 560, true);
    }
  }, 250);
}

// ---------------------------------------------------------------- 界面

function render() {
  applyTheme();
  root.replaceChildren(state.project ? editor() : picker());
}

function picker() {
  const list = h("div", { class: "pick-list" }, h("div", { class: "muted" }, T("正在读取工作区图片…", "Loading workspace images…")));
  const chosen = new Set<string>();
  void call<{ files: string[] }>("workspace_images").then(({ files }) => {
    list.replaceChildren(
      ...(files.length
        ? files.map((file) => h("label", {}, h("input", { type: "checkbox", onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? chosen.add(file) : chosen.delete(file)) }), file))
        : [h("div", { class: "empty" }, T("工作区里没有 JPG/PNG 图片", "No JPG/PNG images in the workspace"))]),
    );
  });
  return h("div", {},
    h("h1", {}, T("电商商品图助手", "Product Photo Studio")),
    h("p", { class: "muted" }, T("批量去掉纯色背景、统一商品大小和位置、加阴影，导出白底图、透明图和各平台尺寸；不满意的图可以单独调整。", "Batch-remove plain backgrounds, normalise product size and position, add shadows, and export white-background, transparent and marketplace sizes — tweak any photo on its own.")),
    h("div", { class: "card" }, list, h("div", { class: "row" }, h("button", { class: "primary", onclick: () => chosen.size && open({ paths: [...chosen] }) }, T("打开所选图片", "Open selected")))),
  );
}

async function open(args: Record<string, unknown>) {
  const result = await busy(() => call<Record<string, unknown>>("photos_open", args, 600_000));
  if (result) load(result);
}

function slider(label: string, value: number, min: number, max: number, step: number, format: (v: number) => string, onInput: (v: number) => void) {
  const out = h("span", { class: "value" }, format(value));
  return h("label", { class: "slider" }, h("span", { class: "lbl" }, label),
    h("input", { type: "range", min, max, step, value, oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); out.textContent = format(v); onInput(v); } }), out);
}

function settingsControls(get: () => Settings, set: (patch: Partial<Settings>) => void) {
  const s = get();
  return h("div", { class: "controls" },
    h("label", {}, h("input", { type: "checkbox", checked: s.removeBackground === "auto", onchange: (e: Event) => set({ removeBackground: (e.target as HTMLInputElement).checked ? "auto" : "off" }) }), T("去背景", "Remove background")),
    slider(T("容差", "Tolerance"), s.tolerance, 1, 100, 1, (v) => String(v), (v) => set({ tolerance: v })),
    slider(T("主体占比", "Product size"), s.fill, 0.4, 0.98, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => set({ fill: v })),
    slider(T("上下位置", "Vertical offset"), s.offsetY, -0.3, 0.3, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => set({ offsetY: v })),
    h("label", {}, T("对齐", "Align"), h("select", { onchange: (e: Event) => set({ align: (e.target as HTMLSelectElement).value as Settings["align"] }) },
      h("option", { value: "center", selected: s.align === "center" }, T("居中", "Center")), h("option", { value: "bottom", selected: s.align === "bottom" }, T("底部对齐", "Bottom")))),
    h("label", {}, T("阴影", "Shadow"), h("select", { onchange: (e: Event) => set({ shadow: (e.target as HTMLSelectElement).value as Settings["shadow"] }) },
      h("option", { value: "none", selected: s.shadow === "none" }, T("无", "None")), h("option", { value: "ground", selected: s.shadow === "ground" }, T("地面柔影", "Ground")), h("option", { value: "drop", selected: s.shadow === "drop" }, T("投影", "Drop")))),
    slider(T("阴影浓度", "Shadow strength"), s.shadowOpacity, 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => set({ shadowOpacity: v })),
    h("label", {}, T("背景色", "Background"), h("input", { type: "color", value: s.background, oninput: (e: Event) => set({ background: (e.target as HTMLInputElement).value }) })),
  );
}

function thumb(index: number) {
  const image = state.project!.images[index];
  const preview = state.previews.get(index);
  const card = h("div", { class: `thumb ${index === state.selected ? "selected" : ""} ${preview?.report.warnings.length ? "warn" : ""}`, onclick: () => selectPhoto(index) },
    preview ? h("img", { src: preview.src, alt: image.path }) : h("div", { class: "placeholder" }, "…"),
    h("div", { class: "cap" }, image.overrides && Object.keys(image.overrides).length ? "✎ " : "", image.path.split("/").pop()),
    preview?.report.warnings.length ? h("span", { class: "flag", title: preview.report.warnings.map(WARN).join("\n") }, "!") : null,
  );
  card.dataset.index = String(index);
  return card;
}

function selectPhoto(index: number) {
  state.selected = index;
  render();
  void refreshOne(index, 560, true);
}

function editor() {
  const project = state.project!;
  const image = project.images[state.selected];
  const presetBoxes = allPresets().map((preset) =>
    h("label", { class: "preset" }, h("input", { type: "checkbox", checked: project.presets.includes(preset.id), onchange: (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      project.presets = on ? [...project.presets, preset.id] : project.presets.filter((id) => id !== preset.id);
      if (!project.presets.includes(state.previewPreset ?? "")) state.previewPreset = project.presets[0];
      render();
      changed("all");
    } }), `${preset.label}`, h("span", { class: "muted small" }, ` ${preset.format.toUpperCase()}`)),
  );
  const customW = h("input", { type: "number", min: 16, max: 6000, placeholder: "W", class: "num" });
  const customH = h("input", { type: "number", min: 16, max: 6000, placeholder: "H", class: "num" });
  const customPng = h("input", { type: "checkbox" });

  const overrides = () => ({ ...project.settings, ...image?.overrides });
  const setOverride = (patch: Partial<Settings>) => {
    image.overrides = { ...image.overrides, ...patch };
    changed("one");
  };

  return h("div", {},
    h("div", { class: "toolbar" },
      h("strong", {}, T(`${project.images.length} 张商品图`, `${project.images.length} photos`)),
      h("span", { class: "spacer" }),
      h("label", {}, T("输出到", "Output"), h("input", { value: project.outputDir, size: 18, oninput: (e: Event) => (project.outputDir = (e.target as HTMLInputElement).value) })),
      h("input", { value: state.projectPath, size: 26, title: T("项目文件", "Project file"), oninput: (e: Event) => (state.projectPath = (e.target as HTMLInputElement).value) }),
      h("button", { onclick: save }, T("保存设置", "Save settings")),
      h("button", { class: "primary", onclick: exportAll }, T("全部导出", "Export all")),
    ),
    h("div", { class: "layout" },
      h("div", { class: "side" },
        h("div", { class: "card" }, h("h2", {}, T("全部图片的设置", "Settings for all photos")), settingsControls(() => project.settings, (patch) => { Object.assign(project.settings, patch); changed("all"); })),
        h("div", { class: "card" }, h("h2", {}, T("输出尺寸", "Output sizes")), ...presetBoxes,
          h("div", { class: "row" }, customW, "×", customH, h("label", {}, customPng, T("透明 PNG", "Transparent PNG")),
            h("button", { onclick: () => {
              const w = Number(customW.value), hgt = Number(customH.value);
              if (!(w >= 16 && hgt >= 16)) return;
              const id = `custom-${w}x${hgt}${customPng.checked ? "-png" : ""}`;
              project.customPresets = [...(project.customPresets ?? []).filter((p) => p.id !== id), { id, label: `${w}×${hgt}`, width: w, height: hgt, format: customPng.checked ? "png" : "jpg", transparent: customPng.checked }];
              project.presets = [...new Set([...project.presets, id])];
              render();
            } }, T("添加尺寸", "Add size")))),
      ),
      h("div", { class: "main" },
        h("div", { class: "row" }, T("预览尺寸", "Preview size"), h("select", { onchange: (e: Event) => { state.previewPreset = (e.target as HTMLSelectElement).value; state.previews.clear(); render(); changed("all"); } },
          ...allPresets().filter((p) => project.presets.includes(p.id)).map((p) => h("option", { value: p.id, selected: p.id === state.previewPreset }, p.label)))),
        h("div", { class: "grid" }, ...project.images.map((_, index) => thumb(index))),
        image ? h("div", { class: "card detail" },
          h("div", { class: "detail-img" }, h("img", { id: "large", alt: image.path })),
          h("div", {},
            h("h2", {}, image.path),
            h("div", { id: "warnings", class: "row" }),
            h("h2", {}, T("只调整这一张", "Adjust this photo only")),
            settingsControls(overrides, setOverride),
            h("div", { class: "row" },
              h("button", { onclick: () => { image.overrides = undefined; render(); changed("one"); } }, T("恢复全局设置", "Use global settings")),
              h("button", { onclick: () => exportOne(state.selected) }, T("只导出这一张", "Export this photo")),
            ),
          ),
        ) : null,
        state.result ? h("div", { class: "card" },
          h("h2", {}, T(`已导出 ${state.result.files.length} 个文件到 ${state.result.outputDir}/`, `Exported ${state.result.files.length} files to ${state.result.outputDir}/`)),
          ...state.result.problems.map((p) => h("div", { class: "muted small" }, p)),
          state.result.problems.length ? h("button", { onclick: () => sendMessage(T(`导出的商品图里有 ${state.result!.problems.length} 张需要检查，请帮我看看这些图：${state.result!.problems.join("；")}`, `${state.result!.problems.length} exported photos need a look: ${state.result!.problems.join("; ")}`)) }, T("交给 Agent 看看", "Ask the agent")) : null,
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
  const result = await busy(() => call<{ files: string[]; problems: string[]; outputDir: string }>("photos_export", { project: state.project }, 900_000));
  if (result) {
    state.result = result;
    render();
    void refreshOne(state.selected, 560, true);
    toast(T(`已导出 ${result.files.length} 个文件`, `Exported ${result.files.length} files`));
  }
}

async function exportOne(index: number) {
  const result = await busy(() => call<{ files: string[]; problems: string[]; outputDir: string }>("photos_export", { project: state.project, indices: [index] }));
  if (result) toast(T(`已导出：${result.files.join("、")}`, `Exported: ${result.files.join(", ")}`));
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
void initHost("product-photo-studio", "0.1.0").then(() => render());
