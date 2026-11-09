import type { ItemSummary, LibraryId } from "#z/contract.ts";
import { host } from "#ui/bridge.ts";

/** 面板选中的内容如何进入对话：作为模型上下文（不发消息），或连同用户的问题作为一条消息。 */

export interface QuoteRef {
  library: LibraryId;
  itemKey: string;
  attachmentKey: string;
  title: string;
  pageIndex: number;
  pageLabel: string;
  text: string;
}

const libraryNote = (library: LibraryId) => (library === "user" ? "" : ` in library ${library}`);

function itemRef(item: ItemSummary): string {
  const who = [item.creatorSummary, item.year && `(${item.year})`].filter(Boolean).join(" ");
  return `[${item.key}] ${item.title}${who ? ` — ${who}` : ""}${item.pdf ? ` · PDF ${item.pdf.key}` : ""}`;
}

function pageRef(quote: QuoteRef) {
  return `page ${quote.pageIndex + 1}${quote.pageLabel !== String(quote.pageIndex + 1) ? ` (printed ${quote.pageLabel})` : ""}`;
}

export async function addItemsToContext(items: ItemSummary[], library: LibraryId) {
  const text = [`The user selected ${items.length} Zotero item(s)${libraryNote(library)} in the Zotero panel:`, ...items.map((item) => `- ${itemRef(item)}`)].join("\n");
  await host.updateModelContext(text, { zotero: { library, selection: items.map((item) => item.key) } });
}

export async function askAboutItems(question: string, items: ItemSummary[], library: LibraryId) {
  const refs = items.map((item) => `- ${itemRef(item)}`).join("\n");
  await host.sendMessage(`${question.trim()}\n\nZotero items${libraryNote(library)}:\n${refs}`);
}

function quoteBlock(quote: QuoteRef) {
  const text = quote.text.replace(/\s+/g, " ").trim();
  return `> ${text}\n\n— “${quote.title}”, ${pageRef(quote)} (Zotero item ${quote.itemKey}, PDF ${quote.attachmentKey}${libraryNote(quote.library)})`;
}

export async function addQuoteToContext(quote: QuoteRef) {
  await host.updateModelContext(`The user selected this passage in the Zotero panel:\n\n${quoteBlock(quote)}`, {
    zotero: { library: quote.library, itemKey: quote.itemKey, attachmentKey: quote.attachmentKey, page: quote.pageIndex + 1, quote: quote.text },
  });
}

export async function askAboutQuote(question: string, quote: QuoteRef) {
  await host.sendMessage(`${question.trim()}\n\n${quoteBlock(quote)}`);
}
