// 主题读取、预览渲染与内置检查。
import { Context } from "liquidjs";
import { fontObject, makeEngine, type ThemeFiles } from "./liquid.ts";
import { cart, collections, menus, pages, placeholderImage, products, routes, shop } from "./sample.ts";

export const THEME_DIRS = ["layout", "sections", "snippets", "templates", "templates/customers", "config", "locales", "assets", "blocks"];
export const SETTING_TYPES = new Set(["text", "textarea", "richtext", "inline_richtext", "image_picker", "url", "checkbox", "range", "select", "radio", "color", "color_background", "number", "collection", "collection_list", "product", "product_list", "link_list", "page", "blog", "article", "font_picker", "text_alignment", "video", "video_url", "header", "paragraph", "color_scheme", "color_scheme_group"]);
const SIDEBAR = new Set(["header", "paragraph"]);
export const TEMPLATES = ["index", "product", "collection", "page", "cart", "search", "404"];

export interface Issue { file: string; line?: number; severity: "error" | "warning"; check: string; message: string; source: "builtin" | "theme-check" }
export interface Setting { type: string; id?: string; label?: string; default?: unknown; options?: { value: string; label: string }[]; min?: number; max?: number; step?: number }
export interface Schema { name?: string; tag?: string; class?: string; settings?: Setting[]; blocks?: { type: string; name?: string; settings?: Setting[]; limit?: number }[]; presets?: unknown[]; max_blocks?: number; enabled_on?: unknown; disabled_on?: unknown }

export class Theme implements ThemeFiles {
  files: Map<string, string>;
  binary: Map<string, Uint8Array>;
  constructor(files: Map<string, string>, binary = new Map<string, Uint8Array>()) { this.files = files; this.binary = binary; }
  get(p: string) { return this.files.get(p); }
  has(p: string) { return this.files.has(p) || this.binary.has(p); }
  keys() { return this.files.keys(); }
  schemaOf(section: string): { schema?: Schema; error?: string; line?: number } {
    const src = this.files.get(`sections/${section}.liquid`);
    if (src === undefined) return { error: "missing" };
    const m = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(src);
    if (!m) return {};
    const line = src.slice(0, m.index).split("\n").length;
    try { return { schema: JSON.parse(m[1]) as Schema, line }; } catch (e) { return { error: (e as Error).message, line }; }
  }
}

const lineOf = (src: string, index: number) => src.slice(0, index).split("\n").length;

/** 内置检查：Liquid 语法、schema 规则、设置引用、JSON 模板引用。 */
export function builtinCheck(theme: Theme): Issue[] {
  const out: Issue[] = [];
  const add = (file: string, check: string, message: string, line?: number, severity: Issue["severity"] = "error") => out.push({ file, ...(line ? { line } : {}), severity, check, message, source: "builtin" });
  const engine = makeEngine(theme);
  for (const [file, src] of theme.files) {
    if (file.endsWith(".liquid")) {
      try { engine.parse(src, file); } catch (e) {
        const msg = (e as Error).message.replace(/, file:.*$/, "");
        const line = Number((/line:(\d+)/.exec((e as Error).message) ?? [])[1]) || undefined;
        add(file, "LiquidSyntax", msg.replace(/\s*line:\d+, col:\d+/, ""), line);
      }
    } else if (file.endsWith(".json")) {
      try { JSON.parse(src.replace(/^\s*\/\*[\s\S]*?\*\//, "")); } catch (e) { add(file, "JSONSyntax", (e as Error).message); }
    }
  }
  if (!theme.has("layout/theme.liquid")) add("layout/theme.liquid", "RequiredFile", "layout/theme.liquid is required");
  else for (const need of ["content_for_header", "content_for_layout"]) if (!theme.get("layout/theme.liquid")!.includes(need)) add("layout/theme.liquid", "RequiredLayoutObject", `layout/theme.liquid must output {{ ${need} }}`);
  if (!theme.has("config/settings_schema.json")) add("config/settings_schema.json", "RequiredFile", "config/settings_schema.json is required");
  for (const t of TEMPLATES) if (!theme.has(`templates/${t}.json`) && !theme.has(`templates/${t}.liquid`)) add(`templates/${t}.json`, "MissingTemplate", `templates/${t}.json is missing (Online Store 2.0 themes use JSON templates)`, undefined, "warning");

  // sections
  for (const file of [...theme.files.keys()].filter((f) => /^sections\/[^/]+\.liquid$/.test(f))) {
    const name = file.slice(9, -7);
    const src = theme.get(file)!;
    const { schema, error, line } = theme.schemaOf(name);
    if (error) { add(file, "ValidSchema", `{% schema %} is not valid JSON: ${error}`, line); continue; }
    if (!schema) { add(file, "ValidSchema", "section has no {% schema %}; it can't be added in the theme editor", undefined, "warning"); continue; }
    if (!schema.name) add(file, "ValidSchema", "schema needs a name", line);
    else if (schema.name.length > 25) add(file, "ValidSchema", `schema name “${schema.name}” is longer than 25 characters`, line);
    const checkSettings = (settings: Setting[] | undefined, where: string) => {
      const ids = new Set<string>();
      for (const s of settings ?? []) {
        if (!SETTING_TYPES.has(s.type)) add(file, "SettingType", `${where}: setting type “${s.type}”${s.id ? ` (${s.id})` : ""} is not allowed — use text, richtext, image_picker, url, select, range, checkbox, color, collection, product_list, link_list…${s.type === "liquid" || s.type === "html" ? " (custom code settings are not allowed in generated themes)" : ""}`, line);
        if (SIDEBAR.has(s.type)) continue;
        if (!s.id) { add(file, "SettingId", `${where}: a ${s.type} setting has no id`, line); continue; }
        if (ids.has(s.id)) add(file, "SettingId", `${where}: duplicate setting id “${s.id}”`, line);
        ids.add(s.id);
        if ((s.type === "select" || s.type === "radio") && (!s.options?.length || (s.default !== undefined && !s.options.some((o) => o.value === s.default)))) add(file, "SettingDefault", `${where}: ${s.id} needs options and a default among them`, line);
        if (s.type === "range") {
          const { min = NaN, max = NaN, step = 1 } = s;
          if (!(min < max)) add(file, "SettingDefault", `${where}: range ${s.id} needs min < max`, line);
          else if ((max - min) / step > 101) add(file, "SettingDefault", `${where}: range ${s.id} has more than 101 steps`, line);
          if (s.default === undefined || Number(s.default) < min || Number(s.default) > max) add(file, "SettingDefault", `${where}: range ${s.id} needs a default between ${min} and ${max}`, line);
        }
      }
      return ids;
    };
    const sectionIds = checkSettings(schema.settings, "section");
    const blockIds = new Set<string>();
    const blockTypes = new Set<string>();
    for (const b of schema.blocks ?? []) {
      if (blockTypes.has(b.type)) add(file, "ValidSchema", `duplicate block type “${b.type}”`, line);
      blockTypes.add(b.type);
      if (b.type !== "@app" && b.type !== "@theme") for (const id of checkSettings(b.settings, `block ${b.type}`)) blockIds.add(id);
    }
    const body = src.replace(/\{%-?\s*schema\s*-?%\}[\s\S]*$/, "");
    for (const m of body.matchAll(/\bsection\.settings\.([A-Za-z_][\w-]*)/g)) if (!sectionIds.has(m[1])) add(file, "UndefinedSetting", `section.settings.${m[1]} is not defined in the schema`, lineOf(src, m.index!));
    for (const m of body.matchAll(/\bblock\.settings\.([A-Za-z_][\w-]*)/g)) if (!blockIds.has(m[1])) add(file, "UndefinedSetting", `block.settings.${m[1]} is not defined in any block of the schema`, lineOf(src, m.index!));
  }

  // JSON templates and section groups
  for (const file of [...theme.files.keys()].filter((f) => /^(templates\/.+|sections\/[^/]+)\.json$/.test(f))) {
    let data: { sections?: Record<string, { type: string; settings?: Record<string, unknown>; blocks?: Record<string, { type: string; settings?: Record<string, unknown> }>; block_order?: string[]; disabled?: boolean }>; order?: string[] };
    try { data = JSON.parse(theme.get(file)!.replace(/^\s*\/\*[\s\S]*?\*\//, "")); } catch { continue; }
    if (!data.sections || !Array.isArray(data.order)) { add(file, "ValidJSONTemplate", "needs “sections” and “order”"); continue; }
    for (const key of data.order) if (!data.sections[key]) add(file, "ValidJSONTemplate", `order lists “${key}” but there is no such section`);
    for (const [key, sec] of Object.entries(data.sections)) {
      const { schema, error } = theme.schemaOf(sec.type);
      if (error === "missing") { add(file, "MissingSection", `section “${key}” uses type “${sec.type}” but sections/${sec.type}.liquid does not exist`); continue; }
      if (!schema) continue;
      const ids = new Set((schema.settings ?? []).map((s) => s.id).filter(Boolean));
      for (const k of Object.keys(sec.settings ?? {})) if (!ids.has(k)) add(file, "UnknownSetting", `${key}: setting “${k}” is not in sections/${sec.type}.liquid`, undefined, "warning");
      for (const [bk, b] of Object.entries(sec.blocks ?? {})) {
        const bt = schema.blocks?.find((x) => x.type === b.type);
        if (!bt) { add(file, "UnknownBlock", `${key}: block “${bk}” has type “${b.type}”, which sections/${sec.type}.liquid does not define`); continue; }
        const bids = new Set((bt.settings ?? []).map((s) => s.id).filter(Boolean));
        for (const k of Object.keys(b.settings ?? {})) if (!bids.has(k)) add(file, "UnknownSetting", `${key}/${bk}: setting “${k}” is not in block “${b.type}”`, undefined, "warning");
      }
      for (const bk of sec.block_order ?? []) if (!sec.blocks?.[bk]) add(file, "ValidJSONTemplate", `${key}: block_order lists “${bk}” but there is no such block`);
    }
  }
  return out;
}

// ---------------- preview ----------------
type SectionData = { type: string; settings?: Record<string, unknown>; blocks?: Record<string, { type: string; settings?: Record<string, unknown>; disabled?: boolean }>; block_order?: string[]; disabled?: boolean };
const readJson = (theme: Theme, p: string) => { try { return JSON.parse((theme.get(p) ?? "").replace(/^\s*\/\*[\s\S]*?\*\//, "")); } catch { return undefined; } };

export interface PreviewResult { html: string; errors: { section: string; message: string }[] }

export function renderPreview(theme: Theme, template: string, locale = "en"): PreviewResult {
  const errors: PreviewResult["errors"] = [];
  const localeFile = [...theme.files.keys()].find((f) => f === `locales/${locale}.json` || f === `locales/${locale}.default.json`) ?? "locales/en.default.json";
  const fallback = [...theme.files.keys()].find((f) => /^locales\/[^/]+\.default\.json$/.test(f));
  const engine = makeEngine(theme, {
    locale: readJson(theme, localeFile), fallbackLocale: fallback ? readJson(theme, fallback) : undefined,
    section: (name, ctx) => renderSection(name, { type: name }, name, ctx),
    sections: (group, ctx) => {
      const g = readJson(theme, `sections/${group}.json`);
      if (!g) { errors.push({ section: group, message: `sections/${group}.json not found` }); return ""; }
      return (g.order as string[] ?? []).filter((k) => !g.sections[k]?.disabled).map((k) => renderSection(k, g.sections[k], `sections--${group}__${k}`, ctx)).join("\n");
    },
  });
  // ---- 全局设置 ----
  const schemaArr = (readJson(theme, "config/settings_schema.json") ?? []) as { settings?: Setting[] }[];
  const current = (readJson(theme, "config/settings_data.json")?.current ?? {}) as Record<string, unknown>;
  const settingTypes = new Map<string, string>();
  const settings: Record<string, unknown> = {};
  for (const g of schemaArr) for (const s of g.settings ?? []) if (s.id) { settingTypes.set(s.id, s.type); settings[s.id] = resolve(s.type, typeof current === "object" && s.id in current ? current[s.id] : s.default); }

  function resolve(type: string, v: unknown): unknown {
    if (v === undefined || v === null || v === "") return type === "checkbox" ? false : null;
    switch (type) {
      case "image_picker": return placeholderImage(String(v).split("/").pop() ?? "image");
      case "collection": return collections[String(v)] ?? collections.all;
      case "collection_list": return (v as string[]).map((h) => collections[h] ?? collections.all);
      case "product": return products.find((p) => p.handle === v) ?? products[0];
      case "product_list": return (v as string[]).map((h) => products.find((p) => p.handle === h) ?? products[0]);
      case "link_list": return menus[String(v)] ?? { handle: v, title: String(v), links: [] };
      case "page": return pages[String(v)] ?? pages.about;
      case "font_picker": return fontObject(String(v));
      default: return v;
    }
  }
  const withDefaults = (defs: Setting[] | undefined, given: Record<string, unknown> | undefined) => {
    const o: Record<string, unknown> = {};
    for (const s of defs ?? []) if (s.id) o[s.id] = resolve(s.type, given && s.id in given ? given[s.id] : s.default);
    return o;
  };
  function renderSection(key: string, data: SectionData, id: string, ctx: Context): string {
    const src = theme.get(`sections/${data.type}.liquid`);
    if (src === undefined) { errors.push({ section: key, message: `sections/${data.type}.liquid not found` }); return ""; }
    const { schema } = theme.schemaOf(data.type);
    const order = data.block_order ?? Object.keys(data.blocks ?? {});
    const blocks = order.map((bk) => ({ bk, b: data.blocks?.[bk] })).filter((x) => x.b && !x.b.disabled).map(({ bk, b }) => ({ id: bk, type: b!.type, settings: withDefaults(schema?.blocks?.find((t) => t.type === b!.type)?.settings, b!.settings), shopify_attributes: "" }));
    const section = { id, settings: withDefaults(schema?.settings, data.settings), blocks, index: 1, location: "template" };
    try {
      ctx.push({ section });
      let html: string;
      try { html = engine.renderSync(engine.parse(src, `sections/${data.type}.liquid`), ctx); } finally { ctx.pop(); }
      const tag = schema?.tag ?? "div";
      return `<${tag} id="shopify-section-${id}" class="shopify-section${schema?.class ? ` ${schema.class}` : ""}">${html}</${tag}>`;
    } catch (e) {
      const msg = (e as Error).message;
      errors.push({ section: key, message: msg });
      return `<div style="border:2px dashed #c00;color:#c00;padding:12px;margin:8px;font:13px sans-serif">${data.type}: ${msg.replace(/</g, "&lt;")}</div>`;
    }
  }

  // ---- 模板 ----
  const tplJson = readJson(theme, `templates/${template}.json`);
  const scope: Record<string, unknown> = {
    shop, settings, routes, cart, request: { locale: { iso_code: locale, primary: true }, page_type: template.split(".")[0], design_mode: false, host: "example.myshopify.com" },
    canonical_url: "https://example.myshopify.com/", page_title: shop.name, page_description: shop.description, current_page: 1, template: { name: template.split(".")[0], suffix: template.split(".")[1] ?? null },
    content_for_header: "", localization: { available_languages: [], available_countries: [] }, linklists: menus, collections, pages, all_products: Object.fromEntries(products.map((p) => [p.handle, p])),
  };
  const kind = template.split(".")[0];
  if (kind === "product") Object.assign(scope, { product: products[0], page_title: products[0].title });
  if (kind === "collection") Object.assign(scope, { collection: collections.all, page_title: collections.all.title });
  if (kind === "page") Object.assign(scope, { page: pages.about, page_title: "About us" });
  if (kind === "search") Object.assign(scope, { search: { performed: true, terms: "linen", results: products.slice(0, 2), results_count: 2 } });
  const ctx = new Context(scope, (engine as unknown as { options: never }).options, { sync: true, globals: scope });
  let content = "";
  let layout = "theme";
  if (tplJson) {
    if (tplJson.layout === false) layout = "";
    else if (typeof tplJson.layout === "string") layout = tplJson.layout;
    content = (tplJson.order as string[] ?? []).filter((k) => !tplJson.sections?.[k]?.disabled).map((k) => renderSection(k, tplJson.sections[k], `template--${template}__${k}`, ctx)).join("\n");
  } else if (theme.has(`templates/${template}.liquid`)) {
    try { content = engine.parseAndRenderSync(theme.get(`templates/${template}.liquid`)!, scope); } catch (e) { errors.push({ section: template, message: (e as Error).message }); }
  } else errors.push({ section: template, message: `templates/${template}.json not found` });
  let html = content;
  if (layout) {
    const lsrc = theme.get(`layout/${layout}.liquid`);
    if (!lsrc) errors.push({ section: "layout", message: `layout/${layout}.liquid not found` });
    else try { ctx.push({ content_for_layout: content }); html = engine.renderSync(engine.parse(lsrc, `layout/${layout}.liquid`), ctx); ctx.pop(); } catch (e) { errors.push({ section: "layout", message: (e as Error).message }); }
  }
  // 资源：CSS 内联，图片转 data URI
  html = html.replace(/__inline__\/([\w.-]+)/g, (_m, name: string) => theme.get(`assets/${name.replace(/\.liquid$/, "")}`) ?? theme.get(`assets/${name}`) ?? `/* missing asset ${name} */`);
  html = html.replace(/__asset__\/([\w.-]+)/g, (_m, name: string) => {
    const bin = theme.binary.get(`assets/${name}`);
    if (bin) return `data:${/\.png$/i.test(name) ? "image/png" : /\.svg$/i.test(name) ? "image/svg+xml" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg"};base64,${Buffer.from(bin).toString("base64")}`;
    return "#missing-asset-" + name;
  });
  return { html, errors };
}
