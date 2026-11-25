// liquidjs + Shopify 专用标签/过滤器（用于语法检查和预览）。不是 Shopify 的完整实现。
import { Liquid, Tag, type Parser, type Context, type Emitter, type TagToken, type TopLevelToken } from "liquidjs";
import { placeholderImage } from "./sample.ts";

export interface ThemeFiles { get(path: string): string | undefined; has(path: string): boolean; keys(): Iterable<string> }
export interface RenderHooks { section?: (name: string, ctx: Context) => string; sections?: (group: string, ctx: Context) => string; locale?: Record<string, unknown>; fallbackLocale?: Record<string, unknown> }

const isTag = (t: TopLevelToken, name: string) => (t as TagToken).name === name && "args" in t;
function collect(liquid: Liquid, remain: TopLevelToken[], end: string, token: TagToken, parser: Parser) {
  const templates: unknown[] = [];
  while (remain.length) {
    const t = remain.shift()!;
    if (isTag(t, end)) return templates;
    templates.push(parser.parseToken(t, remain));
  }
  throw new Error(`tag ${token.getText()} not closed`);
}

export function makeEngine(files: ThemeFiles, hooks: RenderHooks = {}) {
  const fs = {
    exists: async (p: string) => files.has(p), existsSync: (p: string) => files.has(p),
    readFile: async (p: string) => files.get(p) ?? "", readFileSync: (p: string) => files.get(p) ?? "",
    resolve: (_dir: string, file: string, ext: string) => `snippets/${file}${file.endsWith(ext) ? "" : ext}`,
    contains: async () => true, containsSync: () => true, dirname: () => "snippets", sep: "/",
  };
  const liquid = new Liquid({ fs, root: ["snippets"], partials: ["snippets"], extname: ".liquid", strictFilters: false, strictVariables: false, jsTruthy: false, ownPropertyOnly: true, cache: true, relativeReference: false });

  // {% schema %} {% javascript %}：内容原样保留，不渲染
  for (const name of ["schema", "javascript", "doc"]) liquid.registerTag(name, class extends Tag {
    constructor(token: TagToken, remain: TopLevelToken[], l: Liquid) {
      super(token, remain, l);
      while (remain.length) { if (isTag(remain.shift()!, `end${name}`)) return; }
      throw new Error(`tag ${token.getText()} not closed`);
    }
    render() { return ""; }
  });
  // {% style %} / {% stylesheet %}
  liquid.registerTag("style", class extends Tag {
    templates: unknown[];
    constructor(token: TagToken, remain: TopLevelToken[], l: Liquid, parser: Parser) { super(token, remain, l); this.templates = collect(l, remain, "endstyle", token, parser); }
    *render(ctx: Context, emitter: Emitter): Generator<unknown, void, string> { const html = yield this.liquid.renderer.renderTemplates(this.templates as never, ctx); emitter.write(`<style data-shopify>${html}</style>`); }
  });
  liquid.registerTag("stylesheet", class extends Tag {
    text = "";
    constructor(token: TagToken, remain: TopLevelToken[], l: Liquid) { super(token, remain, l); while (remain.length) { const t = remain.shift()!; if (isTag(t, "endstylesheet")) return; this.text += t.getText(); } throw new Error(`tag ${token.getText()} not closed`); }
    render() { return `<style>${this.text}</style>`; }
  });
  // {% form 'product', product %}
  liquid.registerTag("form", class extends Tag {
    templates: unknown[]; type: string;
    constructor(token: TagToken, remain: TopLevelToken[], l: Liquid, parser: Parser) { super(token, remain, l); this.type = (/['"]([\w-]+)['"]/.exec(token.args) ?? [])[1] ?? "form"; this.templates = collect(l, remain, "endform", token, parser); }
    *render(ctx: Context, emitter: Emitter): Generator<unknown, void, string> {
      const action = this.type === "product" ? "/cart/add" : this.type === "customer" ? "/contact#newsletter" : "/contact";
      ctx.push({ form: { errors: null, posted_successfully: false } });
      const html = yield this.liquid.renderer.renderTemplates(this.templates as never, ctx);
      ctx.pop();
      emitter.write(`<form method="post" action="${action}" class="shopify-form-${this.type}">${html}</form>`);
    }
  });
  // {% paginate collection.products by 12 %}
  liquid.registerTag("paginate", class extends Tag {
    templates: unknown[]; expr: string; per: string;
    constructor(token: TagToken, remain: TopLevelToken[], l: Liquid, parser: Parser) {
      super(token, remain, l);
      const m = /^\s*(.+?)\s+by\s+(.+?)\s*$/.exec(token.args);
      if (!m) throw new Error(`paginate needs “… by N”: ${token.getText()}`);
      this.expr = m[1]; this.per = m[2];
      this.templates = collect(l, remain, "endpaginate", token, parser);
    }
    *render(ctx: Context, emitter: Emitter): Generator<unknown, void, string> {
      const items = this.liquid.evalValueSync(this.expr, ctx);
      const per = Number(this.liquid.evalValueSync(this.per, ctx)) || 12;
      const n = Array.isArray(items) ? items.length : 0;
      ctx.push({ paginate: { current_page: 1, pages: Math.max(1, Math.ceil(n / per)), items: n, page_size: per, previous: null, next: n > per ? { url: "?page=2", title: "Next" } : null, parts: [] } });
      emitter.write(yield this.liquid.renderer.renderTemplates(this.templates as never, ctx));
      ctx.pop();
    }
  });
  liquid.registerTag("section", class extends Tag {
    name: string;
    constructor(token: TagToken, remain: TopLevelToken[], l: Liquid) { super(token, remain, l); this.name = (/['"]([^'"]+)['"]/.exec(token.args) ?? [])[1] ?? ""; }
    render(ctx: Context) { return hooks.section?.(this.name, ctx) ?? ""; }
  });
  liquid.registerTag("sections", class extends Tag {
    name: string;
    constructor(token: TagToken, remain: TopLevelToken[], l: Liquid) { super(token, remain, l); this.name = (/['"]([^'"]+)['"]/.exec(token.args) ?? [])[1] ?? ""; }
    render(ctx: Context) { return hooks.sections?.(this.name, ctx) ?? ""; }
  });
  liquid.registerTag("layout", class extends Tag { render() { return ""; } });
  liquid.registerTag("content_for", class extends Tag { render() { return ""; } });

  // ---- filters ----
  const named = (args: unknown[]) => Object.fromEntries(args.filter((a): a is [string, unknown] => Array.isArray(a) && a.length === 2 && typeof a[0] === "string"));
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);
  const lookup = (key: string) => {
    const get = (o: unknown) => key.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);
    return get(hooks.locale) ?? get(hooks.fallbackLocale);
  };
  liquid.registerFilter("t", (key: string, ...args: unknown[]) => {
    const v = lookup(String(key));
    if (typeof v !== "string") return `translation missing: ${key}`;
    const vars = named(args);
    return v.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => String(vars[k] ?? ""));
  });
  const money = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? `$${(v / 100).toFixed(2)}` : ""; };
  liquid.registerFilter("money", money);
  liquid.registerFilter("money_with_currency", (n: unknown) => `${money(n)} USD`);
  liquid.registerFilter("money_without_trailing_zeros", (n: unknown) => money(n).replace(/\.00$/, ""));
  liquid.registerFilter("money_without_currency", (n: unknown) => money(n).slice(1));
  liquid.registerFilter("asset_url", (name: string) => `__asset__/${name}`);
  liquid.registerFilter("asset_img_url", (name: string) => `__asset__/${name}`);
  liquid.registerFilter("file_url", (name: string) => `__asset__/${name}`);
  liquid.registerFilter("shopify_asset_url", (name: string) => `__asset__/${name}`);
  liquid.registerFilter("stylesheet_tag", (url: string) => (String(url).startsWith("__asset__/") ? `<style data-asset="${esc(String(url).slice(10))}">__inline__/${String(url).slice(10)}</style>` : `<link rel="stylesheet" href="${esc(url)}">`));
  liquid.registerFilter("script_tag", () => "");
  liquid.registerFilter("preload_tag", () => "");
  const src = (img: unknown): string => {
    if (!img) return "";
    if (typeof img === "string") return /^(shopify:|\/\/cdn)/.test(img) ? placeholderImage(img.split("/").pop() ?? "image").src : img;
    const o = img as Record<string, unknown>;
    return String(o.src ?? (o.featured_media as Record<string, unknown> | undefined)?.src ?? (o.preview_image as Record<string, unknown> | undefined)?.src ?? "");
  };
  liquid.registerFilter("image_url", (img: unknown) => src(img));
  liquid.registerFilter("img_url", (img: unknown) => src(img));
  liquid.registerFilter("product_img_url", (img: unknown) => src(img));
  liquid.registerFilter("image_tag", (url: string, ...args: unknown[]) => {
    const a = named(args);
    const attrs = Object.entries(a).filter(([k, v]) => v !== null && v !== undefined && !["widths", "preload"].includes(k)).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
    return `<img src="${esc(url)}"${"alt" in a ? "" : ' alt=""'}${attrs}>`;
  });
  liquid.registerFilter("placeholder_svg_tag", (name: string, cls?: string) => `<svg class="placeholder-svg ${esc(cls ?? "")}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 525 525" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;background:#e5e7eb"><rect width="525" height="525" fill="#e5e7eb"/><text x="262" y="270" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#9ca3af">${esc(name)}</text></svg>`);
  liquid.registerFilter("link_to", (text: string, url: string) => `<a href="${esc(url)}">${text}</a>`);
  liquid.registerFilter("within", (url: string) => url);
  liquid.registerFilter("handleize", (s: string) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, ""));
  liquid.registerFilter("handle", (s: string) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, ""));
  liquid.registerFilter("pluralize", (n: number, one: string, many: string) => (Number(n) === 1 ? one : many));
  for (const f of ["font_face", "font_url", "payment_type_svg_tag", "metafield_tag", "format_address", "structured_data", "default_pagination", "payment_button", "inline_asset_content", "highlight_active_tag", "time_tag"]) liquid.registerFilter(f, (v: unknown) => (f === "time_tag" ? String(v ?? "") : ""));
  for (const f of ["font_modify", "color_modify", "color_lighten", "color_darken", "color_saturate", "color_desaturate", "color_mix", "default_errors", "url_for_type", "url_for_vendor"]) liquid.registerFilter(f, (v: unknown) => v);
  liquid.registerFilter("color_to_rgb", (v: unknown) => v);
  return liquid;
}

/** font_picker 的值（如 assistant_n4）→ font 对象 */
export function fontObject(handle: string) {
  const m = /^(.+)_([nio])(\d)$/.exec(handle ?? "");
  const fam = (m?.[1] ?? handle ?? "sans-serif").split("_").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
  const serif = /serif|garamond|baskerville|playfair|lora|merriweather|georgia|times|crimson|libre_baskerville/i.test(handle) && !/sans/i.test(handle);
  return { family: fam, fallback_families: serif ? "serif" : "sans-serif", weight: m ? Number(m[3]) * 100 : 400, style: m?.[2] === "i" ? "italic" : "normal", system: false };
}
