/* zcode-workflow
name: 参考文献真实性核查
args:
  manuscript:
    type: string
    required: true
    description: 手稿路径（工作区相对，.tex 需含内嵌 thebibliography）
*/
// reference-verify 的 ZCode 动态工作流版本：阶段 1 解析门控 → 阶段 2 官方 API 机核 →
// 阶段 3 联网核查 + 链式独立复核。方法与纪律见同目录 ../SKILL.md。
// 实测教训已内建：arXiv 逐条单查（批量 id_list 会截断）；CrossRef 不加 select；
// OpenReview api2 在沙箱 SSL 失败、Zotero 本地 API 不可达——这两类条目全部交联网核查员。

interface BibEntry {
  /** bibitem 引用键，逐字保留。 */
  key: string;
  /** 照录作者串。 */
  authors: string;
  /** 第一作者姓氏（小写、无变音符）。 */
  firstAuthorSurname: string;
  /** 题名（去 LaTeX 标记）。 */
  title: string;
  /** 发表年份，4 位数字。 */
  year: string;
  /** 期刊/会议/出版社，没有则 "none"。 */
  venue: string;
  /** DOI（无前缀），没有则空串。 */
  doi: string;
  /** arXiv 编号，没有则空串。 */
  arxivId: string;
}

interface ParsedBib {
  entries: BibEntry[];
}

interface CheckResult {
  /** ok=机核通过；mismatch=有记录但字段不符；unresolved=无记录或请求失败。 */
  outcome: "ok" | "mismatch" | "unresolved";
  /** 一两句证据，含 API URL 与比对结果。 */
  evidence: string;
}

interface Verdict {
  key: string;
  /** verified=存在且书目基本一致；metadata_error=存在但字段明显不符；not_found=多源无果；suspicious=相近但无法确认。 */
  status: "verified" | "metadata_error" | "not_found" | "suspicious";
  /** 2-3 句证据，必须附可访问 URL。 */
  evidence: string;
  /** metadata_error 给出正确书目；其余可空串。 */
  note: string;
}

interface Confirmation {
  /** 独立复核是否支持原判定。 */
  agrees: boolean;
  /** 一句话，附关键 URL。 */
  note: string;
}

interface Finding {
  where: string;
  what: string;
  evidence: string;
  status: "verified" | "unconfirmed";
  severity: "low" | "medium" | "high";
}

interface WorkflowReport {
  conclusion: string;
  findings: Finding[];
  verified: string[];
  notCovered: string[];
}

function short(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function normText(s: string): string {
  return s
    .replace(/\\[a-zA-Z]+ ?/g, " ")
    .replace(/[{}~$]/g, " ")
    .replace(/&amp;/g, " and ")
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toks(s: string): string[] {
  return normText(s).split(" ").filter(w => w.length > 2);
}

function overlapRatio(a: string, b: string): number {
  const A = new Set(toks(a));
  const B = new Set(toks(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

function authorMatch(bib: string, api: string): boolean {
  const a = normText(bib);
  const b = normText(api);
  if (a.length === 0 || b.length === 0) return true;
  return a === b || b.includes(a) || a.includes(b);
}

function yearOk(bibYear: string, apiYear: number): boolean {
  const y = parseInt(bibYear, 10);
  return !isNaN(y) && apiYear > 0 && Math.abs(y - apiYear) <= 1;
}

function entryBlock(e: BibEntry): string {
  return [
    `引用键：${e.key}`, `题名：${e.title}`, `作者：${e.authors}`,
    `第一作者姓氏：${e.firstAuthorSurname}`, `年份：${e.year}`, `出处：${e.venue}`,
    e.doi ? `DOI：${e.doi}` : "DOI：无",
    e.arxivId ? `arXiv：${e.arxivId}` : "arXiv：无",
  ].join("\n");
}

const MS = String(args.manuscript ?? "");
if (MS.length === 0) {
  return { conclusion: "缺少 manuscript 参数", findings: [], verified: [], notCovered: ["全部"] } as WorkflowReport;
}

artifact.table("refs", {
  title: "逐条核查进度",
  columns: [
    { field: "key", label: "引文键" },
    { field: "title", label: "题名" },
    { field: "status", label: "结论" },
    { field: "evidence", label: "证据" },
  ],
  key: "key",
});

phase("解析参考文献并校验清单完整性");
const bibGrep = await files.grep("^\\\\bibitem", MS);
const citeGrep = await files.grep("\\\\cite[tp]?\\{", MS);
const bibLines: { key: string; line: number; raw: string }[] = [];
for (const g of bibGrep) {
  const m = /^\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}\s*([\s\S]*)$/.exec(g.text);
  if (m) bibLines.push({ key: m[1], line: g.line, raw: g.text });
}
const citeKeys = new Set<string>();
for (const g of citeGrep) {
  const re = /\\cite[tp]?\{([^}]*)\}/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(g.text)) !== null) {
    for (const k of mm[1].split(",")) {
      if (k.trim()) citeKeys.add(k.trim());
    }
  }
}
const bibKeys = bibLines.map(b => b.key);
const uncited = bibKeys.filter(k => !citeKeys.has(k));
const missing = [...citeKeys].filter(k => !bibKeys.includes(k));
log(`thebibliography 共 ${bibLines.length} 条，正文引用键 ${citeKeys.size} 个`);

const extractor = agent("引文信息解析员", {
  system: "你是文献书目数据解析员：从 LaTeX thebibliography 条目中精确抽取结构化字段，不增不漏、逐字保留引用键。只读不写。",
});
let feedback = "";
let entries: BibEntry[] = [];
for (let round = 1; round <= 3; round += 1) {
  const res = await extractor.ask<ParsedBib>(
    `解析下面 ${bibLines.length} 条 bibitem。字段：key（逐字）、authors（照录）、firstAuthorSurname（第一作者姓氏小写无变音符，et al. 不算）、title（去 LaTeX 标记）、year（条目尾 4 位年，label 年兜底）、venue（期刊/会议/出版社，没有写 "none"）、doi（10. 开头无前缀，无则 ""）、arxivId（如 2407.19633，无则 ""）。entries 一一对应、不增不漏。上一轮问题：${feedback || "无"}。\n\n` +
      bibLines.map((b, i) => `[${i + 1}] ${b.raw}`).join("\n"),
  );
  const got = new Set(res.entries.map(x => x.key));
  const miss = bibKeys.filter(k => !got.has(k));
  const extra = res.entries.filter(x => !bibKeys.includes(x.key)).map(x => x.key);
  if (res.entries.length === bibLines.length && miss.length === 0 && extra.length === 0) {
    entries = res.entries;
    break;
  }
  feedback = `返回 ${res.entries.length} 条（应为 ${bibLines.length}）；缺失：${miss.join(", ") || "无"}；多余：${extra.join(", ") || "无"}`;
}
if (entries.length === 0) {
  return {
    conclusion: `清单解析三轮未通过校验，核查中止。${feedback}`,
    findings: [], verified: [`脚本侧确认 ${bibLines.length} 条 bibitem / ${citeKeys.size} 个引用键`],
    notCovered: [`全部 ${bibLines.length} 条未核查（解析失败）`],
  } as WorkflowReport;
}
// 解析员漏抽的 ID 由脚本从原文正则兜底
for (const e of entries) {
  const raw = bibLines.find(b => b.key === e.key)?.raw ?? "";
  if (!e.doi) {
    const m = /doi\.org\/(10\.[^}\s]+)/.exec(raw);
    if (m) e.doi = m[1];
  }
  if (!e.arxivId) {
    const m = /arxiv\.org\/abs\/([0-9]{4}\.[0-9]{4,5})/.exec(raw) ?? /arXiv:([0-9]{4}\.[0-9]{4,5})/i.exec(raw);
    if (m) e.arxivId = m[1];
  }
}

const lineOf = new Map(bibLines.map(b => [b.key, b.line]));
const checks = new Map<string, CheckResult>();

phase("带 DOI / arXiv / PMLR 链接的文献先过官方接口机核");
let crossrefOk = 0;
let crossrefN = 0;
for (const e of entries) {
  if (!e.doi) continue;
  crossrefN += 1;
  const url = `https://api.crossref.org/works/${e.doi}`;
  const r = await world.run("curl", ["-sS", "-f", "--max-time", "40", url]);
  if (r.exitCode !== 0) {
    checks.set(e.key, { outcome: "unresolved", evidence: `CrossRef 请求失败（exit ${r.exitCode}）：${url}` });
    continue;
  }
  try {
    const msg = JSON.parse(r.stdout).message;
    const apiTitle = Array.isArray(msg.title) ? String(msg.title[0] ?? "") : "";
    const fam = Array.isArray(msg.author) && msg.author.length > 0
      ? String(msg.author[0].family ?? msg.author[0].name ?? "") : "";
    const yr = Number(msg.issued?.["date-parts"]?.[0]?.[0] ?? 0);
    const container = Array.isArray(msg["container-title"]) ? String(msg["container-title"][0] ?? "") : "";
    if (overlapRatio(e.title, apiTitle) >= 0.75 && authorMatch(e.firstAuthorSurname, fam) && yearOk(e.year, yr)) {
      crossrefOk += 1;
      checks.set(e.key, { outcome: "ok", evidence: `CrossRef 匹配（首作者 ${fam || "?"}/年 ${yr}/期刊 ${container || "无"}）：${url}` });
    } else {
      checks.set(e.key, { outcome: "mismatch", evidence: `CrossRef 不符：线上题名「${short(apiTitle, 120)}」/首作者 ${fam || "?"}/年 ${yr}：${url}` });
    }
  } catch {
    checks.set(e.key, { outcome: "unresolved", evidence: `CrossRef 返回无法解析：${url}` });
  }
}

let arxivOk = 0;
const arxivEntries = entries.filter(e => e.arxivId);
for (const e of arxivEntries) {
  // 逐条单查：批量 id_list 在沙箱会截断（实测教训）
  const url = `https://export.arxiv.org/api/query?id_list=${e.arxivId}`;
  const r = await world.run("curl", ["-sS", "--max-time", "45", url]);
  const en = r.stdout.split("<entry>")[1] ?? "";
  const tm = /<title>([\s\S]*?)<\/title>/.exec(en);
  const am = /<name>([\s\S]*?)<\/name>/.exec(en);
  const pm = /<published>(\d{4})/.exec(en);
  const jr = /<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/.exec(en);
  const cm = /<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/.exec(en);
  const apiTitle = tm ? tm[1].replace(/\s+/g, " ").trim() : "";
  if (!apiTitle || /error/i.test(apiTitle)) {
    checks.set(e.key, { outcome: "unresolved", evidence: `arXiv 无该编号记录：${url}` });
    continue;
  }
  const pub = `${jr ? "journal_ref「" + jr[1].trim() + "」" : ""}${cm ? " comment「" + short(cm[1], 100) + "」" : ""}`;
  if (overlapRatio(e.title, apiTitle) >= 0.75
    && authorMatch(e.firstAuthorSurname, am ? am[1] : "")
    && (!pm || yearOk(e.year, parseInt(pm[1], 10)))) {
    arxivOk += 1;
    checks.set(e.key, { outcome: "ok", evidence: `arXiv 匹配（题名/首作者/发布 ${pm ? pm[1] : "?"}）${pub}：${url}` });
  } else {
    checks.set(e.key, { outcome: "mismatch", evidence: `arXiv 不符：线上题名「${short(apiTitle, 120)}」${pub}：${url}` });
  }
}

let pmlrOk = 0;
let pmlrN = 0;
for (const e of entries) {
  const raw = bibLines.find(b => b.key === e.key)?.raw ?? "";
  const pm = /proceedings\.mlr\.press\/([^}\s]+)/.exec(raw);
  if (!pm) continue;
  pmlrN += 1;
  const url = `https://proceedings.mlr.press/${pm[1]}`;
  const r = await world.run("curl", ["-sS", "-f", "--max-time", "40", url]);
  if (r.exitCode !== 0) {
    checks.set(e.key, { outcome: "unresolved", evidence: `PMLR 请求失败：${url}` });
    continue;
  }
  const page = r.stdout.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
  if (overlapRatio(e.title, page) >= 0.8 && authorMatch(e.firstAuthorSurname, page)) {
    pmlrOk += 1;
    checks.set(e.key, { outcome: "ok", evidence: `PMLR 官方页面含该题名与作者：${url}` });
  } else {
    checks.set(e.key, { outcome: "mismatch", evidence: `PMLR 页面未匹配：${url}` });
  }
}

const toVerify = entries.filter(e => checks.get(e.key)?.outcome !== "ok");
log(`机核：${entries.length - toVerify.length}/${entries.length} 通过，${toVerify.length} 条转联网核查`);
for (const e of entries) {
  const c = checks.get(e.key);
  if (c && c.outcome === "ok") {
    report({ key: e.key, title: short(e.title, 48), status: "机核通过", evidence: short(c.evidence, 200) }, "refs");
  }
}

phase("其余文献逐条联网核实，存疑结论独立复核");
const VERIFY_SYS =
  "你是学术文献真实性核查员，只依据可复查的线上证据下结论：每个判定附可访问 URL；检索不到如实报告，绝不编造文献、编号或链接。只读不写。";
const CONFIRM_SYS =
  "你是独立文献复核员，不预设立场、不采信他人结论，只用自己检索到的证据判断核查结论是否成立。只读不写。";

const webResults = await Promise.all(
  toVerify.map(async e => {
    const c = checks.get(e.key);
    const hint = !c
      ? "该条目无 DOI/arXiv 编号（常见于书籍、书章、经典期刊论文）。"
      : `机核${c.outcome === "mismatch" ? "发现不符，请重点复查" : "未决，请补充确认"}：${c.evidence}`;
    const verdict = await agent(`联网核查员-${e.key}`, { system: VERIFY_SYS }).ask<Verdict>(
      `核查该参考文献是否真实存在。\n\n【条目】\n${entryBlock(e)}\n\n【机核线索】${hint}\n\n` +
        `要求：用联网手段核查（搜索/抓取/curl 皆可：CrossRef works?query.bibliographic、OpenAlex、Semantic Scholar、arXiv、dblp、WorldCat、Google Books、出版社官网、OpenReview 网页版）；` +
        `四要素（题名/作者/年份/出处）一致才 verified，字段不符给 metadata_error 并在 note 写正确值，多源无果 not_found，相近不确认 suspicious；` +
        `evidence 必须含命中源与 URL，无 URL 的结论不被接受；检索不到如实报告。evidence/note 用中文。`,
    );
    report({ key: e.key, title: short(e.title, 48), status: verdict.status, evidence: short(verdict.evidence, 200) }, "refs");
    if (verdict.status === "verified") {
      return { entry: e, verdict, confirmation: undefined as Confirmation | undefined };
    }
    const confirmation = await agent(`独立复核员-${e.key}`, { system: CONFIRM_SYS }).ask<Confirmation>(
      `独立复核下面这条核查结论是否成立（不要采信原判定，自己重新检索）。\n\n【条目】\n${entryBlock(e)}\n\n【待复核】${JSON.stringify(verdict)}\n\n` +
        `agrees=true 仅当你的独立证据支持它；note 一句话附关键 URL。`,
    );
    report(
      { key: e.key, title: short(e.title, 48),
        status: verdict.status + (confirmation.agrees ? "（复核支持）" : "（复核未支持）"),
        evidence: short(`${verdict.evidence} 复核：${confirmation.note}`, 200) },
      "refs",
    );
    return { entry: e, verdict, confirmation };
  }),
);

const findings: Finding[] = [];
const rows: string[] = [];
for (const e of entries) {
  const ln = lineOf.get(e.key) ?? 0;
  const c = checks.get(e.key);
  if (c && c.outcome === "ok") {
    rows.push(`| ${e.key}（${ln}） | ${short(e.title, 60).replace(/\|/g, "/")} | 机核通过 | ${short(c.evidence, 180).replace(/\|/g, "/")} |`);
  }
}
for (const w of webResults) {
  const e = w.entry;
  const ln = lineOf.get(e.key) ?? 0;
  if (w.verdict.status === "verified") {
    rows.push(`| ${e.key}（${ln}） | ${short(e.title, 60).replace(/\|/g, "/")} | 联网确认存在 | ${short(w.verdict.evidence, 180).replace(/\|/g, "/")} |`);
    continue;
  }
  const confNote = w.confirmation ? `独立复核：${w.confirmation.note}` : "";
  rows.push(`| ${e.key}（${ln}） | ${short(e.title, 60).replace(/\|/g, "/")} | ⚠ ${w.verdict.status}${w.confirmation ? (w.confirmation.agrees ? "（复核支持）" : "（复核未支持）") : ""} | ${short(w.verdict.evidence + " " + confNote, 180).replace(/\|/g, "/")} |`);
  findings.push({
    where: `${MS}:${ln}`,
    what: `「${short(e.title, 80)}」核查判定 ${w.verdict.status}${w.verdict.note ? "：" + short(w.verdict.note, 160) : ""}`,
    evidence: `${w.verdict.evidence}${confNote ? " " + confNote : ""}`,
    status: w.confirmation?.agrees ? "verified" : "unconfirmed",
    severity: w.verdict.status === "suspicious" ? "medium" : "high",
  });
}
for (const k of uncited) {
  findings.push({ where: `${MS}:${lineOf.get(k) ?? 0}`, what: `${k} 未被正文引用`, evidence: "脚本门控：不在 cite 键集合", status: "verified", severity: "low" });
}
for (const k of missing) {
  findings.push({ where: MS, what: `正文引用 ${k} 但无 bibitem`, evidence: "脚本门控：不在 bibitem 键集合", status: "verified", severity: "medium" });
}

const machineOk = entries.length - toVerify.length;
const webOk = webResults.filter(w => w.verdict.status === "verified").length;
const conclusion =
  `共核查 ${entries.length} 条：${machineOk + webOk} 条确认真实存在（机核 ${machineOk}（CrossRef ${crossrefOk}/${crossrefN}、arXiv ${arxivOk}/${arxivEntries.length}、PMLR ${pmlrOk}/${pmlrN}），联网 ${webOk}），` +
  `${webResults.length - webOk} 条存在问题或存疑。` +
  (uncited.length ? `另有 ${uncited.length} 条未被引用。` : "") + (missing.length ? `${missing.length} 个引用键缺 bibitem。` : "");

await artifact.markdown("report", [
  "# 参考文献真实性核查报告",
  "",
  `手稿 ${MS}（thebibliography ${entries.length} 条，引用键 ${citeKeys.size} 个）。`,
  "",
  "## 总体结论",
  "",
  conclusion,
  "",
  "| 引文键（行号） | 题名 | 结论 | 证据 |",
  "|---|---|---|---|",
  ...rows.sort(),
  "",
  findings.length === 0 ? "无存疑条目。" : findings.map(f => `- **${f.where}**（${f.severity}${f.status === "unconfirmed" ? "，未确认" : ""}）：${f.what}\n  证据：${f.evidence}`).join("\n"),
  "",
].join("\n"), { title: "参考文献真实性核查报告", description: conclusion, primary: true });

return {
  conclusion,
  findings,
  verified: [
    `CrossRef 机核 ${crossrefOk}/${crossrefN}（题名+首作者+年份）`,
    `arXiv 机核 ${arxivOk}/${arxivEntries.length}`,
    `PMLR 机核 ${pmlrOk}/${pmlrN}`,
    `${webOk} 条联网确认，存疑判定另经独立复核`,
  ],
  notCovered: [
    "Zotero 本地 API 从工作流沙箱不可达，未做 Zotero 交叉确认",
    "卷期页码与完整作者名单未逐一机核（由联网核查层覆盖）",
    "引用内容与原文的一致性不在范围",
  ],
} as WorkflowReport;
