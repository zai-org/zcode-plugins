import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { indexHtml, parseSocials, signatureHtml, signatureText, standalone, type Person, type SigOpts } from "./sig.ts";

export const NAME = "email-signature-maker";
export const VERSION = "0.1.0";

const IMG = /\.(png|jpe?g|gif)$/i;
const s = (v: unknown) => String(v ?? "").trim();
const peopleOf = (p: Project): Person[] => p.rows.filter((r) => r.include !== false).map((r) => ({ name: s(r.name), nameEn: s(r.nameEn), title: s(r.title), titleEn: s(r.titleEn), dept: s(r.dept), mobile: s(r.mobile), phone: s(r.phone), email: s(r.email), wechat: s(r.wechat), extra: s(r.extra) }));

async function optsOf(p: Project, ws?: ExportCtx["ws"]): Promise<SigOpts> {
  const st = p.settings;
  let logo = s(st.logoUrl);
  const local = s(p.meta?.logo);
  if (!logo && local && ws && (await ws.exists(local))) {
    const ext = local.split(".").pop()!.toLowerCase();
    logo = `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${(await ws.read(local)).toString("base64")}`;
  }
  return { company: s(st.company), companyEn: s(st.companyEn), website: s(st.website), address: s(st.address), logo, logoWidth: Math.max(40, Math.min(240, Number(st.logoWidth) || 120)), template: (s(st.template) || "classic") as SigOpts["template"], accent: s(st.accent) || "#0f766e", socials: parseSocials(s(st.socials)), disclaimer: s(st.disclaimer), bilingual: st.bilingual !== false };
}
function fileNames(people: Person[]) {
  const used = new Set<string>();
  return people.map((p) => {
    const base = safeFileName(p.email ? p.email.split("@")[0] : p.name, "signature");
    let f = base;
    for (let i = 2; used.has(f); i++) f = `${base}-${i}`;
    used.add(f);
    return f;
  });
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "sig",
  title: ["邮件签名批量", "Email Signature Maker"],
  openDescription:
    "Turn a team list (CSV/XLSX with columns such as 姓名/name, 英文名/English name, 职位/title, 英文职位/English title, 部门/department, 手机/mobile, 电话/phone, 邮箱/email, 微信/WeChat) into one uniform HTML email signature per person: table-based HTML with inline styles that pastes cleanly into Gmail, Outlook and Apple Mail, plus a plain-text version and an index page with every signature and install steps. Three templates (classic, logo-on-the-side, compact one-liner), company logo (hosted address, or a picked image embedded), accent colour, text social links and an optional disclaimer.",
  inputs: { exts: [".csv", ".xlsx", ".tsv", ".png", ".jpg", ".jpeg", ".gif"], min: 1, max: 2, label: ["选择员工名单（可再选一个 logo 图片）", "Pick the team list (and optionally a logo image)"] },
  settings: [
    { key: "company", label: ["公司名", "Company"], type: "text", default: "" },
    { key: "companyEn", label: ["英文公司名", "Company (English)"], type: "text", default: "" },
    { key: "website", label: ["网址", "Website"], type: "text", default: "" },
    { key: "address", label: ["地址", "Address"], type: "text", default: "" },
    { key: "logoUrl", label: ["logo 网址（推荐，https://…）", "Logo address (recommended, https://…)"], type: "text", default: "" },
    { key: "logoWidth", label: ["logo 宽度（像素）", "Logo width (px)"], type: "number", default: 120 },
    { key: "template", label: ["模板", "Template"], type: "select", default: "classic", options: [{ value: "classic", label: ["经典", "Classic"] }, { value: "side", label: ["logo 在左", "Logo on the side"] }, { value: "compact", label: ["紧凑", "Compact"] }] },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#0f766e" },
    { key: "socials", label: ["社交链接（每条“名称 网址”，逗号或换行分隔）", "Social links (“Label URL”, comma or newline separated)"], type: "text", default: "" },
    { key: "disclaimer", label: ["免责声明（可选）", "Disclaimer (optional)"], type: "text", default: "" },
    { key: "bilingual", label: ["中英双语", "Chinese + English"], type: "bool", default: true },
  ],
  columns: () => [
    { key: "include", label: ["生成", "Make"], type: "bool" },
    { key: "name", label: ["姓名", "Name"] },
    { key: "nameEn", label: ["英文名", "English name"] },
    { key: "title", label: ["职位", "Title"] },
    { key: "titleEn", label: ["英文职位", "English title"] },
    { key: "dept", label: ["部门", "Department"] },
    { key: "mobile", label: ["手机", "Mobile"] },
    { key: "phone", label: ["电话", "Phone"] },
    { key: "email", label: ["邮箱", "Email"] },
    { key: "wechat", label: ["微信", "WeChat"] },
    { key: "extra", label: ["附加一行", "Extra line"], wide: true },
  ],
  newRow: () => ({ include: true, name: "", nameEn: "", title: "", titleEn: "", dept: "", mobile: "", phone: "", email: "", wechat: "", extra: "" }),
  async load({ ws, files }) {
    const table = files.find((f) => !IMG.test(f));
    if (!table) throw new KitError("no_table", "Pick the team list (CSV/XLSX) — only an image was picked.");
    const t = await readTable(ws, table);
    const m = mapHeaders(t.columns, { name: ["姓名", "名字", "name", "full name"], nameEn: ["英文名", "english name", "英文姓名"], title: ["职位", "职务", "title", "position", "job title"], titleEn: ["英文职位", "english title", "title en"], dept: ["部门", "department", "dept", "team"], mobile: ["手机", "手机号", "mobile", "cell"], phone: ["电话", "座机", "phone", "tel"], email: ["邮箱", "email", "e-mail", "电子邮件"], wechat: ["微信", "wechat", "weixin"], extra: ["附加", "备注", "extra", "note", "tagline"] });
    if (!m.name) throw new KitError("no_name_column", `Couldn't find a name column (姓名/name). Columns: ${t.columns.join(", ")}`);
    const g = (r: Record<string, unknown>, k?: string) => (k ? s(r[k]) : "");
    const rows: Row[] = t.rows.filter((r) => g(r, m.name)).map((r) => ({ include: true, name: g(r, m.name), nameEn: g(r, m.nameEn), title: g(r, m.title), titleEn: g(r, m.titleEn), dept: g(r, m.dept), mobile: g(r, m.mobile), phone: g(r, m.phone), email: g(r, m.email), wechat: g(r, m.wechat), extra: g(r, m.extra) }));
    return { rows, meta: { logo: files.find((f) => IMG.test(f)) ?? "" } };
  },
  async compute(p, ctx) {
    const issues: Issue[] = [];
    p.rows.forEach((r, i) => {
      if (r.include === false) return;
      const n = s(r.name);
      if (!n) { issues.push({ level: "error", row: i, key: "name", message: `Row ${i + 1}: no name.` }); return; }
      const e = s(r.email);
      if (!e) issues.push({ level: "warn", row: i, key: "email", message: `${n}: no email address.` });
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) issues.push({ level: "warn", row: i, key: "email", message: `${n}: email “${e}” looks wrong.` });
      const mo = s(r.mobile).replace(/[\s-]/g, "");
      if (mo && !/^\+?\d{6,15}$/.test(mo)) issues.push({ level: "warn", row: i, key: "mobile", message: `${n}: mobile “${r.mobile}” looks wrong.` });
    });
    const o = await optsOf(p, ctx?.ws);
    if (o.logo.startsWith("data:")) issues.push({ level: "warn", key: "logoUrl", message: "The logo is embedded in the HTML; Outlook and some webmail block embedded images. Upload it and put its https:// address in “Logo address”." });
    else if (o.logo && !/^https:\/\//i.test(o.logo)) issues.push({ level: "warn", key: "logoUrl", message: "The logo address should start with https://." });
    if (!o.company) issues.push({ level: "info", message: "No company name set." });
    const people = peopleOf(p);
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:14px;background:#f3f4f6">${people.slice(0, 8).map((x) => `<div style="background:#fff;border-radius:8px;padding:14px 16px;margin-bottom:10px">${signatureHtml(x, o)}</div>`).join("")}${people.length > 8 ? `<p style="color:#6b7280;font:12px sans-serif">… +${people.length - 8}</p>` : ""}</body></html>`;
    const preview = `<iframe sandbox="" style="width:100%;height:560px;border:1px solid #e5e7eb;border-radius:12px" srcdoc="${esc(html)}"></iframe>`;
    return { rows: p.rows, issues, preview, summary: `${people.length} signatures · ${o.template}${o.logo ? " · logo" : ""}${o.socials.length ? ` · ${o.socials.length} links` : ""}`, stats: { signatures: people.length, links: o.socials.length } };
  },
  exports: [
    {
      id: "html", label: ["每人一份签名 + 预览页", "Signatures + index page"], description: "signatures/<name>.html and .txt per person, plus index.html with all signatures and install steps",
      async run({ project, write, computed, ws }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        const o = await optsOf(project, ws);
        const people = peopleOf(project);
        const names = fileNames(people);
        const out: string[] = [];
        for (let i = 0; i < people.length; i++) {
          out.push(await write(`signatures/${names[i]}.html`, standalone(people[i], o)));
          out.push(await write(`signatures/${names[i]}.txt`, signatureText(people[i], o)));
        }
        out.unshift(await write("index.html", indexHtml(people.map((p, i) => ({ p, file: `signatures/${names[i]}.html` })), o)));
        return out;
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
