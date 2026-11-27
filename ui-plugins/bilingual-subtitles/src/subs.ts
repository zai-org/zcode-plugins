/** 字幕读写：SRT / WebVTT / ASS(SSA)。时间一律用毫秒。 */
export type Cue = { start: number; end: number; text: string; raw?: string; style?: string };
export type Format = "srt" | "vtt" | "ass";
export type Parsed = { format: Format; cues: Cue[]; errors: string[]; assHeader?: string };

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/;
/** "01:02:03,450" / "02:03.4" / "1:02:03.45"(ASS 百分之一秒) / "-1.5s" / "1500ms" / "83.2" → ms */
export function parseTime(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^([+-]?\d+(?:\.\d+)?)\s*(ms|s)?$/i);
  if (m) return Math.round(Number(m[1]) * (m[2]?.toLowerCase() === "ms" ? 1 : 1000));
  const neg = s.startsWith("-");
  m = s.replace(/^[+-]/, "").match(new RegExp(`^${TIME.source}$`));
  if (!m) return null;
  const frac = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  const ms = (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + frac;
  return neg ? -ms : ms;
}
const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");
export function fmtTime(ms: number, f: Format | "csv" = "srt"): string {
  const neg = ms < 0; ms = Math.abs(Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60, r = ms % 1000;
  if (f === "ass") return `${neg ? "-" : ""}${h}:${pad(m)}:${pad(sec)}.${pad(Math.floor(r / 10))}`;
  return `${neg ? "-" : ""}${pad(h)}:${pad(m)}:${pad(sec)}${f === "srt" ? "," : "."}${pad(r, 3)}`;
}

export function detect(name: string, text: string): Format {
  if (/^\uFEFF?WEBVTT/.test(text) || /\.vtt$/i.test(name)) return "vtt";
  if (/^\s*\[Script Info\]/im.test(text) || /\.(ass|ssa)$/i.test(name)) return "ass";
  return "srt";
}

/** ASS 文本：\N → 换行，去掉 {\…} 覆盖标签 */
export const assPlain = (t: string) => t.replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, "\n").replace(/\\h/g, " ");
const assEsc = (t: string) => t.replace(/\r?\n/g, "\\N");

export function parse(name: string, input: string): Parsed {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const format = detect(name, text);
  const errors: string[] = [];
  const cues: Cue[] = [];
  if (format === "ass") {
    const ev = text.search(/^\[Events\]/im);
    const header = ev >= 0 ? text.slice(0, ev) : "";
    let fields = ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"];
    let section = "";
    text.split("\n").forEach((line, i) => {
      const sec = line.match(/^\s*\[([^\]]+)\]/);
      if (sec) { section = sec[1].toLowerCase(); return; }
      const f = line.match(/^Format:\s*(.*)$/i);
      if (f && section === "events") { fields = f[1].split(",").map((x) => x.trim()); return; }
      const d = line.match(/^Dialogue:\s*(.*)$/i);
      if (!d) return;
      const parts = d[1].split(",");
      const head = parts.slice(0, fields.length - 1), body = parts.slice(fields.length - 1).join(",");
      const get = (k: string) => head[fields.findIndex((x) => x.toLowerCase() === k.toLowerCase())]?.trim();
      const start = parseTime(get("Start")), end = parseTime(get("End"));
      if (start === null || end === null) { errors.push(`line ${i + 1}: bad time`); return; }
      cues.push({ start, end, text: assPlain(body), raw: body, style: get("Style") });
    });
    return { format, cues, errors, assHeader: header.trim() };
  }
  const blocks = text.split(/\n[ \t]*\n+/);
  let lineNo = 1;
  for (const b of blocks) {
    const lines = b.split("\n");
    const at = lineNo; lineNo += lines.length + 1;
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) {
      if (b.trim() && !/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(b.trim()) && !/^\d+$/.test(b.trim())) errors.push(`line ${at}: no timing line`);
      continue;
    }
    const [a, z] = lines[ti].split("-->");
    const start = parseTime(a.trim()), end = parseTime(z.trim().split(/\s+/)[0]);
    if (start === null || end === null) { errors.push(`line ${at + ti}: bad timing “${lines[ti].trim()}”`); continue; }
    const body = lines.slice(ti + 1).join("\n").replace(/\s+$/, "");
    cues.push({ start, end, text: body });
  }
  return { format, cues, errors };
}

export type AssStyle = { name: string; font: string; size: number; color: string; outline?: string; alignment?: number; marginV?: number; bold?: boolean };
/** #RRGGBB → ASS &H00BBGGRR */
export const assColor = (hex: string) => { const h = hex.replace("#", "").padEnd(6, "0"); return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase(); };
export function assHeader(styles: AssStyle[], title = "Subtitles", w = 1920, h = 1080) {
  const st = styles.map((s) => `Style: ${s.name},${s.font},${s.size},${assColor(s.color)},&H000000FF,${assColor(s.outline ?? "#000000")},&H64000000,${s.bold ? -1 : 0},0,0,0,100,100,0,0,1,2,1,${s.alignment ?? 2},40,40,${s.marginV ?? 40},1`);
  return `[Script Info]\nTitle: ${title}\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${st.join("\n")}`;
}

/** SRT/VTT 里的 <i> <b> 标签换成 ASS 标签 */
const htmlToAss = (t: string) => t.replace(/<\s*(i|b|u)\s*>/gi, (_, x: string) => `{\\${x.toLowerCase()}1}`).replace(/<\s*\/\s*(i|b|u)\s*>/gi, (_, x: string) => `{\\${x.toLowerCase()}0}`).replace(/<[^>]+>/g, "");

export function write(cues: Cue[], f: Format, opts: { header?: string; style?: string; title?: string } = {}): string {
  if (f === "srt") return cues.map((c, i) => `${i + 1}\n${fmtTime(c.start, "srt")} --> ${fmtTime(c.end, "srt")}\n${c.text}\n`).join("\n");
  if (f === "vtt") return `WEBVTT\n\n${cues.map((c) => `${fmtTime(c.start, "vtt")} --> ${fmtTime(c.end, "vtt")}\n${c.text.replace(/-->/g, "→")}\n`).join("\n")}`;
  const header = opts.header || assHeader([{ name: "Default", font: "Noto Sans CJK SC", size: 56, color: "#FFFFFF" }], opts.title);
  const events = cues.map((c) => `Dialogue: 0,${fmtTime(c.start, "ass")},${fmtTime(c.end, "ass")},${c.style || opts.style || "Default"},,0,0,0,,${c.raw ?? assEsc(htmlToAss(c.text))}`);
  return `${header}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`;
}

/** 显示宽度：中日韩全角字算 2，其它算 1 */
export const width = (t: string) => { let w = 0; for (const ch of t) w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3fffd}]/u.test(ch) ? 2 : 1; return w; };
export const plain = (t: string) => t.replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "");
/** 每秒字符数：按显示宽度/2 计中文（≈ 每秒汉字数 × 2 ≈ 拉丁字母） */
export function cps(c: Cue) { const d = (c.end - c.start) / 1000; const chars = width(plain(c.text).replace(/\s+/g, "")); return d > 0 ? chars / d : Infinity; }
