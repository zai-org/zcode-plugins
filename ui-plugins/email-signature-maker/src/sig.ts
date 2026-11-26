export interface Person { name: string; nameEn: string; title: string; titleEn: string; dept: string; mobile: string; phone: string; email: string; wechat: string; extra: string }
export interface SigOpts {
  company: string; companyEn: string; website: string; address: string; logo: string; logoWidth: number;
  template: "classic" | "side" | "compact"; accent: string; socials: { label: string; url: string }[]; disclaimer: string; bilingual: boolean;
}

export const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const url = (u: string) => (/^(https?:|mailto:|tel:)/i.test(u) ? u : `https://${u}`);
const FONT = "font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif";

/** 解析社交链接：每行或逗号分隔一条，“名称 网址” 或 “名称|网址”。 */
export function parseSocials(text: string): { label: string; url: string }[] {
  return String(text ?? "").split(/[\n,，;；]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^(.+?)\s*[|｜:：\s]\s*((?:https?:\/\/)?[\w.-]+\.[a-z]{2,}\S*)$/i.exec(s);
    if (m) return { label: m[1].trim(), url: url(m[2]) };
    const host = s.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].replace(/^www\./, "");
    return { label: host, url: url(s) };
  });
}

function contactBits(p: Person, o: SigOpts) {
  const b = o.bilingual;
  const bits: { k: string; v: string; href?: string }[] = [];
  if (p.mobile) bits.push({ k: b ? "M" : "手机", v: p.mobile, href: `tel:${p.mobile.replace(/[^\d+]/g, "")}` });
  if (p.phone) bits.push({ k: b ? "T" : "电话", v: p.phone, href: `tel:${p.phone.replace(/[^\d+]/g, "")}` });
  if (p.email) bits.push({ k: b ? "E" : "邮箱", v: p.email, href: `mailto:${p.email}` });
  if (p.wechat) bits.push({ k: b ? "WeChat" : "微信", v: p.wechat });
  if (o.website) bits.push({ k: b ? "W" : "网址", v: o.website.replace(/^https?:\/\//i, ""), href: url(o.website) });
  return bits;
}

const a = (text: string, href: string | undefined, color: string) => (href ? `<a href="${h(href)}" style="color:${color};text-decoration:none">${h(text)}</a>` : h(text));

/** 生成一个人的签名 HTML 片段（表格布局 + 内联样式，适配 Outlook/Gmail/Apple Mail）。 */
export function signatureHtml(p: Person, o: SigOpts): string {
  const ac = o.accent;
  const nameLine = `<span style="font-size:16px;font-weight:bold;color:#111827">${h(p.name)}</span>${o.bilingual && p.nameEn ? ` <span style="font-size:13px;color:#6b7280">${h(p.nameEn)}</span>` : ""}`;
  const titleTxt = [p.title, p.dept].filter(Boolean).join(" · ");
  const titleLine = `${titleTxt ? `<span style="color:${ac}">${h(titleTxt)}</span>` : ""}${o.bilingual && p.titleEn ? `${titleTxt ? `<span style="color:#9ca3af"> | </span>` : ""}<span style="color:#6b7280">${h(p.titleEn)}</span>` : ""}`;
  const comp = `${o.company ? `<b style="color:#111827">${h(o.company)}</b>` : ""}${o.bilingual && o.companyEn ? `${o.company ? " " : ""}<span style="color:#6b7280">${h(o.companyEn)}</span>` : ""}`;
  const bits = contactBits(p, o);
  const contacts = bits.map((x) => `<span style="color:${ac};font-weight:bold">${h(x.k)}</span>&nbsp;${a(x.v, x.href, "#374151")}`).join(`<span style="color:#d1d5db">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`);
  const social = o.socials.length ? o.socials.map((s) => a(s.label, s.url, ac)).join(`<span style="color:#d1d5db">&nbsp;·&nbsp;</span>`) : "";
  const logo = o.logo ? `<img src="${h(o.logo)}" width="${o.logoWidth}" alt="${h(o.company || "logo")}" style="display:block;border:0;width:${o.logoWidth}px;height:auto">` : "";
  const td = (inner: string, extra = "") => `<tr><td style="padding:1px 0;${extra}">${inner}</td></tr>`;
  const disclaimer = o.disclaimer ? `<tr><td colspan="3" style="padding-top:10px;font-size:10px;line-height:1.4;color:#9ca3af">${h(o.disclaimer)}</td></tr>` : "";
  const extra = p.extra ? td(`<span style="color:#6b7280">${h(p.extra)}</span>`) : "";
  let body: string;
  if (o.template === "compact") {
    body = `<tr><td style="${FONT};font-size:12px;line-height:1.5;color:#374151">${nameLine}${titleLine ? `<span style="color:#d1d5db"> &nbsp;|&nbsp; </span>${titleLine}` : ""}${comp ? `<span style="color:#d1d5db"> &nbsp;|&nbsp; </span>${comp}` : ""}<br>${contacts}${social ? `<br>${social}` : ""}${p.extra ? `<br><span style="color:#6b7280">${h(p.extra)}</span>` : ""}</td></tr>${disclaimer.replace('colspan="3"', "")}`;
  } else if (o.template === "side") {
    const addr = o.address ? td(`<span style="color:#6b7280">${h(o.address)}</span>`) : "";
    body = `<tr>${logo ? `<td valign="middle" style="padding-right:14px">${logo}</td><td style="border-left:2px solid ${ac};padding-right:14px">&nbsp;</td>` : `<td style="border-left:3px solid ${ac};padding-right:12px">&nbsp;</td>`}<td valign="middle" style="${FONT};font-size:12px;line-height:1.5;color:#374151"><table cellpadding="0" cellspacing="0" border="0" role="presentation">${td(nameLine)}${titleLine ? td(titleLine) : ""}${comp ? td(comp, "padding-top:4px") : ""}${td(contacts, "padding-top:2px")}${addr}${extra}${social ? td(social, "padding-top:4px") : ""}</table></td></tr>${disclaimer}`;
  } else {
    const addr = o.address ? td(`<span style="color:#6b7280">${h(o.address)}</span>`) : "";
    body = `<tr><td style="${FONT};font-size:12px;line-height:1.5;color:#374151"><table cellpadding="0" cellspacing="0" border="0" role="presentation">${td(nameLine)}${titleLine ? td(titleLine) : ""}${td(`<div style="width:48px;border-top:2px solid ${ac};margin:6px 0 4px;font-size:0;line-height:0">&nbsp;</div>`)}${logo ? td(logo, "padding:4px 0") : ""}${comp ? td(comp) : ""}${td(contacts)}${addr}${extra}${social ? td(social, "padding-top:4px") : ""}</table></td></tr>${disclaimer.replace('colspan="3"', "")}`;
  }
  return `<!-- signature: ${h(p.name)} -->\n<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="${FONT};font-size:12px;color:#374151;border-collapse:collapse">${body}</table>`;
}

/** 纯文本版签名（用于不支持 HTML 的客户端）。 */
export function signatureText(p: Person, o: SigOpts): string {
  const L = ["--", [p.name, o.bilingual ? p.nameEn : ""].filter(Boolean).join("  ")];
  const t = [[p.title, p.dept].filter(Boolean).join(" · "), o.bilingual ? p.titleEn : ""].filter(Boolean).join(" | ");
  if (t) L.push(t);
  const c = [o.company, o.bilingual ? o.companyEn : ""].filter(Boolean).join(" ");
  if (c) L.push(c);
  for (const b of contactBits(p, o)) L.push(`${b.k}: ${b.v}`);
  if (o.address) L.push(o.address);
  if (p.extra) L.push(p.extra);
  for (const s of o.socials) L.push(`${s.label}: ${s.url}`);
  if (o.disclaimer) L.push("", o.disclaimer);
  return L.join("\n") + "\n";
}

export function standalone(p: Person, o: SigOpts): string {
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>${h(p.name)} — signature</title></head><body style="margin:16px">\n${signatureHtml(p, o)}\n</body></html>\n`;
}

/** 预览 / 安装说明页：所有人的签名，带复制提示。 */
export function indexHtml(people: { p: Person; file: string }[], o: SigOpts): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(o.company || "Email signatures")} — 邮件签名</title>
<style>body{margin:0;background:#f3f4f6;font:14px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937}main{max-width:820px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 6px}.tip{color:#6b7280;margin:0 0 18px}.card{background:#fff;border-radius:10px;padding:18px 20px;margin:0 0 14px;box-shadow:0 1px 3px #0001}
.who{display:flex;justify-content:space-between;align-items:center;color:#6b7280;font-size:12px;margin-bottom:10px;border-bottom:1px solid #f1f5f9;padding-bottom:8px}.who a{color:${o.accent}}
details{margin-top:18px;color:#4b5563}summary{cursor:pointer;font-weight:600}</style></head><body><main>
<h1>${h(o.company || "邮件签名")} · ${people.length} 份邮件签名 / signatures</h1>
<p class="tip">在浏览器里打开对应的 .html 文件，全选（Ctrl/⌘+A）复制，粘贴到邮箱的签名设置里。Open a person's .html, select all, copy, and paste it into your mail app's signature settings.</p>
${people.map(({ p, file }) => `<section class="card"><div class="who"><span>${h(p.name)}${p.email ? ` · ${h(p.email)}` : ""}</span><a href="${h(file)}">${h(file)}</a></div>\n${signatureHtml(p, o)}\n</section>`).join("\n")}
<details><summary>怎么设置 / How to install</summary><ul>
<li>Gmail：设置 → 查看所有设置 → 常规 → 签名，粘贴。Settings → See all settings → General → Signature.</li>
<li>Outlook：设置 → 邮件 → 撰写和答复 → 电子邮件签名，粘贴。Settings → Mail → Compose and reply.</li>
<li>Apple Mail：设置 → 签名，新建后粘贴；取消勾选“始终匹配我的默认消息字体”。Settings → Signatures; untick “Always match my default message font”.</li>
<li>图片要用网上的地址（logo 网址），本地图片在多数邮箱里会被拦截。Use a hosted logo address; embedded images are often blocked.</li>
</ul></details>
</main></body></html>
`;
}
