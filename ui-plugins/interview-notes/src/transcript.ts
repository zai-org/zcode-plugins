import { KitError } from "./kit/workspace.ts";

export interface Utterance {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
}

const time = (t: string) => {
  const parts = t.trim().replace(",", ".").split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return NaN;
  return parts.reduce((s, x) => s * 60 + x, 0);
};
const TS = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?`;
const SPEAKER_PREFIX = /^(?:<v\s+([^>]+)>|([\p{L}\p{N} ._'-]{1,24}?)\s*[:：]\s+)/u;

function splitSpeaker(text: string): { speaker?: string; text: string } {
  const m = SPEAKER_PREFIX.exec(text);
  if (!m) return { text };
  const speaker = (m[1] ?? m[2]).trim();
  // 避免把 "Note: xxx" 一类的普通句子当成说话人：要求说话人名不太长且不含空格超过 3 个词。
  if (speaker.split(/\s+/).length > 3) return { text };
  return { speaker, text: text.slice(m[0].length).replace(/<\/v>/g, "").trim() };
}

/** 解析转写：SRT / WebVTT（行首“名字:”或 <v 名字> 作为说话人），或带时间戳的文本（飞书妙记、腾讯会议导出等）。 */
export function parseTranscript(raw: string, name: string): Utterance[] {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const out: { start: number; end?: number; speaker?: string; text: string }[] = [];
  if (/-->/.test(text)) {
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split("\n").filter((l) => l.trim());
      const i = lines.findIndex((l) => l.includes("-->"));
      if (i < 0) continue;
      const [a, b] = lines[i].split("-->");
      const body = lines.slice(i + 1).join(" ").replace(/<(?!v\s)[^>]+>/g, "").trim();
      if (!body) continue;
      const s = splitSpeaker(body);
      out.push({ start: time(a), end: time(b.trim().split(/\s+/)[0]), speaker: s.speaker, text: s.text });
    }
  } else {
    const lines = text.split("\n");
    const headerA = new RegExp(String.raw`^\s*\[?(${TS})\]?\s*(?:-\s*)?([^:：\n]{1,24}?)\s*[:：]\s*(.*)$`, "u"); // [00:01:02] 张三: text
    const headerB = new RegExp(String.raw`^\s*([^\d\s:：][^:：\n]{0,23}?)\s+\(?(${TS})\)?\s*[:：]?\s*(.*)$`, "u"); // 张三 00:01:02 [text]
    for (const line of lines) {
      if (!line.trim()) continue;
      const a = headerA.exec(line);
      const b = !a ? headerB.exec(line) : null;
      if (a) out.push({ start: time(a[1]), speaker: a[2].trim(), text: a[3].trim() });
      else if (b) out.push({ start: time(b[2]), speaker: b[1].trim(), text: b[3].trim() });
      else if (out.length) out[out.length - 1].text = `${out[out.length - 1].text} ${line.trim()}`.trim();
    }
  }
  const clean = out.filter((u) => Number.isFinite(u.start) && u.text);
  if (!clean.length) throw new KitError("bad_transcript", `${name}: no timestamped lines found. Supported: SRT, WebVTT, or text with lines like "[00:01:02] Name: text" / "Name 00:01:02".`);
  clean.sort((x, y) => x.start - y.start);
  let last = "Speaker 1";
  return clean.map((u, i) => {
    if (u.speaker) last = u.speaker;
    const next = clean[i + 1]?.start;
    const end = u.end && u.end > u.start ? u.end : next && next > u.start ? next : u.start + Math.max(2, u.text.length / 12);
    return { id: `u${i + 1}`, start: round(u.start), end: round(end), speaker: u.speaker ?? last, text: u.text.replace(/\s+/g, " ") };
  });
}
const round = (n: number) => Math.round(n * 100) / 100;

export const clock = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** 给 Agent 的文字稿：每条带 id、时间和说话人。 */
export function digest(utterances: Utterance[], speakers: Record<string, string>, maxChars = 60000) {
  const lines = utterances.map((u) => `[${u.id} ${clock(u.start)} ${speakers[u.speaker] ?? u.speaker}] ${u.text}`);
  let text = lines.join("\n");
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…（后面省略；请分段处理 / truncated）`;
  return text;
}

export interface Quote {
  utterance: string;
  text: string;
}
export interface Need {
  id: string;
  title: string;
  detail: string;
  category: string;
  priority: "high" | "medium" | "low";
  status: "open" | "confirmed" | "rejected";
  quotes: Quote[];
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}]+/gu, "");

/** 校验需求：引用必须指向存在的话语；引用文字要能在原话里找到（找不到时用整句原话并给出提示）。 */
export function normalizeNeeds(input: unknown, utterances: Utterance[]) {
  const byId = new Map(utterances.map((u) => [u.id, u]));
  const warnings: string[] = [];
  const list = Array.isArray(input) ? input : [];
  const needs: Need[] = list.map((n: any, i) => {
    const title = String(n?.title ?? "").trim().slice(0, 120);
    if (!title) throw new KitError("bad_need", `Need ${i + 1} has no title.`);
    const quotes: Quote[] = [];
    for (const q of Array.isArray(n?.quotes) ? n.quotes : []) {
      let id = String(q?.utterance ?? q?.id ?? "").trim();
      if (!byId.has(id) && Number.isFinite(Number(q?.at))) {
        const at = Number(q.at);
        id = utterances.find((u) => at >= u.start - 0.5 && at < u.end + 0.5)?.id ?? "";
      }
      const u = byId.get(id);
      if (!u) {
        warnings.push(`"${title}": quote ${JSON.stringify(q?.utterance ?? q?.at ?? q)} does not match any line — dropped.`);
        continue;
      }
      let text = String(q?.text ?? "").trim();
      if (!text || !norm(u.text).includes(norm(text))) {
        if (text) warnings.push(`"${title}": quote "${text.slice(0, 40)}" is not in ${id} — using the full line instead.`);
        text = u.text;
      }
      quotes.push({ utterance: id, text });
    }
    if (!quotes.length) warnings.push(`"${title}" has no quote from the interview — add one so it can be played back.`);
    return {
      id: String(n?.id ?? `n${i + 1}`).replace(/[^\w-]/g, "") || `n${i + 1}`,
      title,
      detail: String(n?.detail ?? "").trim().slice(0, 1000),
      category: String(n?.category ?? "").trim().slice(0, 30),
      priority: ["high", "medium", "low"].includes(n?.priority) ? n.priority : "medium",
      status: ["open", "confirmed", "rejected"].includes(n?.status) ? n.status : "open",
      quotes,
    };
  });
  const seen = new Set<string>();
  for (const n of needs) {
    let id = n.id;
    for (let k = 2; seen.has(id); k++) id = `${n.id}-${k}`;
    n.id = id;
    seen.add(id);
  }
  return { needs, warnings };
}
