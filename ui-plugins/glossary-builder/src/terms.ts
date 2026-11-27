const EN_STOP = new Set("a an the and or but if of to in on at by for with from as is are was were be been it its this that these those you we they he she i our your their can will would should may must not no do does did have has had than then so such into over under about after before up out all any each more most other some only also via per using use used new one two".split(" "));
const ZH_STOP = new Set("的 了 和 是 在 我 有 也 就 不 都 一 上 中 对 到 说 要 去 你 会 着 看 这 那 他 她 它 们 我们 你们 与 及 或 等 将 被 把 从 而 并 但 为 以 之 其 于 由 让 向 给 很 还 又 再 更 最 已 可以 能 可 这个 那个 什么 自己 进行 通过 如果 因为 所以 时 后 前 里 下 个 每 所有 支持 使用 需要 可能 点击 选择 打开 用户 一个 没有 已经 如何 就是 直接 改为 提示 分为 称为 叫做 也叫 即 简称 包括 例如 比如".split(" "));

export interface Cand { term: string; freq: number; docs: Set<string>; context: string; pair?: string }

const FUNC = new Set([..."的了和与及或是为把被将从对向给也就都而但并在会由可"]);
const EDGE = new Set([..."的了和与及或在是为把被将从对向给也就都而但并其之以于由让很还又再更最已可能会要个每些满减按时着过得说看用能各该此等"]);
const isMulti = (t: string, seg: Intl.Segmenter) => [...seg.segment(t)].length > 1;
const sentences = (t: string) => t.split(/(?<=[。！？!?；;])|\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
const isZh = (w: string) => /[\u4e00-\u9fff]/.test(w);

/** “中文（English）”“English (中文)”这类写法直接给出译文。 */
export function findPairs(text: string) {
  const seg = new Intl.Segmenter("zh", { granularity: "word" });
  const tail = (zh: string) => {
    const ws = [...seg.segment(zh)].map((x) => x.segment);
    let out = "";
    for (let i = ws.length - 1; i >= 0; i--) {
      const w = ws[i];
      if ((w.length === 1 ? FUNC.has(w) : ZH_STOP.has(w)) || !/[\u4e00-\u9fff]/.test(w) || [...out].length + w.length > 8) break;
      out = w + out;
    }
    return out;
  };
  const out: { zh: string; en: string }[] = [];
  for (const m of text.matchAll(/([\u4e00-\u9fff]{2,14})\s*[（(]\s*([A-Za-z][A-Za-z0-9 .'&/-]{1,40}?)\s*[)）]/g)) { const zh = tail(m[1]); if ([...zh].length >= 2) out.push({ zh, en: m[2].trim() }); }
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*){0,4})\s*[（(]\s*([\u4e00-\u9fff]{2,10})\s*[)）]/g)) { const ws = m[1].trim().split(/\s+/); let k = ws.length; while (k > 0 && ws.length - k < 5 && /^[A-Z0-9]/.test(ws[k - 1])) k--; const en = ws.slice(k).join(" "); if (en) out.push({ zh: m[2], en }); }
  return out;
}

export function extract(docs: { name: string; text: string }[], o: { minFreq: number; max: number; stop: Set<string> }) {
  const seg = new Intl.Segmenter("zh", { granularity: "word" });
  const map = new Map<string, Cand>();
  const add = (term: string, doc: string, ctx: string) => {
    const k = /^[A-Za-z]/.test(term) && !/^[A-Z0-9]{2,}$/.test(term) ? term.toLowerCase() : term;
    const c = map.get(k) ?? { term, freq: 0, docs: new Set<string>(), context: ctx };
    c.freq++; c.docs.add(doc);
    if (ctx.length < c.context.length && ctx.length > term.length + 6) c.context = ctx;
    map.set(k, c);
  };
  const pairs = new Map<string, string>();
  for (const d of docs) {
    for (const p of findPairs(d.text)) { pairs.set(p.zh, p.en); pairs.set(p.en.toLowerCase(), p.zh); }
    const clean = d.text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/^#+\s*/gm, "");
    for (const s of sentences(clean)) {
      const ctx = s.length > 90 ? s.slice(0, 90) + "…" : s;
      const toks = [...seg.segment(s)].map((x) => ({ w: x.segment, word: x.isWordLike }));
      // 按标点/空白切成片段，在片段内取 1-4 个词的组合
      let run: string[] = [];
      const flush = () => {
        for (let n = 1; n <= 4; n++) for (let i = 0; i + n <= run.length; i++) {
          const g = run.slice(i, i + n);
          const first = g[0].toLowerCase(), last = g[g.length - 1].toLowerCase();
          if (o.stop.has(first) || o.stop.has(last) || EN_STOP.has(first) || EN_STOP.has(last) || ZH_STOP.has(first) || ZH_STOP.has(last)) continue;
          if (g.some((w) => /^\d+$/.test(w))) continue;
          const zh = g.some(isZh), mixed = zh && g.some((w) => /^[A-Za-z]/.test(w));
          if (mixed && n > 2) continue;
          if (zh && n > 1 && (EDGE.has(g[0]) || EDGE.has(g[g.length - 1]))) continue;
          const term = zh ? g.join("") : g.join(" ");
          const len = [...term].length;
          if (zh ? len < 2 || len > 10 || (n === 1 && len < 2) : (n === 1 && !/^[A-Z]/.test(g[0]) && len < 5) || len < 2) continue;
          if (zh && n === 1 && len === 2 && !pairs.has(term) && ZH_STOP.has(term)) continue;
          add(term, d.name, ctx);
        }
        run = [];
      };
      for (const t of toks) {
        if (t.word) run.push(t.w);
        else if (/^\s+$/.test(t.w) && run.length && /^[A-Za-z0-9]/.test(run[run.length - 1])) continue;
        else flush();
      }
      flush();
    }
  }
  let list = [...map.values()].filter((c) => c.freq >= o.minFreq || pairs.has(c.term) || pairs.has(c.term.toLowerCase()));
  list = list.filter((c) => !(isZh(c.term) && !c.term.includes(" ") && [...c.term].length === 2 && !pairs.has(c.term) && !isMulti(c.term, seg) && (c.freq < o.minFreq * 2 || c.docs.size < 2)));
  // 嵌套去重：短词几乎总出现在同一个长词里时只留长词；单个普通中文词（2 字）频次不够高时去掉
  list = list.filter((c) => !list.some((d) => d !== c && d.term.length > c.term.length && (isZh(c.term) ? d.term.includes(c.term) : (` ${d.term.toLowerCase()} `).includes(` ${c.term.toLowerCase()} `)) && d.freq >= c.freq * 0.8));
  for (const c of list) c.pair = pairs.get(c.term) ?? pairs.get(c.term.toLowerCase());
  const score = (c: Cand) => c.freq * (1 + 0.6 * Math.min(3, (isZh(c.term) ? [...c.term].length / 2 : c.term.split(" ").length) - 1)) * (c.pair ? 2 : 1) * (1 + 0.3 * (c.docs.size - 1));
  return list.sort((a, b) => score(b) - score(a) || a.term.localeCompare(b.term)).slice(0, o.max);
}
