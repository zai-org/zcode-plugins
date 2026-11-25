// 字段映射、规范化、查重合并。
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export const FIELDS = ["name", "phone", "phone2", "email", "email2", "company", "title", "city", "wechat", "notes"] as const;
export type Field = (typeof FIELDS)[number];
export const FIELD_LABEL: Record<Field, [string, string]> = {
  name: ["姓名", "Name"], phone: ["电话", "Phone"], phone2: ["电话2", "Phone 2"], email: ["邮箱", "Email"], email2: ["邮箱2", "Email 2"],
  company: ["公司", "Company"], title: ["职位", "Title"], city: ["城市", "City"], wechat: ["微信", "WeChat"], notes: ["备注", "Notes"],
};
/** 列 → 字段；"" 表示忽略。first/last 名分开时都映射到 name，按列顺序（名 姓）拼接。 */
export type Mapping = Record<string, Field | "first" | "last" | "">;

const SYN: [Field | "first" | "last", RegExp][] = [
  ["first", /^(first ?name|given ?name|名字?)$/i],
  ["last", /^(last ?name|surname|family ?name|姓氏?)$/i],
  ["name", /(姓名|联系人|客户名称|客户姓名|^名称$|^name$|full ?name|contact ?name|display ?name)/i],
  ["email", /(e-?mail|邮箱|电子邮件|邮件)/i],
  ["wechat", /(微信|wechat|weixin)/i],
  ["phone", /(手机|电话|联系方式|mobile|phone|tel|cell|号码)/i],
  ["company", /(公司|单位|企业|机构|组织|company|organi[sz]ation|employer|account ?name)/i],
  ["title", /(职位|职务|岗位|头衔|title|position|role|job)/i],
  ["city", /(城市|地区|所在地|省市|city|location|region)/i],
  ["notes", /(备注|说明|notes?|comments?|remark|memo)/i],
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
/** 按表头和内容猜映射：表头命中同义词优先，否则看内容（大多是邮箱/电话的列）。 */
export function guessMapping(columns: string[], rows: Record<string, string>[]): Mapping {
  const m: Mapping = {};
  const used = new Set<string>();
  for (const c of columns) {
    const hit = SYN.find(([, re]) => re.test(c.trim()))?.[0];
    let f: Mapping[string] = hit ?? "";
    if (f && f !== "first" && f !== "last" && used.has(f)) f = f === "phone" ? (used.has("phone2") ? "" : "phone2") : f === "email" ? (used.has("email2") ? "" : "email2") : f === "notes" ? "notes" : "";
    if (!f) {
      const vals = rows.map((r) => r[c]).filter(Boolean).slice(0, 50);
      if (vals.length && vals.filter((v) => EMAIL_RE.test(v.trim())).length / vals.length > 0.6 && !used.has("email")) f = "email";
      else if (vals.length && vals.filter((v) => /^[+\d][\d\s()\-.]{6,}$/.test(v.trim())).length / vals.length > 0.6 && !used.has("phone")) f = "phone";
    }
    m[c] = f;
    if (f) used.add(f);
  }
  return m;
}

export interface Issue { field: Field; value: string; problem: string }
export interface Contact { id: string; file: string; row: number; values: Record<Field, string>; issues: Issue[]; raw: Record<string, string> }

const cjk = (s: string) => /[\u3400-\u9fff]/.test(s);
export function cleanName(s: string): string {
  let t = s.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (cjk(t)) return t.replace(/\s+/g, "");
  if (t && (t === t.toUpperCase() || t === t.toLowerCase())) t = t.toLowerCase().replace(/(^|[\s'\-])\p{L}/gu, (m) => m.toUpperCase());
  return t;
}

/** 电话：拆分多个号码，按国家码规范成国际格式（默认中国大陆，+86）。返回 [规范值, 是否有效]。 */
export function cleanPhones(s: string, region: CountryCode = "CN"): { value: string; valid: boolean; raw: string; assumed?: string }[] {
  const t = s.normalize("NFKC").replace(/^tel:/i, "");
  const parts = t.split(/[;；,，/、|]|\s{2,}|\bor\b|或/).map((x) => x.trim()).filter((x) => /\d{3}/.test(x));
  return parts.map((raw) => {
    const ext = /(?:ext\.?|x|转|分机)\s*(\d{1,6})\s*$/i.exec(raw);
    const core = ext ? raw.slice(0, ext.index) : raw;
    let digits = core.replace(/[^\d+]/g, "");
    if (digits.startsWith("00")) digits = "+" + digits.slice(2);
    // 中国大陆号码本地写法：手机 1 开头，固话带 0 区号；10 位且不以 0/1 开头的多半是北美号码
    const cnUnlikely = region === "CN" && !digits.startsWith("+") && digits.length === 10 && !/^[01]/.test(digits);
    const p = cnUnlikely ? undefined : parsePhoneNumberFromString(digits, region);
    if (p && p.isValid()) return { value: p.formatInternational() + (ext ? ` ext. ${ext[1]}` : ""), valid: true, raw };
    // 没写国家码、在默认地区无效的 10 位号码，常见的是北美号码 (415) 555-0132
    const us = !digits.startsWith("+") && digits.length === 10 ? parsePhoneNumberFromString(digits, "US") : undefined;
    if (us && us.isValid()) return { value: us.formatInternational() + (ext ? ` ext. ${ext[1]}` : ""), valid: true, raw, assumed: "+1" };
    return { value: raw.replace(/\s+/g, " "), valid: false, raw };
  });
}

export function cleanEmails(s: string): { value: string; valid: boolean }[] {
  return s.normalize("NFKC").replace(/mailto:/gi, "").split(/[;；,，\s]+/).map((x) => x.trim().replace(/^<|>$/g, "").toLowerCase()).filter(Boolean).map((value) => ({ value, valid: EMAIL_RE.test(value) }));
}

const SUFFIX = /(股份有限公司|有限责任公司|有限公司|集团有限公司|集团|公司|科技|co\.?,?\s*ltd\.?|corporation|corp\.?|inc\.?|llc|ltd\.?|limited|gmbh|s\.a\.|plc|technology|technologies|group)$/i;
/** 公司比较用的键：去掉常见后缀、标点、空白和大小写。 */
export function companyKey(s: string): string {
  let t = s.normalize("NFKC").toLowerCase().replace(/[()（）【】\[\],.，。'"&\-\s]/g, (c) => (c === "&" ? "and" : ""));
  for (let i = 0; i < 4; i++) t = t.replace(SUFFIX, "");
  return t;
}
export function cleanCompany(s: string): string {
  const t = s.normalize("NFKC").replace(/\s+/g, " ").trim();
  return cjk(t) ? t.replace(/\(/g, "（").replace(/\)/g, "）").replace(/\s+/g, "") : t;
}

export function normalizeRow(file: string, row: number, raw: Record<string, string>, mapping: Mapping, region: CountryCode = "CN"): Contact {
  const v = Object.fromEntries(FIELDS.map((f) => [f, ""])) as Record<Field, string>;
  const issues: Issue[] = [];
  const first: string[] = [], last: string[] = [], phones: string[] = [], emails: string[] = [], notes: string[] = [];
  for (const [col, f] of Object.entries(mapping)) {
    const val = (raw[col] ?? "").trim();
    if (!val || !f) continue;
    if (f === "first") first.push(val);
    else if (f === "last") last.push(val);
    else if (f === "phone" || f === "phone2") phones.push(val);
    else if (f === "email" || f === "email2") emails.push(val);
    else if (f === "notes") notes.push(val);
    else if (!v[f]) v[f] = val;
    else notes.push(`${col}: ${val}`);
  }
  if (!v.name && (first.length || last.length)) {
    const fn = first.join(" "), ln = last.join(" ");
    v.name = cjk(fn + ln) ? ln + fn : `${fn} ${ln}`.trim();
  }
  v.name = cleanName(v.name);
  const ps = phones.flatMap((p) => cleanPhones(p, region));
  const uniqP = [...new Map(ps.map((p) => [p.value, p])).values()];
  uniqP.forEach((p, i) => {
    if (!p.valid) issues.push({ field: i ? "phone2" : "phone", value: p.raw, problem: "invalid phone" });
    if (p.assumed) issues.push({ field: i ? "phone2" : "phone", value: p.raw, problem: `country code assumed (${p.assumed})` });
    if (i === 0) v.phone = p.value; else if (i === 1) v.phone2 = p.value; else notes.push(`phone: ${p.value}`);
  });
  const es = [...new Map(emails.flatMap(cleanEmails).map((e) => [e.value, e])).values()];
  es.forEach((e, i) => {
    if (!e.valid) issues.push({ field: i ? "email2" : "email", value: e.value, problem: "invalid email" });
    if (i === 0) v.email = e.value; else if (i === 1) v.email2 = e.value; else notes.push(`email: ${e.value}`);
  });
  v.company = cleanCompany(v.company);
  for (const f of ["title", "city", "wechat"] as const) v[f] = v[f].normalize("NFKC").replace(/\s+/g, " ").trim();
  v.notes = notes.join("; ");
  if (!v.name) issues.push({ field: "name", value: "", problem: "missing name" });
  if (!v.phone && !v.email && !v.wechat) issues.push({ field: "phone", value: "", problem: "no phone, email or WeChat" });
  return { id: `${file}#${row}`, file, row, values: v, issues, raw };
}

// ---------- 查重 ----------
const phoneKey = (p: string) => p.replace(/\D/g, "").replace(/ext.*$/, "");
const nameKey = (n: string) => n.normalize("NFKC").toLowerCase().replace(/[\s.\-'·•]/g, "");
const nameVariants = (n: string) => {
  const k = nameKey(n);
  const parts = n.toLowerCase().split(/\s+/).filter(Boolean);
  return new Set([k, parts.slice().reverse().join("")]);
};
export const namesCompatible = (a: string, b: string) => {
  if (!a || !b) return true;
  const va = nameVariants(a), vb = nameVariants(b);
  for (const x of va) if (vb.has(x)) return true;
  return false;
};
function edit1(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}

export interface Pair { id: string; a: string; b: string; reason: string; score: number }

const NAME_BUCKET_MAX = 400;
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };

/** 确定重复（并查集）：电话或邮箱相同且姓名相容，或电话和邮箱都相同。可能重复：只给出待确认的两两配对。 */
export function findDuplicates(cs: Contact[]) {
  const parent = new Map(cs.map((c) => [c.id, c.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (x !== r) { const n = parent.get(x)!; parent.set(x, r); x = n; }
    return r;
  };
  const why = new Map<string, string>();
  const union = (a: Contact, b: Contact, reason: string) => { const ra = find(a.id), rb = find(b.id); if (ra !== rb) { parent.set(rb, ra); why.set(`${a.id}|${b.id}`, reason); } };
  const byPhone = new Map<string, Contact[]>(), byEmail = new Map<string, Contact[]>();
  for (const c of cs) {
    for (const p of [c.values.phone, c.values.phone2].filter(Boolean).map(phoneKey)) if (p.length >= 7) push(byPhone, p, c);
    for (const e of [c.values.email, c.values.email2].filter(Boolean)) push(byEmail, e, c);
  }
  const shares = (a: Contact, b: Contact) => {
    const pa = new Set([a.values.phone, a.values.phone2].filter(Boolean).map(phoneKey)), ea = new Set([a.values.email, a.values.email2].filter(Boolean));
    return { phone: [b.values.phone, b.values.phone2].filter(Boolean).map(phoneKey).some((p) => pa.has(p)), email: [b.values.email, b.values.email2].filter(Boolean).some((e) => ea.has(e)) };
  };
  const pairs = new Map<string, Pair>();
  const maybe = (a: Contact, b: Contact, reason: string, score: number) => {
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const id = `${x.id}|${y.id}`;
    if (!pairs.has(id) || pairs.get(id)!.score < score) pairs.set(id, { id, a: x.id, b: y.id, reason, score });
  };
  for (const group of [...byPhone.values(), ...byEmail.values()]) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (a === b) continue;
      const s = shares(a, b);
      if (s.phone && s.email) union(a, b, "same phone and email");
      else if (namesCompatible(a.values.name, b.values.name)) union(a, b, s.phone ? "same phone" : "same email");
      else maybe(a, b, s.phone ? "same phone, different name" : "same email, different name", 0.7);
    }
  }
  // 姓名相同（或只差一个字母）+ 公司相近 / 号码后 8 位相同 / 邮箱用户名相同
  const byName = new Map<string, Contact[]>();
  // 中文姓名很短，按前两个字分桶会把同姓的人都放进一个大桶（5 万行要几分钟）。中文按完整姓名分桶（中文不做 edit1，
  // 完全等价）；拉丁姓名仍按前两个字母分桶以便找拼写只差一个字母的，但桶太大时退回按完整姓名分桶。
  for (const c of cs) if (c.values.name) { const k = nameKey(c.values.name); push(byName, cjk(k) ? k : k.slice(0, 2), c); }
  for (const [k, group] of [...byName]) if (group.length > NAME_BUCKET_MAX) { byName.delete(k); for (const c of group) push(byName, `=${nameKey(c.values.name)}`, c); }
  for (const group of byName.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i], b = group[j];
    if (find(a.id) === find(b.id)) continue;
    const na = nameKey(a.values.name), nb = nameKey(b.values.name);
    const sameName = namesCompatible(a.values.name, b.values.name);
    if (!sameName && !(na.length >= 5 && edit1(na, nb))) continue;
    const ka = companyKey(a.values.company), kb = companyKey(b.values.company);
    const company = !!ka && !!kb && (ka === kb || (Math.min(ka.length, kb.length) >= 2 && (ka.includes(kb) || kb.includes(ka))));
    const tail = (c: Contact) => [c.values.phone, c.values.phone2].filter(Boolean).map((p) => phoneKey(p).slice(-8));
    const phoneTail = tail(a).some((t) => t.length === 8 && tail(b).includes(t));
    const local = (c: Contact) => [c.values.email, c.values.email2].filter(Boolean).map((e) => e.split("@")[0].replace(/[._\-]/g, ""));
    const emailLocal = local(a).some((x) => x.length >= 4 && local(b).includes(x));
    const reasons = [sameName ? "same name" : "similar name", company && "same company", phoneTail && "same last 8 phone digits", emailLocal && "same email name"].filter(Boolean) as string[];
    if (reasons.length >= 2) maybe(a, b, reasons.join(", "), 0.4 + 0.15 * reasons.length);
  }
  const groups = new Map<string, Contact[]>();
  for (const c of cs) push(groups, find(c.id), c);
  // 可能重复按“组”去重：一组已合并的人只和另一组配一次对，用各组第一条的 id 表示
  const rep = (id: string) => groups.get(find(id))![0].id;
  const byGroup = new Map<string, Pair>();
  for (const p of pairs.values()) {
    if (find(p.a) === find(p.b)) continue;
    const [a, b] = [rep(p.a), rep(p.b)].sort();
    const id = `${a}|${b}`;
    if (!byGroup.has(id) || byGroup.get(id)!.score < p.score) byGroup.set(id, { ...p, id, a, b });
  }
  const possible = [...byGroup.values()].sort((x, y) => y.score - x.score);
  return { groups: [...groups.values()], reasons: why, possible };
}

export interface Merged { values: Record<Field, string>; sources: string[]; conflicts: string[]; issues: Issue[] }

/** 合并一组：按文件优先级取第一个非空值，多出的电话/邮箱放到 phone2/email2 或备注，其他冲突记入日志。 */
export function mergeGroup(group: Contact[]): Merged {
  const v = Object.fromEntries(FIELDS.map((f) => [f, ""])) as Record<Field, string>;
  const conflicts: string[] = [];
  const phones: string[] = [], emails: string[] = [], notes: string[] = [];
  const add = (list: string[], x: string, key: (s: string) => string) => { if (x && !list.some((y) => key(y) === key(x))) list.push(x); };
  for (const c of group) {
    for (const f of ["name", "company", "title", "city", "wechat"] as const) {
      const x = c.values[f];
      if (!x) continue;
      if (!v[f]) v[f] = x;
      else if (f === "name" ? !namesCompatible(v[f], x) && nameKey(v[f]) !== nameKey(x) : f === "company" ? companyKey(v[f]) !== companyKey(x) && !companyKey(v[f]).includes(companyKey(x)) && !companyKey(x).includes(companyKey(v[f])) : v[f].toLowerCase() !== x.toLowerCase()) {
        conflicts.push(`${f}: “${v[f]}” kept, “${x}” (${c.id}) → notes`);
        notes.push(`${FIELD_LABEL[f][1]}: ${x}`);
      } else if (f === "company" && x.length > v[f].length && cjk(x) === cjk(v[f])) v[f] = x; // 取更完整的公司全称
    }
    // 后 9 位相同视为同一号码（常见于同一号码一处带国家码、一处按本地写法被误判了国家），保留先出现的
    const pk = (x: string) => phoneKey(x).slice(-9);
    add(phones, c.values.phone, pk); add(phones, c.values.phone2, pk);
    add(emails, c.values.email, (s) => s); add(emails, c.values.email2, (s) => s);
    if (c.values.notes && !notes.includes(c.values.notes)) notes.push(c.values.notes);
  }
  [v.phone, v.phone2] = [phones[0] ?? "", phones[1] ?? ""];
  [v.email, v.email2] = [emails[0] ?? "", emails[1] ?? ""];
  if (phones.length > 2) { notes.push(`phone: ${phones.slice(2).join(", ")}`); conflicts.push(`${phones.length} phone numbers; extra in notes`); }
  if (emails.length > 2) { notes.push(`email: ${emails.slice(2).join(", ")}`); conflicts.push(`${emails.length} emails; extra in notes`); }
  v.notes = notes.join("; ");
  const issues = group.flatMap((c) => c.issues).filter((i) => (i.field.startsWith("phone") ? !phones.some((p) => p.replace(/\D/g, "").length >= 7 && !i.value) : true));
  // 合并后有效值存在时，去掉“缺联系方式”这类已解决的问题
  const resolved = issues.filter((i) => !(i.problem === "no phone, email or WeChat" && (v.phone || v.email || v.wechat)) && !(i.problem === "missing name" && v.name));
  return { values: v, sources: group.map((c) => c.id), conflicts, issues: [...new Map(resolved.map((i) => [i.field + i.value + i.problem, i])).values()] };
}
