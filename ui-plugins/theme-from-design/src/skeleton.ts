// Shopify Online Store 2.0 基础主题：layout + section groups + JSON 模板 + 常用 sections。
// Agent 按设计稿改 sections / CSS；这里的文件都能通过 theme-check。

export interface Brand {
  name: string;
  colors?: { background?: string; text?: string; accent?: string; accentText?: string; muted?: string };
  fonts?: { heading?: string; body?: string };
  radius?: number;
  width?: number;
}
export const DEFAULT_BRAND: Required<Pick<Brand, "colors" | "fonts" | "radius" | "width">> = {
  colors: { background: "#ffffff", text: "#1a1a1a", accent: "#1f4fd8", accentText: "#ffffff", muted: "#6b6b6b" },
  fonts: { heading: "assistant_n7", body: "assistant_n4" },
  radius: 6,
  width: 1200,
};

const schema = (o: unknown) => `{% schema %}\n${JSON.stringify(o, null, 2)}\n{% endschema %}\n`;

const LAYOUT = `<!doctype html>
<html class="no-js" lang="{{ request.locale.iso_code }}">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="canonical" href="{{ canonical_url }}">
    <title>{{ page_title }}{% if current_page != 1 %} &ndash; {{ 'general.page' | t: page: current_page }}{% endif %}{% unless page_title contains shop.name %} &ndash; {{ shop.name }}{% endunless %}</title>
    {% if page_description %}<meta name="description" content="{{ page_description | escape }}">{% endif %}
    {% render 'theme-styles' %}
    {{ 'base.css' | asset_url | stylesheet_tag }}
    {{ 'custom.css' | asset_url | stylesheet_tag }}
    {{ content_for_header }}
  </head>
  <body>
    <a class="skip-link" href="#MainContent">{{ 'accessibility.skip_to_content' | t }}</a>
    {% sections 'header-group' %}
    <main id="MainContent" role="main" tabindex="-1">
      {{ content_for_layout }}
    </main>
    {% sections 'footer-group' %}
  </body>
</html>
`;

const STYLES = `{%- liquid
  assign heading_font = settings.type_heading_font
  assign body_font = settings.type_body_font
-%}
<style>
  {{ heading_font | font_face: font_display: 'swap' }}
  {{ body_font | font_face: font_display: 'swap' }}
  :root {
    --color-background: {{ settings.color_background }};
    --color-text: {{ settings.color_text }};
    --color-accent: {{ settings.color_accent }};
    --color-accent-text: {{ settings.color_accent_text }};
    --color-muted: {{ settings.color_muted }};
    --font-heading: {{ heading_font.family }}, {{ heading_font.fallback_families }};
    --font-heading-weight: {{ heading_font.weight }};
    --font-body: {{ body_font.family }}, {{ body_font.fallback_families }};
    --radius: {{ settings.radius }}px;
    --page-width: {{ settings.page_width }}px;
  }
</style>
`;

const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--color-background);color:var(--color-text);font-family:var(--font-body);font-size:16px;line-height:1.6}
h1,h2,h3{font-family:var(--font-heading);font-weight:var(--font-heading-weight);line-height:1.2;margin:0 0 .5em}
a{color:inherit}
img{max-width:100%;height:auto;display:block}
.page-width{max-width:var(--page-width);margin:0 auto;padding:0 20px}
.skip-link{position:absolute;left:-9999px}.skip-link:focus{left:10px;top:10px;background:#fff;padding:8px;z-index:10}
.button{display:inline-block;padding:12px 28px;border-radius:var(--radius);background:var(--color-accent);color:var(--color-accent-text);text-decoration:none;border:0;font:inherit;cursor:pointer}
.button--secondary{background:transparent;color:var(--color-text);box-shadow:inset 0 0 0 1px currentColor}
.section{padding:56px 0}
.muted{color:var(--color-muted)}
.header{border-bottom:1px solid rgba(0,0,0,.08)}
.header__inner{display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:72px}
.header__logo{font-family:var(--font-heading);font-size:22px;text-decoration:none}
.header__menu{display:flex;gap:24px;list-style:none;margin:0;padding:0}
.header__menu a{text-decoration:none}
.announcement{background:var(--color-accent);color:var(--color-accent-text);text-align:center;font-size:14px;padding:8px}
.banner{position:relative;min-height:var(--banner-height,520px);display:flex;align-items:center;overflow:hidden;background:#eee}
.banner__media{position:absolute;inset:0}.banner__media img{width:100%;height:100%;object-fit:cover}
.banner__content{position:relative;width:100%}
.banner__box{max-width:560px}
.banner--center .banner__box{margin:0 auto;text-align:center}
.banner__overlay{position:absolute;inset:0;background:#000}
.banner--light{color:#fff}
.rich-text{text-align:center;max-width:760px;margin:0 auto}
.grid{display:grid;gap:24px;grid-template-columns:repeat(var(--cols,4),minmax(0,1fr))}
@media (max-width:749px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.header__menu{display:none}.split,.product{grid-template-columns:1fr!important;gap:24px}.section{padding:36px 0}}
.card{text-decoration:none;display:block}.card__media{aspect-ratio:1;background:#f3f3f3;border-radius:var(--radius);overflow:hidden}
.card__media img{width:100%;height:100%;object-fit:cover}.card__title{margin:12px 0 4px;font-size:16px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.split--reverse .split__media{order:2}
.footer{border-top:1px solid rgba(0,0,0,.08);padding:40px 0;font-size:14px}
.footer__cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:24px}
.footer ul{list-style:none;padding:0;margin:0}
.product{display:grid;grid-template-columns:1.2fr 1fr;gap:48px}
.price{font-size:20px}.price--compare{text-decoration:line-through;color:var(--color-muted);font-size:16px;margin-left:8px}
.field{display:block;margin:12px 0}.field select,.field input{font:inherit;padding:8px;border:1px solid #ccc;border-radius:var(--radius)}
.cart-table{width:100%;border-collapse:collapse}.cart-table td,.cart-table th{padding:12px;border-bottom:1px solid #eee;text-align:left}
.pagination{display:flex;gap:12px;justify-content:center;margin-top:32px}
`;

const SETTINGS_SCHEMA = (b: Brand) => [
  { name: "theme_info", theme_name: b.name, theme_version: "1.0.0", theme_author: b.name, theme_documentation_url: "https://help.shopify.com/manual/online-store/themes", theme_support_url: "https://help.shopify.com" },
  { name: "Colors", settings: [
    { type: "color", id: "color_background", label: "Background", default: b.colors!.background },
    { type: "color", id: "color_text", label: "Text", default: b.colors!.text },
    { type: "color", id: "color_accent", label: "Accent (buttons)", default: b.colors!.accent },
    { type: "color", id: "color_accent_text", label: "Button text", default: b.colors!.accentText },
    { type: "color", id: "color_muted", label: "Secondary text", default: b.colors!.muted },
  ] },
  { name: "Typography", settings: [
    { type: "font_picker", id: "type_heading_font", label: "Headings", default: b.fonts!.heading },
    { type: "font_picker", id: "type_body_font", label: "Body", default: b.fonts!.body },
  ] },
  { name: "Layout", settings: [
    { type: "range", id: "page_width", label: "Page width", min: 1000, max: 1600, step: 100, unit: "px", default: b.width },
    { type: "range", id: "radius", label: "Corner radius", min: 0, max: 20, step: 1, unit: "px", default: b.radius },
  ] },
];

const settingsData = (b: Brand) => ({
  current: {
    color_background: b.colors!.background, color_text: b.colors!.text, color_accent: b.colors!.accent, color_accent_text: b.colors!.accentText, color_muted: b.colors!.muted,
    type_heading_font: b.fonts!.heading, type_body_font: b.fonts!.body, page_width: b.width, radius: b.radius,
  },
});

const LOCALE_EN = {
  general: { page: "Page {{ page }}", search: "Search", menu: "Menu", view_all: "View all", previous: "Previous", next: "Next" },
  accessibility: { skip_to_content: "Skip to content" },
  products: { add_to_cart: "Add to cart", sold_out: "Sold out", quantity: "Quantity", no_products: "No products in this collection yet." },
  cart: { title: "Your cart", empty: "Your cart is empty", checkout: "Check out", subtotal: "Subtotal", remove: "Remove", product: "Product", total: "Total", continue: "Continue shopping" },
  search: { title: "Search", results: "{{ count }} results for “{{ terms }}”", no_results: "No results for “{{ terms }}”" },
  not_found: { title: "Page not found", text: "The page you were looking for does not exist.", back: "Continue shopping" },
};
const LOCALE_ZH = {
  general: { page: "第 {{ page }} 页", search: "搜索", menu: "菜单", view_all: "查看全部", previous: "上一页", next: "下一页" },
  accessibility: { skip_to_content: "跳到内容" },
  products: { add_to_cart: "加入购物车", sold_out: "已售罄", quantity: "数量", no_products: "这个系列还没有商品。" },
  cart: { title: "购物车", empty: "购物车是空的", checkout: "去结账", subtotal: "小计", remove: "移除", product: "商品", total: "合计", continue: "继续购物" },
  search: { title: "搜索", results: "“{{ terms }}”共 {{ count }} 个结果", no_results: "没有找到“{{ terms }}”" },
  not_found: { title: "页面不存在", text: "你要找的页面不存在。", back: "继续购物" },
};

const SECTIONS: Record<string, string> = {
  "announcement-bar": `{%- if section.settings.text != blank -%}
<div class="announcement">
  {%- if section.settings.link != blank -%}<a href="{{ section.settings.link }}">{{ section.settings.text | escape }}</a>{%- else -%}{{ section.settings.text | escape }}{%- endif -%}
</div>
{%- endif -%}
` + schema({ name: "Announcement bar", tag: "section", class: "section-announcement", settings: [{ type: "text", id: "text", label: "Text", default: "Free shipping on orders over $50" }, { type: "url", id: "link", label: "Link" }], presets: [{ name: "Announcement bar" }], enabled_on: { groups: ["header"] } }),
  header: `<header class="header">
  <div class="page-width header__inner">
    <a href="{{ routes.root_url }}" class="header__logo">
      {%- if section.settings.logo != blank -%}
        {{ section.settings.logo | image_url: width: 300 | image_tag: width: section.settings.logo_width, height: null, alt: shop.name, style: 'height:auto' }}
      {%- else -%}
        {{ shop.name }}
      {%- endif -%}
    </a>
    <nav aria-label="{{ 'general.menu' | t }}">
      <ul class="header__menu">
        {%- for link in section.settings.menu.links -%}
          <li><a href="{{ link.url }}"{% if link.active %} aria-current="page"{% endif %}>{{ link.title | escape }}</a></li>
        {%- endfor -%}
      </ul>
    </nav>
    <a href="{{ routes.cart_url }}" class="header__cart">{{ 'cart.title' | t }} ({{ cart.item_count }})</a>
  </div>
</header>
` + schema({ name: "Header", tag: "div", class: "section-header", settings: [{ type: "image_picker", id: "logo", label: "Logo" }, { type: "range", id: "logo_width", label: "Logo width", min: 50, max: 300, step: 10, unit: "px", default: 120 }, { type: "link_list", id: "menu", label: "Menu", default: "main-menu" }], enabled_on: { groups: ["header"] } }),
  footer: `<footer class="footer">
  <div class="page-width">
    <div class="footer__cols">
      {%- for block in section.blocks -%}
        <div {{ block.shopify_attributes }}>
          {%- case block.type -%}
            {%- when 'text' -%}
              <h3>{{ block.settings.heading | escape }}</h3>
              {{ block.settings.text }}
            {%- when 'menu' -%}
              <h3>{{ block.settings.menu.title | escape }}</h3>
              <ul>
                {%- for link in block.settings.menu.links -%}<li><a href="{{ link.url }}">{{ link.title | escape }}</a></li>{%- endfor -%}
              </ul>
          {%- endcase -%}
        </div>
      {%- endfor -%}
    </div>
    <p class="muted">&copy; {{ 'now' | date: '%Y' }} {{ shop.name | link_to: routes.root_url }}</p>
  </div>
</footer>
` + schema({ name: "Footer", tag: "div", class: "section-footer", max_blocks: 4, blocks: [{ type: "text", name: "Text", settings: [{ type: "text", id: "heading", label: "Heading", default: "About us" }, { type: "richtext", id: "text", label: "Text", default: "<p>Tell customers about your brand.</p>" }] }, { type: "menu", name: "Menu", settings: [{ type: "link_list", id: "menu", label: "Menu", default: "footer" }] }], enabled_on: { groups: ["footer"] } }),
  "image-banner": `{%- style -%}
  #Banner-{{ section.id }} { --banner-height: {{ section.settings.height }}px; }
  #Banner-{{ section.id }} .banner__overlay { opacity: {{ section.settings.overlay | divided_by: 100.0 }}; }
{%- endstyle -%}
<div id="Banner-{{ section.id }}" class="banner banner--{{ section.settings.alignment }}{% if section.settings.light_text %} banner--light{% endif %}">
  <div class="banner__media">
    {%- if section.settings.image != blank -%}
      {{ section.settings.image | image_url: width: 2400 | image_tag: widths: '750, 1100, 1500, 2400', sizes: '100vw', loading: 'eager', alt: section.settings.image.alt }}
    {%- else -%}
      {{ 'lifestyle-1' | placeholder_svg_tag }}
    {%- endif -%}
  </div>
  <div class="banner__overlay"></div>
  <div class="banner__content page-width">
    <div class="banner__box">
      {%- for block in section.blocks -%}
        {%- case block.type -%}
          {%- when 'heading' -%}<h1 {{ block.shopify_attributes }} style="font-size: {{ block.settings.size }}px">{{ block.settings.heading | escape }}</h1>
          {%- when 'text' -%}<div {{ block.shopify_attributes }}>{{ block.settings.text }}</div>
          {%- when 'button' -%}<a {{ block.shopify_attributes }} class="button{% if block.settings.secondary %} button--secondary{% endif %}" href="{{ block.settings.link | default: routes.all_products_collection_url }}">{{ block.settings.label | escape }}</a>
        {%- endcase -%}
      {%- endfor -%}
    </div>
  </div>
</div>
` + schema({ name: "Image banner", tag: "section", class: "section-banner", settings: [
    { type: "image_picker", id: "image", label: "Image" },
    { type: "range", id: "height", label: "Height", min: 300, max: 900, step: 20, unit: "px", default: 520 },
    { type: "range", id: "overlay", label: "Overlay opacity", min: 0, max: 80, step: 5, unit: "%", default: 20 },
    { type: "select", id: "alignment", label: "Alignment", options: [{ value: "left", label: "Left" }, { value: "center", label: "Center" }], default: "left" },
    { type: "checkbox", id: "light_text", label: "Light text", default: true },
  ], blocks: [
    { type: "heading", name: "Heading", limit: 1, settings: [{ type: "text", id: "heading", label: "Heading", default: "Image banner" }, { type: "range", id: "size", label: "Size", min: 24, max: 72, step: 2, unit: "px", default: 48 }] },
    { type: "text", name: "Text", limit: 1, settings: [{ type: "richtext", id: "text", label: "Text", default: "<p>Give customers details about the banner image(s) or content on the template.</p>" }] },
    { type: "button", name: "Button", limit: 2, settings: [{ type: "text", id: "label", label: "Label", default: "Shop now" }, { type: "url", id: "link", label: "Link" }, { type: "checkbox", id: "secondary", label: "Outline style", default: false }] },
  ], presets: [{ name: "Image banner", blocks: [{ type: "heading" }, { type: "text" }, { type: "button" }] }] }),
  "rich-text": `<div class="section">
  <div class="page-width rich-text">
    {%- if section.settings.heading != blank -%}<h2>{{ section.settings.heading | escape }}</h2>{%- endif -%}
    {{ section.settings.text }}
    {%- if section.settings.button_label != blank -%}<a class="button" href="{{ section.settings.button_link }}">{{ section.settings.button_label | escape }}</a>{%- endif -%}
  </div>
</div>
` + schema({ name: "Rich text", tag: "section", class: "section-rich-text", settings: [{ type: "text", id: "heading", label: "Heading", default: "Talk about your brand" }, { type: "richtext", id: "text", label: "Text", default: "<p>Share information about your brand with your customers.</p>" }, { type: "text", id: "button_label", label: "Button label" }, { type: "url", id: "button_link", label: "Button link" }], presets: [{ name: "Rich text" }] }),
  "image-with-text": `<div class="section">
  <div class="page-width split{% if section.settings.image_right %} split--reverse{% endif %}">
    <div class="split__media">
      {%- if section.settings.image != blank -%}
        {{ section.settings.image | image_url: width: 1200 | image_tag: widths: '600, 900, 1200', sizes: '(min-width: 750px) 50vw, 100vw', alt: section.settings.image.alt }}
      {%- else -%}
        {{ 'image' | placeholder_svg_tag }}
      {%- endif -%}
    </div>
    <div>
      <h2>{{ section.settings.heading | escape }}</h2>
      {{ section.settings.text }}
      {%- if section.settings.button_label != blank -%}<a class="button" href="{{ section.settings.button_link }}">{{ section.settings.button_label | escape }}</a>{%- endif -%}
    </div>
  </div>
</div>
` + schema({ name: "Image with text", tag: "section", class: "section-image-text", settings: [{ type: "image_picker", id: "image", label: "Image" }, { type: "checkbox", id: "image_right", label: "Image on the right", default: false }, { type: "text", id: "heading", label: "Heading", default: "Image with text" }, { type: "richtext", id: "text", label: "Text", default: "<p>Pair text with an image to focus on your chosen product, collection, or blog post.</p>" }, { type: "text", id: "button_label", label: "Button label", default: "Learn more" }, { type: "url", id: "button_link", label: "Button link" }], presets: [{ name: "Image with text" }] }),
  "featured-collection": `<div class="section">
  <div class="page-width">
    <h2>{{ section.settings.heading | escape }}</h2>
    <div class="grid" style="--cols: {{ section.settings.columns }}">
      {%- for product in section.settings.collection.products limit: section.settings.limit -%}
        {% render 'product-card', product: product %}
      {%- else -%}
        {%- for i in (1..section.settings.limit) -%}
          <div class="card"><div class="card__media">{{ 'product-1' | placeholder_svg_tag }}</div><p class="card__title">Product title</p><p class="muted">{{ 1999 | money }}</p></div>
        {%- endfor -%}
      {%- endfor -%}
    </div>
    {%- if section.settings.collection != blank -%}<p><a href="{{ section.settings.collection.url }}">{{ 'general.view_all' | t }}</a></p>{%- endif -%}
  </div>
</div>
` + schema({ name: "Featured collection", tag: "section", class: "section-featured-collection", settings: [{ type: "text", id: "heading", label: "Heading", default: "Featured collection" }, { type: "collection", id: "collection", label: "Collection" }, { type: "range", id: "limit", label: "Products to show", min: 2, max: 12, step: 1, default: 4 }, { type: "range", id: "columns", label: "Columns on desktop", min: 2, max: 5, step: 1, default: 4 }], presets: [{ name: "Featured collection" }] }),
  "main-product": `<div class="section">
  <div class="page-width product">
    <div>
      {%- if product.featured_media -%}
        {{ product.featured_media | image_url: width: 1200 | image_tag: widths: '600, 900, 1200', sizes: '(min-width: 750px) 55vw, 100vw', alt: product.featured_media.alt }}
      {%- else -%}
        {{ 'product-1' | placeholder_svg_tag }}
      {%- endif -%}
    </div>
    <div>
      <h1>{{ product.title | escape }}</h1>
      <p class="price">{{ product.selected_or_first_available_variant.price | money }}{% if product.compare_at_price > product.price %}<span class="price--compare">{{ product.compare_at_price | money }}</span>{% endif %}</p>
      {%- form 'product', product -%}
        {%- unless product.has_only_default_variant -%}
          <label class="field">{{ product.options.first | escape }}
            <select name="id">
              {%- for variant in product.variants -%}<option value="{{ variant.id }}"{% if variant == product.selected_or_first_available_variant %} selected{% endif %}{% unless variant.available %} disabled{% endunless %}>{{ variant.title | escape }}</option>{%- endfor -%}
            </select>
          </label>
        {%- else -%}
          <input type="hidden" name="id" value="{{ product.selected_or_first_available_variant.id }}">
        {%- endunless -%}
        <label class="field">{{ 'products.quantity' | t }} <input type="number" name="quantity" value="1" min="1"></label>
        <button type="submit" class="button"{% unless product.available %} disabled{% endunless %}>{% if product.available %}{{ 'products.add_to_cart' | t }}{% else %}{{ 'products.sold_out' | t }}{% endif %}</button>
      {%- endform -%}
      <div class="product__description">{{ product.description }}</div>
    </div>
  </div>
</div>
` + schema({ name: "Product information", tag: "section", class: "section-main-product", settings: [] }),
  "main-collection": `<div class="section">
  <div class="page-width">
    <h1>{{ collection.title | escape }}</h1>
    {%- if collection.description != blank -%}<div class="muted">{{ collection.description }}</div>{%- endif -%}
    {%- paginate collection.products by section.settings.per_page -%}
      <div class="grid" style="--cols: {{ section.settings.columns }}">
        {%- for product in collection.products -%}
          {% render 'product-card', product: product %}
        {%- else -%}
          <p>{{ 'products.no_products' | t }}</p>
        {%- endfor -%}
      </div>
      {%- if paginate.pages > 1 -%}
        <nav class="pagination">
          {%- if paginate.previous -%}<a href="{{ paginate.previous.url }}">{{ 'general.previous' | t }}</a>{%- endif -%}
          <span>{{ paginate.current_page }} / {{ paginate.pages }}</span>
          {%- if paginate.next -%}<a href="{{ paginate.next.url }}">{{ 'general.next' | t }}</a>{%- endif -%}
        </nav>
      {%- endif -%}
    {%- endpaginate -%}
  </div>
</div>
` + schema({ name: "Product grid", tag: "section", class: "section-main-collection", settings: [{ type: "range", id: "per_page", label: "Products per page", min: 8, max: 48, step: 4, default: 16 }, { type: "range", id: "columns", label: "Columns on desktop", min: 2, max: 5, step: 1, default: 4 }] }),
  "main-page": `<div class="section">
  <div class="page-width rich-text">
    <h1>{{ page.title | escape }}</h1>
    {{ page.content }}
  </div>
</div>
` + schema({ name: "Page", tag: "section", class: "section-main-page", settings: [] }),
  "main-cart": `<div class="section">
  <div class="page-width">
    <h1>{{ 'cart.title' | t }}</h1>
    {%- if cart.item_count > 0 -%}
      <form action="{{ routes.cart_url }}" method="post">
        <table class="cart-table">
          <thead><tr><th>{{ 'cart.product' | t }}</th><th>{{ 'products.quantity' | t }}</th><th>{{ 'cart.total' | t }}</th></tr></thead>
          <tbody>
            {%- for item in cart.items -%}
              <tr>
                <td><a href="{{ item.url }}">{{ item.product.title | escape }}</a>{% unless item.product.has_only_default_variant %}<br><span class="muted">{{ item.variant.title | escape }}</span>{% endunless %}</td>
                <td><input type="number" name="updates[]" value="{{ item.quantity }}" min="0" aria-label="{{ 'products.quantity' | t }}"> <a href="{{ item.url_to_remove }}">{{ 'cart.remove' | t }}</a></td>
                <td>{{ item.final_line_price | money }}</td>
              </tr>
            {%- endfor -%}
          </tbody>
        </table>
        <p class="price">{{ 'cart.subtotal' | t }}: {{ cart.total_price | money }}</p>
        <button type="submit" name="checkout" class="button">{{ 'cart.checkout' | t }}</button>
      </form>
    {%- else -%}
      <p>{{ 'cart.empty' | t }}</p>
      <a class="button" href="{{ routes.all_products_collection_url }}">{{ 'cart.continue' | t }}</a>
    {%- endif -%}
  </div>
</div>
` + schema({ name: "Cart", tag: "section", class: "section-main-cart", settings: [] }),
  "main-404": `<div class="section">
  <div class="page-width rich-text">
    <h1>{{ 'not_found.title' | t }}</h1>
    <p>{{ 'not_found.text' | t }}</p>
    <a class="button" href="{{ routes.all_products_collection_url }}">{{ 'not_found.back' | t }}</a>
  </div>
</div>
` + schema({ name: "404 page", tag: "section", class: "section-404", settings: [] }),
  "main-search": `<div class="section">
  <div class="page-width">
    <h1>{{ 'search.title' | t }}</h1>
    <form action="{{ routes.search_url }}" method="get" role="search">
      <input type="search" name="q" value="{{ search.terms | escape }}" aria-label="{{ 'general.search' | t }}">
      <button type="submit" class="button">{{ 'general.search' | t }}</button>
    </form>
    {%- if search.performed -%}
      {%- if search.results_count > 0 -%}
        <p>{{ 'search.results' | t: count: search.results_count, terms: search.terms }}</p>
        <div class="grid">
          {%- for item in search.results -%}
            {%- if item.object_type == 'product' -%}{% render 'product-card', product: item %}{%- else -%}<a class="card" href="{{ item.url }}"><p class="card__title">{{ item.title | escape }}</p></a>{%- endif -%}
          {%- endfor -%}
        </div>
      {%- else -%}
        <p>{{ 'search.no_results' | t: terms: search.terms }}</p>
      {%- endif -%}
    {%- endif -%}
  </div>
</div>
` + schema({ name: "Search results", tag: "section", class: "section-main-search", settings: [] }),
};

const SNIPPETS: Record<string, string> = {
  "product-card": `{%- comment -%}
  Product card. Usage: {% render 'product-card', product: product %}
{%- endcomment -%}
<a class="card" href="{{ product.url }}">
  <div class="card__media">
    {%- if product.featured_media -%}
      {{ product.featured_media | image_url: width: 600 | image_tag: widths: '300, 450, 600', sizes: '(min-width: 750px) 25vw, 50vw', loading: 'lazy', alt: product.featured_media.alt }}
    {%- else -%}
      {{ 'product-1' | placeholder_svg_tag }}
    {%- endif -%}
  </div>
  <p class="card__title">{{ product.title | escape }}</p>
  <p class="muted">{{ product.price | money }}{% if product.compare_at_price > product.price %} <s>{{ product.compare_at_price | money }}</s>{% endif %}</p>
</a>
`,
  "theme-styles": STYLES,
};

const group = (type: "header" | "footer", sections: Record<string, unknown>, order: string[]) => ({ type, name: type === "header" ? "Header" : "Footer", sections, order });
const tpl = (main: string, extra?: Record<string, unknown>) => ({ sections: { main: { type: main, settings: {} }, ...(extra ?? {}) }, order: ["main", ...Object.keys(extra ?? {})] });

export function skeleton(brand: Brand): Record<string, string> {
  const b: Brand = { ...brand, colors: { ...DEFAULT_BRAND.colors, ...brand.colors }, fonts: { ...DEFAULT_BRAND.fonts, ...brand.fonts }, radius: brand.radius ?? DEFAULT_BRAND.radius, width: brand.width ?? DEFAULT_BRAND.width };
  const j = (o: unknown) => JSON.stringify(o, null, 2) + "\n";
  const files: Record<string, string> = {
    "layout/theme.liquid": LAYOUT,
    "assets/base.css": BASE_CSS,
    "assets/custom.css": "/* Styles for this design. Loaded after base.css. */\n",
    "config/settings_schema.json": j(SETTINGS_SCHEMA(b)),
    "config/settings_data.json": j(settingsData(b)),
    "locales/en.default.json": j(LOCALE_EN),
    "locales/zh-CN.json": j(LOCALE_ZH),
    "sections/header-group.json": j(group("header", { announcement: { type: "announcement-bar", settings: {} }, header: { type: "header", settings: {} } }, ["announcement", "header"])),
    "sections/footer-group.json": j(group("footer", { footer: { type: "footer", blocks: { about: { type: "text", settings: {} }, links: { type: "menu", settings: {} } }, block_order: ["about", "links"], settings: {} } }, ["footer"])),
    "templates/index.json": j({ sections: { banner: { type: "image-banner", blocks: { heading: { type: "heading", settings: {} }, text: { type: "text", settings: {} }, button: { type: "button", settings: {} } }, block_order: ["heading", "text", "button"], settings: {} }, intro: { type: "rich-text", settings: {} }, featured: { type: "featured-collection", settings: { collection: "frontpage" } } }, order: ["banner", "intro", "featured"] }),
    "templates/product.json": j(tpl("main-product")),
    "templates/collection.json": j(tpl("main-collection")),
    "templates/page.json": j(tpl("main-page")),
    "templates/cart.json": j(tpl("main-cart")),
    "templates/404.json": j(tpl("main-404")),
    "templates/search.json": j(tpl("main-search")),
  };
  for (const [k, v] of Object.entries(SECTIONS)) files[`sections/${k}.liquid`] = v;
  for (const [k, v] of Object.entries(SNIPPETS)) files[`snippets/${k}.liquid`] = v;
  return files;
}
