import { LIMITS, ZoteroError, type Creator } from "#z/contract.ts";
import { decodeEntities } from "#z/domain/items.ts";

/** 新建条目用的 Zotero 条目 JSON（不含 key / version）。 */
export interface NewItem {
  itemType: string;
  title: string;
  creators: Creator[];
  [field: string]: unknown;
}

export interface ResolvedMetadata {
  item: NewItem;
  /** 已知的开放获取 PDF 地址（arXiv 总有）。 */
  pdfUrl?: string;
  source: "doi" | "arxiv";
}

export type Identifier = { kind: "doi"; value: string } | { kind: "arxiv"; value: string };

/** 识别 DOI 与 arXiv 标识（含 doi.org / arxiv.org 链接与 arXiv 的 DOI）。 */
export function parseIdentifier(input: string): Identifier | null {
  const text = input.trim();
  const arxiv =
    /^(?:arxiv:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?)$/i.exec(text) ??
    /^(?:arxiv:\s*)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)$/i.exec(text) ??
    /arxiv\.org\/(?:abs|pdf|html)\/([a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?/i.exec(text) ??
    /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?10\.48550\/arxiv\.(\d{4}\.\d{4,5})$/i.exec(text);
  if (arxiv) return { kind: "arxiv", value: arxiv[1]!.replace(/v\d+$/i, "") };
  const doi = /(?:^|doi\.org\/|doi:\s*)(10\.\d{4,9}\/[^\s"<>]+)$/i.exec(text);
  if (doi) return { kind: "doi", value: decodeURIComponent(doi[1]!).replace(/[.,;]+$/, "") };
  return null;
}

// ---------------------------------------------------------------------------
// CSL-JSON（doi.org 内容协商）→ Zotero
// ---------------------------------------------------------------------------

interface CslName {
  family?: string;
  given?: string;
  literal?: string;
  name?: string;
}
interface CslDate {
  "date-parts"?: (number | string)[][];
  literal?: string;
  raw?: string;
}
export interface CslItem {
  type?: string;
  title?: string | string[];
  "container-title"?: string | string[];
  "collection-title"?: string;
  "short-container-title"?: string | string[];
  "event-title"?: string;
  event?: string | { name?: string };
  author?: CslName[];
  editor?: CslName[];
  issued?: CslDate;
  published?: CslDate;
  "published-print"?: CslDate;
  "published-online"?: CslDate;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  DOI?: string;
  URL?: string;
  ISSN?: string | string[];
  ISBN?: string | string[];
  publisher?: string;
  "publisher-place"?: string;
  abstract?: string;
  language?: string;
  number?: string | number;
  genre?: string;
  subtype?: string;
}

const CSL_TYPES: Record<string, string> = {
  "article-journal": "journalArticle",
  "journal-article": "journalArticle",
  "paper-conference": "conferencePaper",
  "proceedings-article": "conferencePaper",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  chapter: "bookSection",
  "book-chapter": "bookSection",
  "reference-entry": "bookSection",
  report: "report",
  thesis: "thesis",
  dissertation: "thesis",
  "posted-content": "preprint",
  article: "preprint",
  dataset: "dataset",
  webpage: "webpage",
  "article-magazine": "magazineArticle",
  "article-newspaper": "newspaperArticle",
  standard: "standard",
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || "";
const clean = (value: string) => decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function cslNames(names: CslName[] | undefined, creatorType: string): Creator[] {
  return (names ?? []).map((name) =>
    name.family
      ? { creatorType, firstName: name.given?.trim() ?? "", lastName: name.family.trim() }
      : { creatorType, name: (name.literal ?? name.name ?? "").trim() },
  ).filter((creator) => creator.lastName || creator.name);
}

function cslDate(item: CslItem): string {
  for (const date of [item.issued, item["published-print"], item["published-online"], item.published]) {
    const parts = date?.["date-parts"]?.[0];
    if (parts?.length && parts[0]) {
      const [year, month, day] = parts.map(Number);
      return [String(year).padStart(4, "0"), month ? String(month).padStart(2, "0") : "", day ? String(day).padStart(2, "0") : ""]
        .filter(Boolean)
        .join("-");
    }
    if (date?.literal || date?.raw) return String(date.literal ?? date.raw);
  }
  return "";
}

export function cslToZotero(csl: CslItem): NewItem {
  const itemType = CSL_TYPES[csl.type ?? ""] ?? "journalArticle";
  const container = clean(first(csl["container-title"]));
  const item: NewItem = {
    itemType,
    title: clean(first(csl.title)),
    creators: [...cslNames(csl.author, "author"), ...cslNames(csl.editor, "editor")],
    date: cslDate(csl),
    DOI: csl.DOI ?? "",
    url: csl.URL ?? "",
    abstractNote: csl.abstract ? clean(csl.abstract.replace(/<jats:title>[^<]*<\/jats:title>/g, "")) : "",
    language: csl.language ?? "",
    volume: csl.volume !== undefined ? String(csl.volume) : "",
    issue: csl.issue !== undefined ? String(csl.issue) : "",
    pages: csl.page ?? "",
    publisher: csl.publisher ?? "",
    place: csl["publisher-place"] ?? "",
    ISSN: first(csl.ISSN),
    ISBN: first(csl.ISBN),
    series: csl["collection-title"] ?? "",
    journalAbbreviation: clean(first(csl["short-container-title"])),
  };
  const event = typeof csl.event === "string" ? csl.event : (csl.event?.name ?? csl["event-title"] ?? "");
  if (itemType === "journalArticle" || itemType === "magazineArticle" || itemType === "newspaperArticle") item.publicationTitle = container;
  else if (itemType === "conferencePaper") {
    item.proceedingsTitle = container;
    item.conferenceName = event;
  } else if (itemType === "bookSection") item.bookTitle = container;
  else if (itemType === "preprint") {
    item.repository = csl.publisher ?? container;
    item.archiveID = csl.number !== undefined ? String(csl.number) : "";
  } else if (itemType === "report") {
    item.institution = csl.publisher ?? "";
    item.reportNumber = csl.number !== undefined ? String(csl.number) : "";
  } else if (itemType === "thesis") {
    item.university = csl.publisher ?? "";
    item.thesisType = csl.genre ?? "";
  } else if (itemType === "webpage") item.websiteTitle = container;
  return item;
}

// ---------------------------------------------------------------------------
// arXiv Atom → Zotero
// ---------------------------------------------------------------------------

const tag = (xml: string, name: string) => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return match ? clean(match[1]!) : "";
};

export function arxivToZotero(atom: string, id: string): ResolvedMetadata {
  const entry = /<entry>([\s\S]*?)<\/entry>/i.exec(atom)?.[1];
  if (!entry || /<title>\s*Error\s*<\/title>/i.test(entry))
    throw new ZoteroError("metadata_not_found", `arXiv has no paper ${id}.`);
  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/gi)].map((match) => clean(match[1]!));
  const creators: Creator[] = authors.map((name) => {
    const parts = name.split(" ");
    const lastName = parts.pop() ?? name;
    return { creatorType: "author", firstName: parts.join(" "), lastName };
  });
  const absId = tag(entry, "id"); // http://arxiv.org/abs/2401.01234v2
  const version = /v(\d+)$/.exec(absId)?.[1];
  const doi = tag(entry, "arxiv:doi");
  const published = tag(entry, "published").slice(0, 10);
  const categories = [...entry.matchAll(/<category[^>]*term="([^"]+)"/gi)].map((match) => match[1]!);
  const comment = tag(entry, "arxiv:comment");
  const journalRef = tag(entry, "arxiv:journal_ref");
  const item: NewItem = {
    itemType: "preprint",
    title: tag(entry, "title"),
    creators,
    abstractNote: tag(entry, "summary"),
    date: published,
    repository: "arXiv",
    archiveID: `arXiv:${id}`,
    url: `https://arxiv.org/abs/${id}`,
    DOI: `10.48550/arXiv.${id}`,
    extra: [comment && `Comment: ${comment}`, journalRef && `Journal reference: ${journalRef}`, doi && `Published DOI: ${doi}`]
      .filter(Boolean)
      .join("\n"),
    tags: categories.map((category) => ({ tag: category, type: 1 })),
  };
  return { item, pdfUrl: `https://arxiv.org/pdf/${id}${version ? `v${version}` : ""}`, source: "arxiv" };
}

// ---------------------------------------------------------------------------
// 网络
// ---------------------------------------------------------------------------

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const USER_AGENT = "ZCode-Zotero-Plugin/0.1 (+https://z.ai)";

export async function resolveIdentifier(identifier: Identifier, fetcher: Fetcher = fetch): Promise<ResolvedMetadata> {
  const signal = AbortSignal.timeout(LIMITS.metadataTimeoutMs);
  if (identifier.kind === "arxiv") {
    const response = await fetcher(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(identifier.value)}`, {
      headers: { "User-Agent": USER_AGENT },
      signal,
    }).catch((error) => {
      throw new ZoteroError("metadata_not_found", `Could not reach arXiv: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (!response.ok) throw new ZoteroError("metadata_not_found", `arXiv answered HTTP ${response.status}.`);
    return arxivToZotero(await response.text(), identifier.value);
  }
  const response = await fetcher(`https://doi.org/${encodeURI(identifier.value)}`, {
    headers: { Accept: "application/vnd.citationstyles.csl+json", "User-Agent": USER_AGENT },
    redirect: "follow",
    signal,
  }).catch((error) => {
    throw new ZoteroError("metadata_not_found", `Could not reach doi.org: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (response.status === 404) throw new ZoteroError("metadata_not_found", `doi.org does not know DOI ${identifier.value}.`);
  if (!response.ok) throw new ZoteroError("metadata_not_found", `doi.org answered HTTP ${response.status} for ${identifier.value}.`);
  let csl: CslItem;
  try {
    csl = (await response.json()) as CslItem;
  } catch {
    throw new ZoteroError("metadata_not_found", `doi.org returned no citation data for ${identifier.value}.`);
  }
  const item = cslToZotero(csl);
  if (!item.DOI) item.DOI = identifier.value;
  if (!item.title) throw new ZoteroError("metadata_not_found", `The metadata for ${identifier.value} has no title.`);
  return { item, source: "doi" };
}

/** 下载 PDF：只接受 http(s)，限制大小，校验 %PDF 文件头。 */
export async function downloadPdf(url: string, fetcher: Fetcher = fetch): Promise<{ bytes: Uint8Array; filename: string; finalUrl: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ZoteroError("invalid_input", `Not a URL: ${url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new ZoteroError("invalid_input", "PDF URLs must use http or https.");
  const response = await fetcher(parsed.href, {
    headers: { Accept: "application/pdf,*/*;q=0.5", "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(LIMITS.downloadTimeoutMs),
  }).catch((error) => {
    throw new ZoteroError("download_failed", `Could not download ${url}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!response.ok) throw new ZoteroError("download_failed", `Downloading ${url} failed with HTTP ${response.status}.`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > LIMITS.downloadBytes) throw new ZoteroError("download_failed", `The file at ${url} is too large.`);
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader)
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > LIMITS.downloadBytes) {
        await reader.cancel();
        throw new ZoteroError("download_failed", `The file at ${url} is too large.`);
      }
      chunks.push(value);
    }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (!Buffer.from(bytes.subarray(0, 1024)).toString("latin1").includes("%PDF-"))
    throw new ZoteroError(
      "download_failed",
      `${url} did not return a PDF (got ${response.headers.get("content-type") ?? "unknown content"}). It may be behind a login or a landing page; find a direct PDF link.`,
    );
  const finalUrl = response.url || parsed.href;
  const disposition = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(response.headers.get("content-disposition") ?? "")?.[1];
  const fromPath = decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() ?? "");
  return { bytes, filename: safeFilename(disposition ?? fromPath ?? "document.pdf"), finalUrl };
}

/** 存储文件名：去掉路径与控制字符，保证 .pdf 后缀。 */
export function safeFilename(name: string): string {
  const base = [...name]
    .map((char) => (char.charCodeAt(0) < 32 ? " " : char))
    .join("")
    .replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || "document";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

/** Zotero 风格的 PDF 文件名：“作者 - 年份 - 标题.pdf”。 */
export function zoteroFilename(item: { title: string; creators: Creator[]; date?: unknown }): string {
  const authors = item.creators.filter((creator) => creator.creatorType === "author");
  const last = (creator: Creator) => creator.lastName || creator.name || "";
  const who = authors.length === 0 ? "" : authors.length === 1 ? last(authors[0]!) : authors.length === 2 ? `${last(authors[0]!)} and ${last(authors[1]!)}` : `${last(authors[0]!)} et al.`;
  const year = /\d{4}/.exec(String(item.date ?? ""))?.[0] ?? "";
  const title = item.title.replace(/[:?]/g, "").slice(0, 100);
  return safeFilename([who, year, title].filter(Boolean).join(" - "));
}
