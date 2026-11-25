// 预览用的样例店铺数据（虚构）。图片是内联 SVG，不联网。
const svg = (w: number, h: number, bg: string, fg: string, label: string, shape = "circle") => {
  const s = shape === "circle" ? `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="${fg}" opacity=".85"/>` : `<rect x="${w * 0.3}" y="${h * 0.25}" width="${w * 0.4}" height="${h * 0.5}" rx="${w * 0.04}" fill="${fg}" opacity=".85"/>`;
  const text = label ? `<text x="${w / 2}" y="${h - 24}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(w / 22)}" fill="${fg}">${label}</text>` : "";
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${bg}"/>${s}${text}</svg>`).toString("base64")}`;
};
export const image = (src: string, alt: string, width = 800, height = 800) => ({ src, alt, width, height, aspect_ratio: width / height, media_type: "image", id: Math.abs(hash(src)) });
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
export const placeholderImage = (label: string, width = 1600, height = 900) => image(svg(width, height, "#d9dde3", "#9aa3ad", label, "rect"), label, width, height);

const PRODUCTS: [string, string, number, number | null, string, string][] = [
  ["Linen Shirt", "linen-shirt", 5900, 7900, "#e8e1d5", "#a48d6a"],
  ["Canvas Tote", "canvas-tote", 2800, null, "#dfe8e1", "#5f8a6c"],
  ["Ceramic Mug", "ceramic-mug", 1800, null, "#e3e6ef", "#5869a3"],
  ["Wool Beanie", "wool-beanie", 2400, 3200, "#efe0e0", "#b25b5b"],
  ["Leather Wallet", "leather-wallet", 4500, null, "#eadfd6", "#8a5a3c"],
  ["Cotton Socks", "cotton-socks", 1200, null, "#f2eedc", "#b69a2e"],
  ["Desk Lamp", "desk-lamp", 8900, 9900, "#e2e2e2", "#444444"],
  ["Notebook Set", "notebook-set", 1600, null, "#dde9ef", "#3d7d9a"],
];
let vid = 4000;
export const products = PRODUCTS.map(([title, handle, price, compare, bg, fg], i) => {
  const img = image(svg(800, 800, bg, fg, title, i % 2 ? "rect" : "circle"), title);
  const sizes = i % 3 === 0 ? ["S", "M", "L"] : [];
  const variants = sizes.length ? sizes.map((s, k) => ({ id: ++vid, title: s, price, available: k !== 2, compare_at_price: compare })) : [{ id: ++vid, title: "Default Title", price, available: true, compare_at_price: compare }];
  return {
    id: 1000 + i, handle, title, url: `/products/${handle}`, price, price_min: price, price_max: price, compare_at_price: compare, available: true, vendor: "Sample Store", type: "Goods",
    description: `<p>${title} — a fictional sample product used for the theme preview. Made with care, built to last.</p>`,
    featured_media: img, featured_image: img, images: [img], media: [img], options: sizes.length ? ["Size"] : ["Title"], has_only_default_variant: !sizes.length,
    variants, selected_or_first_available_variant: variants[0], first_available_variant: variants[0], tags: [], object_type: "product",
  };
});
const coll = (handle: string, title: string, items: typeof products) => ({ id: hash(handle), handle, title, url: `/collections/${handle}`, products: items, products_count: items.length, all_products_count: items.length, description: `<p>Sample collection “${title}”.</p>`, image: items[0]?.featured_media, featured_image: items[0]?.featured_media });
export const collections: Record<string, ReturnType<typeof coll>> = {
  all: coll("all", "All products", products),
  frontpage: coll("frontpage", "Home page", products.slice(0, 8)),
  "new-arrivals": coll("new-arrivals", "New arrivals", products.slice(2, 6)),
};
const link = (title: string, url: string) => ({ title, url, active: false, links: [], handle: title.toLowerCase().replace(/\W+/g, "-") });
export const menus: Record<string, { handle: string; title: string; links: ReturnType<typeof link>[] }> = {
  "main-menu": { handle: "main-menu", title: "Main menu", links: [link("Home", "/"), link("Shop", "/collections/all"), link("New arrivals", "/collections/new-arrivals"), link("About", "/pages/about")] },
  footer: { handle: "footer", title: "Quick links", links: [link("Search", "/search"), link("Shipping", "/pages/shipping"), link("Contact", "/pages/contact")] },
};
export const pages: Record<string, unknown> = {
  about: { id: 1, handle: "about", title: "About us", url: "/pages/about", content: "<p>We are a small, fictional shop used to preview this theme. Everything here is sample content.</p>" },
};
export const shop = { name: "Sample Store", currency: "USD", money_format: "${{amount}}", url: "https://example.myshopify.com", domain: "example.myshopify.com", description: "A fictional store for theme previews." };
export const cart = (() => {
  const items = [products[0], products[2]].map((p, i) => ({ product: p, variant: p.variants[0], title: p.title, quantity: i + 1, url: p.url, url_to_remove: "/cart/change?line=" + (i + 1) + "&quantity=0", final_line_price: p.price * (i + 1), price: p.price, image: p.featured_media }));
  return { item_count: 3, items, total_price: items.reduce((s, x) => s + x.final_line_price, 0), currency: { iso_code: "USD" } };
})();
export const routes = { root_url: "/", account_url: "/account", cart_url: "/cart", search_url: "/search", all_products_collection_url: "/collections/all", collections_url: "/collections", predictive_search_url: "/search/suggest" };
