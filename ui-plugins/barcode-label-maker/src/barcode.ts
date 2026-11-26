// 条码编码：EAN-13 / UPC-A / Code 128（B 与 C 字符集）。输出“条/空”宽度序列（单位：模块）。
export const C128 = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");

export function code128(text: string): number[] {
  if (!text) throw new Error("empty");
  for (const ch of text) if (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126) throw new Error(`Code 128 supports printable ASCII only (got “${ch}”)`);
  const codes: number[] = [];
  if (/^\d+$/.test(text) && text.length % 2 === 0 && text.length >= 4) {
    codes.push(105);
    for (let i = 0; i < text.length; i += 2) codes.push(Number(text.slice(i, i + 2)));
  } else {
    codes.push(104);
    for (const ch of text) codes.push(ch.charCodeAt(0) - 32);
  }
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  return codes.flatMap((c) => [...C128[c]].map(Number));
}

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = L.map((p) => [...p].map((b) => (b === "0" ? "1" : "0")).reverse().join(""));
const R = L.map((p) => [...p].map((b) => (b === "0" ? "1" : "0")).join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function eanCheck(d12: string) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}

/** EAN-13 的模块位串（1=条）。 */
export function ean13Bits(d13: string) {
  const first = Number(d13[0]);
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (PARITY[first][i - 1] === "L" ? L : G)[Number(d13[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[Number(d13[i])];
  return bits + "101";
}

/** 位串 → 宽度序列（条、空交替，从条开始）。 */
export function bitsToWidths(bits: string) {
  const out: number[] = [];
  let run = 1;
  for (let i = 1; i <= bits.length; i++) {
    if (bits[i] === bits[i - 1]) run++;
    else { out.push(run); run = 1; }
  }
  return out;
}

export type Kind = "auto" | "ean13" | "upca" | "code128";
export interface Encoded { kind: "ean13" | "upca" | "code128"; text: string; widths: number[]; human: string; warn?: string; guards?: boolean }

export function encode(raw: string, kind: Kind = "auto"): Encoded {
  const v = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!v) throw new Error("empty");
  const digits = /^\d+$/.test(v);
  const ean = (d13: string, warn?: string): Encoded => ({ kind: "ean13", text: d13, widths: bitsToWidths(ean13Bits(d13)), human: d13, warn, guards: true });
  if ((kind === "auto" || kind === "ean13") && digits && v.length === 13) {
    const ok = eanCheck(v.slice(0, 12)) === v[12];
    if (!ok && kind === "ean13") throw new Error(`EAN-13 check digit is wrong: expected ${eanCheck(v.slice(0, 12))}`);
    if (ok) return ean(v);
    return { ...enc128(v), warn: `Not a valid EAN-13 (check digit should be ${eanCheck(v.slice(0, 12))}); encoded as Code 128 / 校验位不对，已改用 Code 128` };
  }
  if ((kind === "auto" || kind === "upca") && digits && v.length === 12 && eanCheck("0" + v.slice(0, 11)) === v[11]) return { ...ean("0" + v), kind: "upca", human: v };
  if ((kind === "auto" || kind === "ean13") && digits && v.length === 12) return ean(v + eanCheck(v), `Check digit ${eanCheck(v)} added (EAN-13) / 已补上校验位`);
  if (kind === "ean13" || kind === "upca") throw new Error(`${kind.toUpperCase()} needs ${kind === "ean13" ? "12–13" : "12"} digits`);
  return enc128(v);
}
function enc128(v: string): Encoded {
  return { kind: "code128", text: v, widths: code128(v), human: v };
}

export function barcodeSvg(e: Encoded, height = 50, module = 2) {
  let x = 10 * module, rects = "";
  e.widths.forEach((w, i) => { if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w * module}" height="${height}"/>`; x += w * module; });
  const width = x + 10 * module;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + 16}" width="${width}" height="${height + 16}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g><text x="${width / 2}" y="${height + 13}" font-family="monospace" font-size="12" text-anchor="middle">${e.human.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
}
export const totalModules = (e: Encoded) => e.widths.reduce((a, b) => a + b, 0);
