import type { AgentHighlight, Annotation, Creator, ItemDetail, ItemSummary, Rect } from "#z/contract.ts";

/** 本地 API 返回的条目 JSON（只声明用到的部分）。 */
export interface RawItem {
  key: string;
  version: number;
  links?: { attachment?: { href?: string; attachmentType?: string; attachmentSize?: number } };
  meta?: { creatorSummary?: string; parsedDate?: string; numChildren?: number };
  data: Record<string, unknown> & { key: string; itemType: string };
}

const VENUE_FIELDS = [
  "publicationTitle",
  "proceedingsTitle",
  "bookTitle",
  "conferenceName",
  "websiteTitle",
  "blogTitle",
  "forumTitle",
  "repository",
  "university",
  "institution",
  "publisher",
  "court",
  "programTitle",
];

export function yearOf(raw: RawItem): string {
  const parsed = raw.meta?.parsedDate ?? "";
  if (/^\d{4}/.test(parsed)) return parsed.slice(0, 4);
  const match = /\b(1[5-9]\d\d|20\d\d|21\d\d)\b/.exec(String(raw.data.date ?? ""));
  return match ? match[1]! : "";
}

export function creatorName(creator: Creator): string {
  if (creator.name) return creator.name;
  return [creator.firstName, creator.lastName].filter(Boolean).join(" ");
}

/** Zotero 的作者摘要规则：1 位“甲”，2 位“甲 and 乙”，更多“甲 et al.”。 */
export function creatorSummary(creators: Creator[]): string {
  const authors = creators.filter((creator) => creator.creatorType === "author");
  const list = authors.length ? authors : creators;
  const last = (creator: Creator) => creator.lastName || creator.name || creator.firstName || "";
  if (!list.length) return "";
  if (list.length === 1) return last(list[0]!);
  if (list.length === 2) return `${last(list[0]!)} and ${last(list[1]!)}`;
  return `${last(list[0]!)} et al.`;
}

export function summarize(raw: RawItem): ItemSummary {
  const data = raw.data;
  const isPdfAttachment = data.itemType === "attachment" && data.contentType === "application/pdf";
  const best = raw.links?.attachment;
  const bestKey = best?.href?.split("/").pop();
  const pdf = isPdfAttachment
    ? { key: raw.key }
    : best?.attachmentType === "application/pdf" && bestKey
      ? { key: bestKey, ...(best.attachmentSize ? { size: best.attachmentSize } : {}) }
      : null;
  const creators = (data.creators as Creator[] | undefined) ?? [];
  const title =
    String(data.title ?? "").trim() ||
    (data.itemType === "note" ? htmlToText(String(data.note ?? "")).split("\n")[0]!.slice(0, 120) : "") ||
    String(data.filename ?? "") ||
    "(untitled)";
  return {
    key: raw.key,
    itemType: data.itemType,
    title,
    creatorSummary: raw.meta?.creatorSummary ?? creatorSummary(creators),
    year: yearOf(raw),
    venue: VENUE_FIELDS.map((field) => String(data[field] ?? "").trim()).find(Boolean) ?? "",
    tags: ((data.tags as { tag: string }[] | undefined) ?? []).map((tag) => tag.tag),
    numChildren: raw.meta?.numChildren ?? 0,
    pdf,
    dateAdded: String(data.dateAdded ?? ""),
    dateModified: String(data.dateModified ?? ""),
  };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** 笔记 / 引文 HTML 转纯文本：块级元素换行，列表项加 “- ”，丢弃脚本与样式。 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<span class="Z3988"[^>]*>[\s\S]*?<\/span>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|pre|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseAnnotation(raw: RawItem): Annotation {
  const data = raw.data;
  let pageIndex = 0;
  let rects: Rect[] = [];
  try {
    const position = JSON.parse(String(data.annotationPosition ?? "{}")) as { pageIndex?: number; rects?: number[][] };
    pageIndex = position.pageIndex ?? 0;
    rects = (position.rects ?? []).filter((rect) => rect.length === 4).map((rect) => rect as Rect);
  } catch {
    // 位置无法解析的注释仍列出，只是不在页面上绘制。
  }
  return {
    key: raw.key,
    type: String(data.annotationType ?? "highlight"),
    text: String(data.annotationText ?? ""),
    comment: String(data.annotationComment ?? ""),
    color: String(data.annotationColor ?? "#ffd400"),
    pageIndex,
    pageLabel: String(data.annotationPageLabel ?? pageIndex + 1),
    rects,
    sortIndex: String(data.annotationSortIndex ?? ""),
    tags: ((data.tags as { tag: string }[] | undefined) ?? []).map((tag) => tag.tag),
    dateModified: String(data.dateModified ?? ""),
  };
}

// ---------------------------------------------------------------------------
// 模型摘要
// ---------------------------------------------------------------------------

const TYPE_NAMES: Record<string, string> = {
  journalArticle: "article",
  conferencePaper: "conference paper",
  bookSection: "book chapter",
  preprint: "preprint",
  thesis: "thesis",
  report: "report",
  book: "book",
  webpage: "web page",
  attachment: "attachment",
  note: "note",
};

/** 一行条目：`[KEY] Title — Authors (Year), Venue · PDF · tags`。 */
export function itemLine(item: ItemSummary): string {
  const who = [item.creatorSummary, item.year && `(${item.year})`].filter(Boolean).join(" ");
  const parts = [`[${item.key}] ${item.title}`];
  if (who) parts.push(`— ${who}`);
  const extras = [
    item.venue && item.venue !== item.title ? item.venue : "",
    TYPE_NAMES[item.itemType] ?? item.itemType,
    item.pdf ? `PDF ${item.pdf.key}` : "",
    item.tags.length ? `tags: ${item.tags.slice(0, 6).join(", ")}${item.tags.length > 6 ? "…" : ""}` : "",
  ].filter(Boolean);
  return `${parts.join(" ")}${extras.length ? ` · ${extras.join(" · ")}` : ""}`;
}

export function renderDetail(item: ItemDetail, annotationsByAttachment: Map<string, Annotation[]>, highlights: AgentHighlight[]): string {
  const lines: string[] = [];
  lines.push(`# ${item.title}`, `key ${item.key} · ${TYPE_NAMES[item.itemType] ?? item.itemType} · version ${item.itemVersion}`);
  if (item.creators.length)
    lines.push(`Creators: ${item.creators.map((creator) => `${creatorName(creator)}${creator.creatorType !== "author" ? ` (${creator.creatorType})` : ""}`).join("; ")}`);
  for (const [field, value] of Object.entries(item.fields)) lines.push(`${field}: ${value}`);
  if (item.collections.length) lines.push(`Collections: ${item.collections.map((collection) => `${collection.name} [${collection.key}]`).join(", ")}`);
  if (item.tags.length) lines.push(`Tags: ${item.tags.join(", ")}`);
  if (item.parent) lines.push(`Parent item: ${item.parent}`);
  if (item.abstract) lines.push("", "## Abstract", item.abstract);
  if (item.attachments.length) {
    lines.push("", "## Attachments");
    for (const attachment of item.attachments) {
      const count = annotationsByAttachment.get(attachment.key)?.length ?? 0;
      lines.push(
        `- [${attachment.key}] ${attachment.title} (${attachment.contentType || attachment.linkMode}${attachment.isPdf ? `, ${count} annotation(s)` : ""})`,
      );
    }
  }
  for (const [attachmentKey, annotations] of annotationsByAttachment) {
    if (!annotations.length) continue;
    lines.push("", `## The user's annotations in ${attachmentKey}`);
    for (const annotation of annotations) lines.push(annotationLine(annotation));
  }
  const own = highlights.filter((highlight) => item.attachments.some((attachment) => attachment.key === highlight.attachmentKey));
  if (own.length) {
    lines.push("", "## Your highlights (this session)");
    for (const highlight of own) lines.push(highlightLine(highlight));
  }
  if (item.notes.length) {
    lines.push("", "## Notes");
    for (const note of item.notes) {
      const text = htmlToText(note.html);
      lines.push(`### Note ${note.key} (modified ${note.dateModified})`, text.length > 4_000 ? `${text.slice(0, 4_000)}…` : text);
    }
  }
  return lines.join("\n");
}

export function annotationLine(annotation: Annotation): string {
  const text = annotation.text ? ` “${annotation.text.replace(/\s+/g, " ").trim()}”` : "";
  const comment = annotation.comment ? ` — comment: ${annotation.comment.replace(/\s+/g, " ").trim()}` : "";
  const tags = annotation.tags.length ? ` [tags: ${annotation.tags.join(", ")}]` : "";
  return `- p. ${annotation.pageLabel} ${annotation.type} ${annotation.color}${text}${comment}${tags} (key ${annotation.key})`;
}

export function highlightLine(highlight: AgentHighlight): string {
  const comment = highlight.comment ? ` — ${highlight.comment}` : "";
  const saved = highlight.savedAs ? ` (saved to Zotero as ${highlight.savedAs})` : "";
  return `- ${highlight.id}: p. ${highlight.pageLabel} “${highlight.quote}”${comment}${saved}`;
}
