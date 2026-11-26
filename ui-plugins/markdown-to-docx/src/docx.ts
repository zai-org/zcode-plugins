import { strToU8, zipSync } from "fflate";
import { Lexer, type Token, type Tokens } from "marked";

export interface DocOpts { latin: string; cjk: string; size: number; page: "A4" | "Letter"; margin: number; toc: boolean; title: string; author: string; breakH1: boolean }
export interface Image { data: Uint8Array; ext: "png" | "jpeg"; w: number; h: number }

const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function imageSize(b: Uint8Array): { w: number; h: number; ext: "png" | "jpeg" } | undefined {
  if (b[0] === 0x89 && b[1] === 0x50) return { ext: "png", w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let p = 2; p + 9 < b.length; ) {
      if (b[p] !== 0xff) return undefined;
      const m = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { ext: "jpeg", h: (b[p + 5] << 8) | b[p + 6], w: (b[p + 7] << 8) | b[p + 8] };
      p += 2 + len;
    }
  }
  return undefined;
}

interface Run { text: string; b?: boolean; i?: boolean; s?: boolean; code?: boolean; link?: string; br?: boolean }

export class DocBuilder {
  body: string[] = [];
  rels: string[] = [];
  media: Record<string, Uint8Array> = {};
  nums: number[] = []; // 每个列表实例对应的 abstractNum（0 无序，1 有序）
  links = new Map<string, string>();
  stats = { headings: 0, tables: 0, images: 0, missing: [] as string[], lists: 0, code: 0 };
  outline: { level: number; text: string }[] = [];
  private bm = 0;
  private o: DocOpts;
  private images: (src: string) => Image | undefined;
  constructor(o: DocOpts, images: (src: string) => Image | undefined) { this.o = o; this.images = images; }

  private rel(type: string, target: string, external = false) {
    const id = `rId${this.rels.length + 10}`;
    this.rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${x(target)}"${external ? ' TargetMode="External"' : ""}/>`);
    return id;
  }
  private runs(tokens: Token[] | undefined, base: Omit<Run, "text"> = {}): Run[] {
    const out: Run[] = [];
    for (const t of tokens ?? []) {
      switch (t.type) {
        case "strong": out.push(...this.runs((t as Tokens.Strong).tokens, { ...base, b: true })); break;
        case "em": out.push(...this.runs((t as Tokens.Em).tokens, { ...base, i: true })); break;
        case "del": out.push(...this.runs((t as Tokens.Del).tokens, { ...base, s: true })); break;
        case "codespan": out.push({ ...base, text: unesc((t as Tokens.Codespan).text), code: true }); break;
        case "link": out.push(...this.runs((t as Tokens.Link).tokens, { ...base, link: (t as Tokens.Link).href })); break;
        case "br": out.push({ text: "", br: true }); break;
        case "image": out.push({ ...base, text: `[${(t as Tokens.Image).text}]` }); break;
        case "text": { const tt = t as Tokens.Text; if (tt.tokens?.length) out.push(...this.runs(tt.tokens, base)); else out.push({ ...base, text: unesc(tt.text) }); break; }
        case "escape": out.push({ ...base, text: unesc((t as Tokens.Escape).text) }); break;
        case "html": out.push({ ...base, text: (t as Tokens.HTML).text.replace(/<[^>]+>/g, "") }); break;
        default: if ("text" in t) out.push({ ...base, text: unesc(String((t as { text: string }).text)) });
      }
    }
    return out;
  }
  private runXml(r: Run) {
    if (r.br) return "<w:r><w:br/></w:r>";
    const pr = [r.b ? "<w:b/><w:bCs/>" : "", r.i ? "<w:i/><w:iCs/>" : "", r.s ? "<w:strike/>" : "", r.code ? '<w:rStyle w:val="CodeChar"/>' : "", r.link ? '<w:rStyle w:val="Hyperlink"/>' : ""].join("");
    const text = r.text.split("\n").map((s, k) => (k ? "<w:br/>" : "") + `<w:t xml:space="preserve">${x(s)}</w:t>`).join("");
    const run = `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}${text}</w:r>`;
    if (!r.link) return run;
    if (r.link.startsWith("#")) return `<w:hyperlink w:anchor="${x(r.link.slice(1))}">${run}</w:hyperlink>`;
    if (!this.links.has(r.link)) this.links.set(r.link, this.rel("hyperlink", r.link, true));
    return `<w:hyperlink r:id="${this.links.get(r.link)}">${run}</w:hyperlink>`;
  }
  private p(runs: Run[], style?: string, extra = "") {
    this.body.push(`<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>` : ""}${runs.map((r) => this.runXml(r)).join("")}</w:p>`);
  }
  private image(src: string, alt: string) {
    const img = this.images(src);
    if (!img) { this.stats.missing.push(src); this.p([{ text: `[图片缺失 / missing image: ${src}]`, i: true }]); return; }
    const n = Object.keys(this.media).length + 1;
    const name = `image${n}.${img.ext === "jpeg" ? "jpg" : "png"}`;
    this.media[`word/media/${name}`] = img.data;
    const id = this.rel("image", `media/${name}`);
    const maxW = ((this.o.page === "A4" ? 210 : 215.9) - 2 * this.o.margin) * 36000;
    let cx = img.w * 9525, cy = img.h * 9525;
    if (cx > maxW) { cy = Math.round((cy * maxW) / cx); cx = Math.round(maxW); }
    this.stats.images++;
    this.body.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="${x(name)}" descr="${x(alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${x(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    if (alt) this.p([{ text: alt }], "Caption");
  }
  private list(t: Tokens.List, level: number, numId?: number) {
    const id = numId ?? (this.nums.push(t.ordered ? 1 : 0), this.nums.length);
    if (level === 0) this.stats.lists++;
    for (const item of t.items) {
      let first = true;
      for (const c of item.tokens) {
        if (c.type === "list") { this.list(c as Tokens.List, level + 1, (c as Tokens.List).ordered === t.ordered ? id : undefined); continue; }
        const runs = c.type === "text" || c.type === "paragraph" ? this.runs((c as Tokens.Text).tokens ?? [{ type: "text", raw: (c as Tokens.Text).text, text: (c as Tokens.Text).text } as Tokens.Text]) : [{ text: (c as { raw: string }).raw.trim() }];
        if (item.task) runs.unshift({ text: item.checked ? "☑ " : "☐ " });
        this.p(runs, "ListParagraph", first ? `<w:numPr><w:ilvl w:val="${Math.min(level, 8)}"/><w:numId w:val="${id}"/></w:numPr>` : `<w:ind w:left="${720 * (level + 1)}"/>`);
        first = false;
      }
    }
  }
  private table(t: Tokens.Table) {
    this.stats.tables++;
    const jc = (a: string | null) => (a === "right" ? "right" : a === "center" ? "center" : "left");
    const cell = (tokens: Token[], align: string | null, header: boolean) => `<w:tc><w:tcPr>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF2FF"/>' : ""}</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:jc w:val="${jc(align)}"/></w:pPr>${this.runs(tokens, header ? { b: true } : {}).map((r) => this.runXml(r)).join("")}</w:p></w:tc>`;
    const rows = [`<w:tr><w:trPr><w:tblHeader/></w:trPr>${t.header.map((h, i) => cell(h.tokens, t.align[i], true)).join("")}</w:tr>`, ...t.rows.map((r) => `<w:tr>${r.map((c, i) => cell(c.tokens, t.align[i], false)).join("")}</w:tr>`)];
    this.body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid>${t.header.map(() => "<w:gridCol/>").join("")}</w:tblGrid>${rows.join("")}</w:tbl>`);
    this.p([]);
  }
  private slug() { return `h_${++this.bm}`; }
  add(md: string, first: boolean) {
    const tokens = new Lexer({ gfm: true }).lex(md);
    for (const t of tokens) this.block(t, first);
  }
  private block(t: Token, firstDoc: boolean) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        const runs = this.runs(h.tokens);
        const text = runs.map((r) => r.text).join("");
        this.stats.headings++;
        this.outline.push({ level: h.depth, text });
        const name = this.slug();
        const brk = this.o.breakH1 && h.depth === 1 && !firstDoc && this.body.length ? '<w:pageBreakBefore/>' : "";
        this.body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${Math.min(h.depth, 4)}"/>${brk}</w:pPr><w:bookmarkStart w:id="${this.bm}" w:name="${name}"/>${runs.map((r) => this.runXml(r)).join("")}<w:bookmarkEnd w:id="${this.bm}"/></w:p>`);
        break;
      }
      case "paragraph": {
        const pt = t as Tokens.Paragraph;
        if (pt.tokens.length === 1 && pt.tokens[0].type === "image") { const im = pt.tokens[0] as Tokens.Image; this.image(im.href, im.text); break; }
        const parts: Token[][] = [[]];
        for (const c of pt.tokens) { if (c.type === "image") { parts.push([c], []); } else parts[parts.length - 1].push(c); }
        for (const part of parts) {
          if (part.length === 1 && part[0].type === "image") { const im = part[0] as Tokens.Image; this.image(im.href, im.text); }
          else if (part.length && part.some((c) => (c as { raw: string }).raw.trim())) this.p(this.runs(part));
        }
        break;
      }
      case "list": this.list(t as Tokens.List, 0); break;
      case "table": this.table(t as Tokens.Table); break;
      case "blockquote": for (const c of (t as Tokens.Blockquote).tokens) { if (c.type === "paragraph") this.p(this.runs((c as Tokens.Paragraph).tokens), "Quote"); else this.block(c, firstDoc); } break;
      case "code": { this.stats.code++; const lines = (t as Tokens.Code).text.split("\n"); lines.forEach((l, k) => this.p([{ text: l }], "Code", k === 0 ? "" : '<w:spacing w:before="0"/>')); break; }
      case "hr": this.body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>'); break;
      case "html": { const txt = (t as Tokens.HTML).text; if (/<!--\s*pagebreak\s*-->/i.test(txt)) this.body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); else if (txt.replace(/<[^>]+>/g, "").trim()) this.p([{ text: txt.replace(/<[^>]+>/g, "").trim() }]); break; }
      case "space": break;
      default: if ("text" in t) this.p([{ text: String((t as { text: string }).text) }]);
    }
  }

  build(): Uint8Array {
    const o = this.o;
    const [pw, ph] = o.page === "A4" ? [11906, 16838] : [12240, 15840];
    const mar = Math.round(o.margin * 56.7);
    const toc = o.toc ? `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>目录 Contents</w:t></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>（打开文档后右键 → 更新域 即可生成目录 / Right-click → Update Field to build the table of contents）</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p>` : "";
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${toc}${this.body.join("")}<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="${pw}" w:h="${ph}"/><w:pgMar w:top="${mar}" w:right="${mar}" w:bottom="${mar}" w:left="${mar}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const sz = Math.round(o.size * 2);
    const font = `<w:rFonts w:ascii="${x(o.latin)}" w:hAnsi="${x(o.latin)}" w:eastAsia="${x(o.cjk)}" w:cs="${x(o.latin)}"/>`;
    const hd = (n: number, size: number) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${n === 1 ? "1F2937" : "111827"}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${hd(1, sz + 16)}${hd(2, sz + 8)}${hd(3, sz + 4)}${hd(4, sz + 2)}` +
      `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="9CA3AF"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:color w:val="4B5563"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="${sz - 2}"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="6B7280"/><w:sz w:val="${sz - 3}"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>` +
      `<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2563EB"/><w:u w:val="single"/></w:rPr></w:style>` +
      `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideV w:val="single" w:sz="4" w:color="D1D5DB"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
    const lvl = (k: number, ordered: boolean) => `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? (k % 3 === 1 ? "lowerLetter" : k % 3 === 2 ? "lowerRoman" : "decimal") : "bullet"}"/><w:lvlText w:val="${ordered ? `%${k + 1}.` : ["•", "◦", "▪"][k % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (k + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
    const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${[0, 1].map((a) => `<w:abstractNum w:abstractNumId="${a}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, k) => lvl(k, a === 1)).join("")}</w:abstractNum>`).join("")}${this.nums.map((a, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${a}"/>${a === 1 ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ""}</w:num>`).join("")}</w:numbering>`;
    const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${this.rels.join("")}</Relationships>`;
    const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${o.toc ? '<w:updateFields w:val="true"/>' : ""}<w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(o.title)}</dc:title><dc:creator>${x(o.author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    return zipSync({ "[Content_Types].xml": strToU8(types), "_rels/.rels": strToU8(root), "docProps/core.xml": strToU8(core), "word/document.xml": strToU8(doc), "word/styles.xml": strToU8(styles), "word/numbering.xml": strToU8(numbering), "word/footer1.xml": strToU8(footer), "word/settings.xml": strToU8(settings), "word/_rels/document.xml.rels": strToU8(docRels), ...this.media });
  }
}
