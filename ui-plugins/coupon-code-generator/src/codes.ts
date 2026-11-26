import { createHash, randomBytes } from "node:crypto";

export const CHARSETS = {
  safe: "23456789ABCDEFGHJKLMNPQRSTUVWXYZ", // 去掉 0 O 1 I
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "0123456789",
  alnum: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
};
export type Charset = keyof typeof CHARSETS;
export const newSeed = () => randomBytes(6).toString("hex");

/** 校验位：数字用 Luhn，其他字符集用加权和取模。 */
export function checkChar(body: string, cs: Charset): string {
  const al = CHARSETS[cs];
  if (cs === "digits") {
    let sum = 0;
    const ds = body.split("").reverse().map(Number);
    ds.forEach((d, i) => { let v = i % 2 === 0 ? d * 2 : d; if (v > 9) v -= 9; sum += v; });
    return String((10 - (sum % 10)) % 10);
  }
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += (al.indexOf(body[i]) + 1) * (i + 3);
  return al[sum % al.length];
}

/** 用种子按模板生成：X 随机字符，其他字符原样保留（如 XXXX-XXXX）。 */
export function generate(opts: { seed: string; batch: string; prefix: string; pattern: string; charset: Charset; checksum: boolean; count: number; taken: Set<string> }): string[] {
  const al = CHARSETS[opts.charset];
  const slots = (opts.pattern.match(/X/g) ?? []).length;
  if (!slots) throw new Error("The pattern needs at least one X.");
  const out: string[] = [];
  let attempt = 0;
  const space = al.length ** slots;
  if (opts.count > space / 4) throw new Error(`Pattern ${opts.pattern} only allows ${space} codes — use a longer pattern.`);
  while (out.length < opts.count) {
    const h = createHash("sha256").update(`${opts.seed}:${opts.batch}:${attempt++}`).digest();
    let k = 0;
    const body: string[] = [];
    for (let i = 0; i < slots; i++) body.push(al[h[k++ % h.length] % al.length]);
    let j = 0;
    let code = opts.pattern.replace(/X/g, () => body[j++]);
    if (opts.checksum) code += checkChar(body.join(""), opts.charset);
    if (opts.prefix) code = `${opts.prefix}-${code}`;
    if (opts.taken.has(code)) continue;
    opts.taken.add(code);
    out.push(code);
  }
  return out;
}

export function verify(code: string, opts: { prefix?: string; pattern: string; charset: Charset }): boolean {
  let c = code.trim().toUpperCase();
  if (opts.prefix) { if (!c.startsWith(`${opts.prefix}-`)) return false; c = c.slice(opts.prefix.length + 1); }
  const slots = (opts.pattern.match(/X/g) ?? []).length;
  if (c.length !== opts.pattern.length + 1) return false;
  const body: string[] = [];
  for (let i = 0; i < opts.pattern.length; i++) {
    if (opts.pattern[i] === "X") { if (!CHARSETS[opts.charset].includes(c[i])) return false; body.push(c[i]); } else if (c[i] !== opts.pattern[i]) return false;
  }
  return body.length === slots && checkChar(body.join(""), opts.charset) === c[c.length - 1];
}
