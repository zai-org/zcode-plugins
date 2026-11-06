/* zcode-workflow
description: 专家团共识工作流：N 位不同视角的专家独立作答 → 真匿名交叉互评（只见 专家A/B/C 标签，
  不见视角名）→ 仲裁人归纳一致项/分歧项（共识率由脚本确定性计算，低于阈值自动加辩）→ 主席执行摘要 →
  可验证事实复核。单专家失败自动容错并标注样本完整度；profile（quick/standard/deep）控制轮数与专家构成。
  可移植版：所有角色用会话默认模型，零配置可跑；要统一换模型在调用层用 CreateWorkflow 的 subagent_model。
  输出按「一致(稳定)/分歧(明示)」分离，防硬合成与偏见共识。
whenToUse: 用户要"更稳"的结论/重要决策/方案评审/多视角评估时；说"用专家团评估 X / 让专家团给结论"。
  急活用 profile=quick（数分钟），重要产出用 standard，最高把关用 deep。共识率不足自动加辩，
  仍不足则明示分歧交人工裁决。
args:
  basis:
    type: json
    description: 评测依据，文件路径或条目数组；给了就要求专家与复核员逐条对照依据判定并引用所在条目（空数组=明确不用，默认不注入）
  evidence:
    type: json
    description: 证据包，文本或文件路径数组（路径由专家/复核员用工具自行读取），默认空
  experts:
    type: json
    description: 专家视角名数组（勿重复），默认 [务实工程师, 风险与边界审查, 产品价值]
  ledger_path:
    type: string
    description: 运行台账 JSONL 落盘路径（每轮一行），默认 ~/.expert-panel/ledger.jsonl
  max_rounds:
    type: number
    description: 最大轮数（含首轮），不填由 profile 决定（quick=1，其余=2）
  profile:
    type: string
    description: quick（3专家/1轮）| standard（默认，2轮）| deep（自动补足反方质询与综合连接两类原型/2轮）
    default: standard
  question:
    type: string
    description: 要专家团给出稳定结论的问题/决策
    required: true
  question_id:
    type: string
    description: 题目标识（基准跑批/回溯归因用），默认空
  simulate_failures:
    type: json
    description: 测试用，要模拟作答失败的专家下标数组，默认空
  threshold:
    type: number
    description: 共识率阈值，低于则再辩一轮，仍低则明示分歧交人工裁决
    default: 0.6
*/
interface ExpertAnswer {
  /** 对问题的立场或方案（一句话）。 */
  position: string;
  /** 支撑要点，每条尽量独立可核。 */
  keyPoints: string[];
  /** 自评置信度 0-1。 */
  confidence: number;
}

interface Objection {
  /** 针对哪位匿名专家，填其标签（如 专家B）。 */
  target: string;
  /** 反对或补充意见。 */
  comment: string;
}

interface Critique {
  /** 对其他专家立场的反对与补充。 */
  objections: Objection[];
  /** 其他专家按说服力从高到低的标签排序（如 ["专家C","专家A"]）。 */
  ranking: string[];
}

interface Revision {
  /** 修订后的立场（可维持原判）。 */
  position: string;
  /** 修订后要点。 */
  keyPoints: string[];
  /** 是否改变了立场。 */
  changed: boolean;
}

interface Dispute {
  /** 分歧主题。 */
  topic: string;
  /** 各方论据摘要（用专家标签指代）。 */
  sides: string;
}

interface Consensus {
  /** 各专家均认可的结论——稳定输出。 */
  agreed: string[];
  /** 仍存分歧的结论。 */
  disputed: Dispute[];
  /** 仲裁人的最终建议。 */
  recommendation: string;
}

interface Verification {
  /** 复核后保留的一致项。 */
  agreed: string[];
  /** 复核未通过的项及原因。 */
  rejected: { item: string; reason: string }[];
  /** 价值判断类或无法客观复核的项，原样保留。 */
  unverifiable: string[];
}

interface ChairSummary {
  /** 3-5 句执行摘要：共识是什么、分歧在哪、怎么收敛的。 */
  executiveSummary: string;
  /** 面向用户的明确最终建议，含适用条件。 */
  finalRecommendation: string;
}

/** 共识率由脚本确定性计算，不信仲裁人自报的数字。 */
function computeRate(c: Consensus): number {
  const a = c.agreed.length;
  const d = c.disputed.length;
  return a + d === 0 ? 0 : a / (a + d);
}

/** 专家下标 → 匿名标签（专家A/B/C…）。 */
function labelOf(i: number): string {
  return `专家${String.fromCharCode(65 + i)}`;
}

// ---------- 参数解析 ----------
const question = String(args.question);
const profileRaw = String(args.profile ?? "standard");
const profile: "quick" | "standard" | "deep" = profileRaw === "quick" ? "quick" : profileRaw === "deep" ? "deep" : "standard";
const defaultLenses = ["务实工程师", "风险与边界审查", "产品价值"];
let lenses: string[] = Array.isArray(args.experts) && (args.experts as unknown[]).length > 0
  ? (args.experts as unknown[]).map(String)
  : defaultLenses;
if (profile === "quick") lenses = lenses.slice(0, 3);
if (profile === "deep") {
  // 护栏：deep 档必须含反共识原型（对冲「辩论放大偏差共识」），人数不足再补综合型
  if (!lenses.some((l) => /反方|反对|质询|质疑|Contrarian|魔鬼/i.test(l))) lenses = [...lenses, "反方质询（Contrarian）"];
  if (lenses.length < 4) lenses = [...lenses, "综合连接（Synthesizer）"];
}
const threshold = typeof args.threshold === "number" && args.threshold > 0 && args.threshold <= 1 ? args.threshold : 0.6;
const maxRounds = typeof args.max_rounds === "number" && args.max_rounds >= 1
  ? Math.floor(args.max_rounds)
  : profile === "quick" ? 1 : 2;
const simulateFailures: number[] = Array.isArray(args.simulate_failures)
  ? (args.simulate_failures as unknown[]).map(Number).filter((n) => Number.isInteger(n))
  : [];
const evidence: string[] = Array.isArray(args.evidence)
  ? (args.evidence as unknown[]).map(String).filter((s) => s.trim().length > 0)
  : [];
const evidenceBlock = evidence.length > 0
  ? `\n证据包（${evidence.length} 项；文件路径请用你的工具读取后再引用，结论须标注证据出处）：\n${evidence.map((e, i) => `[${i + 1}] ${e}`).join("\n")}`
  : "";
const basisGiven = Array.isArray(args.basis);
const basis: string[] = basisGiven
  ? (args.basis as unknown[]).map(String).filter((s) => s.trim().length > 0)
  : [];
const basisBlock = basis.length > 0
  ? `\n评测依据（调用方指定；评审前用工具读取与问题相关的原文，结论须对照依据逐条判定并引用所在条目，不凭印象打分；与问题无关的条目可略过并说明）：\n${basis.map((b, i) => `[${i + 1}] ${b}`).join("\n")}`
  : "";
const ledgerPath = typeof args.ledger_path === "string" && args.ledger_path.trim().length > 0
  ? args.ledger_path.trim()
  : "~/.expert-panel/ledger.jsonl";

// ---------- 仪表盘 ----------
artifact.board("panel", {
  title: "专家团状态",
  key: "name",
  status: "stage",
  columns: ["独立作答", "交叉互评", "修订表态", "已收敛", "缺席"],
  cardTitle: "name",
  detail: [{ field: "position", label: "立场" }],
});
artifact.chart("consensus", {
  title: "共识率收敛曲线",
  x: { field: "round", label: "轮次" },
  y: { field: "rate", label: "共识率" },
  baseline: { field: "target", label: "阈值" },
});
artifact.metrics("stats", {
  title: "专家团指标",
  metrics: [
    { field: "ratePct", label: "共识率" },
    { field: "round", label: "轮次" },
    { field: "alive", label: "有效专家" },
    { field: "profileLabel", label: "档位" },
  ],
});

const experts = lenses.map((lens) =>
  agent(`专家·${lens}`, {
    system:
      `你是「${lens}」视角的资深专家。先独立给出立场、3-6 条支撑要点和置信度；` +
      "只凭自己的专业判断，不要猜测别人会怎么说，也不要为了和谐改变有依据的立场；确实被说服才改。用中文回答。",
  }),
);

phase("独立作答：每位专家独立给出立场与论据");
// 仲裁需要全部有效专家的独立立场，此处必须等齐；单个专家失败不拖垮整体（allSettled）
const settled = await Promise.allSettled(
  lenses.map((lens, i) =>
    simulateFailures.includes(i)
      ? Promise.reject(new Error("模拟作答失败（测试注入）"))
      : experts[i].ask<ExpertAnswer>(`问题：${question}\n视角：${lens}${evidenceBlock}${basisBlock}`),
  ),
);
const active: number[] = [];
const answers: ExpertAnswer[] = [];
settled.forEach((s, i) => {
  if (s.status === "fulfilled") {
    active.push(i);
    answers.push(s.value);
    report({ name: lenses[i], stage: "独立作答", position: s.value.position }, "panel");
  } else {
    report({ name: lenses[i], stage: "缺席", position: `作答失败：${String(s.reason).slice(0, 80)}` }, "panel");
  }
});
if (active.length === 0) throw new Error("所有专家均未完成作答，无法仲裁");
const absent = lenses.filter((_, i) => !active.includes(i));
log(`${active.length}/${lenses.length} 位专家完成独立作答${absent.length > 0 ? `（缺席：${absent.join("、")}）` : ""}`);

/** 第 m 位有效专家能看到的他人立场：只有匿名标签、立场、要点——不含视角名与模型。 */
function othersFor(m: number) {
  return active
    .map((idx, n) => ({ idx, n }))
    .filter((o) => o.n !== m)
    .map((o) => ({ 专家: labelOf(o.idx), position: answers[o.n].position, keyPoints: answers[o.n].keyPoints }));
}

phase("交叉互评：匿名互看立场，提出反对与补充");
const critiqueSettled = await Promise.allSettled(
  active.map((idx, m) =>
    agent(`互评·${lenses[idx]}`, {
      system:
        `你是「${lenses[idx]}」视角的独立评审。只针对其他专家的匿名立场提出反对与补充，` +
        "不重复自己的论点，就事论事。用中文回答。",
    }).ask<Critique>(
      `问题：${question}\n你此前的立场：${answers[m].position}\n` +
        `其他专家的匿名立场：${JSON.stringify(othersFor(m))}\n` +
        "请只针对他们的立场提出反对与补充（target 填对方标签），并给出 ranking（对方标签数组，说服力从高到低）。",
    ),
  ),
);
const critiques: Critique[] = critiqueSettled.map((s) => (s.status === "fulfilled" ? s.value : { objections: [], ranking: [] }));
active.forEach((idx, m) => report({ name: lenses[idx], stage: "交叉互评", position: answers[m].position }, "panel"));

phase("仲裁归纳：区分一致项与分歧项");
const arbitrator = agent("仲裁人", {
  system:
    "你是仲裁人：把各位专家的表态归纳为『一致项』（所有人都认可，视为稳定结论）与『分歧项』（列明各方论据，不强行折中），" +
    "并给出最终建议。宁可如实呈现分歧，不要制造虚假共识。用中文回答。",
});
const positionsOf = () =>
  active.map((idx, m) => ({
    专家: labelOf(idx),
    position: answers[m].position,
    keyPoints: answers[m].keyPoints,
    confidence: answers[m].confidence,
  }));
let consensus = await arbitrator.ask<Consensus>(
  `问题：${question}\n专家表态（匿名）：${JSON.stringify(positionsOf())}\n相互意见：${JSON.stringify(critiques)}\n请归纳共识与分歧。`,
);
let rate = computeRate(consensus);
// 逐轮共识率序列（schema v2：台账记录收敛轨迹）
const roundsSeq: number[] = [Math.round(rate * 1000) / 1000];
let round = 1;
report({ round, rate, target: threshold }, "consensus");
report({ ratePct: Math.round(rate * 100) + "%", round, alive: `${active.length}/${lenses.length}`, profileLabel: `${profile}` }, "stats");
log(`第 1 轮共识率 ${Math.round(rate * 100)}%（一致 ${consensus.agreed.length} / 分歧 ${consensus.disputed.length}）`);

phase("修订表态与再仲裁：共识率不足自动加辩");
while (rate < threshold && round < maxRounds) {
  round += 1;
  const revised = await Promise.allSettled(
    active.map((idx, m) =>
      experts[idx].ask<Revision>(
        `仲裁归纳出的分歧项：${JSON.stringify(consensus.disputed)}\n你此前的立场：${answers[m].position}\n` +
          "请针对分歧重新表态（可坚持，被说服则修改并说明）。",
      ),
    ),
  );
  const revisedPositions = active.map((idx, m) => {
    const r = revised[m];
    if (r.status === "fulfilled") {
      answers[m] = { position: r.value.position, keyPoints: r.value.keyPoints, confidence: answers[m].confidence };
      report({ name: lenses[idx], stage: "修订表态", position: r.value.position }, "panel");
      return { 专家: labelOf(idx), position: r.value.position, keyPoints: r.value.keyPoints, changed: r.value.changed };
    }
    return { 专家: labelOf(idx), position: answers[m].position, keyPoints: answers[m].keyPoints, changed: false };
  });
  consensus = await arbitrator.ask<Consensus>(
    `第 ${round} 轮专家表态（匿名）：${JSON.stringify(revisedPositions)}\n上一轮归纳：${JSON.stringify(consensus)}\n请重新归纳一致项与分歧项。`,
  );
  rate = computeRate(consensus);
  roundsSeq.push(Math.round(rate * 1000) / 1000);
  report({ round, rate, target: threshold }, "consensus");
  report({ ratePct: Math.round(rate * 100) + "%", round, alive: `${active.length}/${lenses.length}`, profileLabel: `${profile}` }, "stats");
  log(`第 ${round} 轮收敛后共识率 ${Math.round(rate * 100)}%`);
}
active.forEach((idx, m) => report({ name: lenses[idx], stage: "已收敛", position: answers[m].position }, "panel"));

phase("主席综合：产出执行摘要与最终建议");
const chair = agent("主席", {
  system:
    "你是专家团主席。综合专家立场、互评排序与仲裁归纳，为用户写终稿：执行摘要 + 明确的最终建议；" +
    "分歧未解决时如实呈现分歧而非硬折中；有效专家不足 2 位时须明示结论未经多方独立验证。用中文回答。",
});
const rankings = critiques.map((c, m) => ({ 评审: labelOf(active[m]), ranking: c.ranking }));
const chairOut = await chair.ask<ChairSummary>(
  `问题：${question}\n有效专家 ${active.length}/${lenses.length}\n` +
    `专家最终立场（匿名）：${JSON.stringify(positionsOf())}\n互评排序：${JSON.stringify(rankings)}\n` +
    `最终仲裁归纳：${JSON.stringify(consensus)}\n请给出执行摘要与最终建议。`,
);

phase("事实复核与落账：复核可验证一致项，记录本次运行");
const verification = await agent("事实复核员", {
  system:
    "你是事实复核员：只复核可客观验证的事实型断言（读代码/查文件/跑命令能判定的就去做；" +
    "给了证据包则逐条对证并标注出处）；价值判断类结论归入 unverifiable 原样保留。不改任何文件。用中文回答。",
}).ask<Verification>(`问题语境：${question}\n待复核一致项：${JSON.stringify(consensus.agreed)}${evidenceBlock}${basisBlock}`);

const stable = rate >= threshold;
// schema v2（2026-10-23 P0 修复）：双口径共识率——rate_pre=仲裁时点（复核前）、rate_post=复核后重算，
// 消除旧版三时点混用（rate 不可复算）问题。tokens 由回填脚本补齐；adopted 为采纳标记预留。
const ratePre = Math.round(rate * 1000) / 1000;
const ratePostDenom = verification.agreed.length + consensus.disputed.length;
const ratePost = ratePostDenom === 0 ? 0 : Math.round((verification.agreed.length / ratePostDenom) * 1000) / 1000;
const ledgerEntry = {
  schema: 2,
  version: "0.1.2",
  question: question.slice(0, 120),
  question_id: String(args.question_id ?? ""),
  profile,
  model: "session-default",
  experts: lenses.length,
  alive: active.length,
  rounds: round,
  rounds_seq: roundsSeq,
  threshold,
  rate_pre: ratePre,
  rate_post: ratePost,
  rate: ratePre,
  agreed: verification.agreed.length,
  disputed: consensus.disputed.length,
  rejected: verification.rejected.length,
  unverifiable: verification.unverifiable.length,
  stable,
  tokens: null,
  adopted: null,
};
const LEDGER_CODE = [
  "import sys, json, os, datetime",
  "p = os.path.expanduser(sys.argv[2])",
  "d = os.path.dirname(p)",
  "if d: os.makedirs(d, exist_ok=True)",
  "e = json.loads(sys.argv[1]); e['ts'] = datetime.datetime.now().isoformat(timespec='seconds')",
  "open(p, 'a', encoding='utf-8').write(json.dumps(e, ensure_ascii=False) + '\\n')",
  "print(p)",
].join("\n");
const ledger = await world.run("python3", ["-c", LEDGER_CODE, JSON.stringify(ledgerEntry), ledgerPath]);
log(ledger.exitCode === 0 ? `台账已追加：${ledger.stdout.trim()}` : `台账写入失败（不阻断结论）：${ledger.stderr.slice(0, 120)}`);
const sampleNote = absent.length > 0
  ? `样本完整度 ${active.length}/${lenses.length}（缺席：${absent.join("、")}），结论未经全体专家独立验证`
  : active.length < 2
    ? "仅 1 位有效专家，共识率反映的是无异议而非多方独立验证"
    : "";

await artifact.markdown(
  "summary",
  [
    `# 专家团结论·${question.slice(0, 40)}`,
    "",
    `- 共识率：${Math.round(rate * 100)}%（阈值 ${Math.round(threshold * 100)}%，${round} 轮收敛，${stable ? "达成共识" : "未达阈值"}）`,
    `- 档位 ${profile} · 有效专家 ${active.length}/${lenses.length}：${active.map((i) => lenses[i]).join("、")}`,
    `- 一致项（稳定结论）：${consensus.agreed.length} 条；分歧项：${consensus.disputed.length} 条；复核剔除：${verification.rejected.length} 条`,
    ...(sampleNote ? [`- ⚠️ ${sampleNote}`] : []),
    "",
    "## 一致项（经复核）",
    ...verification.agreed.map((s) => `- ✅ ${s}`),
    ...verification.unverifiable.map((s) => `- ❓ ${s}（价值判断/无法客观复核）`),
    "",
    "## 仍存分歧（明示，不强行折中）",
    ...consensus.disputed.map((d) => `- ⚠️ ${d.topic}：${d.sides}`),
    ...(verification.rejected.length > 0
      ? ["", "## 复核未通过", ...verification.rejected.map((r) => `- ❌ ${r.item}（${r.reason}）`)]
      : []),
    "",
    "## 执行摘要（主席）",
    chairOut.executiveSummary,
    "",
    "## 最终建议（主席）",
    chairOut.finalRecommendation,
    "",
    "## 仲裁建议（附录）",
    consensus.recommendation,
  ].join("\n"),
  {
    title: `专家团结论·${question.slice(0, 24)}`,
    primary: true,
    description: `共识率 ${Math.round(rate * 100)}%，一致 ${consensus.agreed.length} 条 / 分歧 ${consensus.disputed.length} 条，有效专家 ${active.length}/${lenses.length}。`,
  },
);

return {
  conclusion: stable
    ? `专家团达成共识（共识率 ${Math.round(rate * 100)}%，${round} 轮）：${verification.agreed.length} 条稳定结论 + ${consensus.disputed.length} 条明示分歧；仲裁建议已给出。${sampleNote ? "⚠️ " + sampleNote : ""}`
    : `共识率 ${Math.round(rate * 100)}% 低于阈值，未强行合成：${consensus.disputed.length} 条分歧已列明各方论据，建议人工裁决。${sampleNote ? "⚠️ " + sampleNote : ""}`,
  agreed: verification.agreed,
  unverifiable: verification.unverifiable,
  disputed: consensus.disputed,
  rejected: verification.rejected,
  executiveSummary: chairOut.executiveSummary,
  recommendation: chairOut.finalRecommendation || consensus.recommendation,
  arbiterNote: consensus.recommendation,
  agreementRate: rate,
  rounds: round,
  profile,
  participants: active.map((i) => lenses[i]),
  absent,
  verified: [
    "每位专家独立作答后才进入互评（无从众）",
    "互评输入只含匿名标签/立场/要点，不含视角名（防权威偏置）",
    "共识率由脚本按一致项/(一致项+分歧项) 确定性计算，非模型自报",
    "可验证事实经事实复核员把关",
    ...(basis.length > 0 ? ["评测依据已按 basis 参数注入，结论要求逐条对照依据"] : []),
    ledger.exitCode === 0 ? `运行台账已追加 ${ledger.stdout.trim()}` : "台账写入失败，本次运行未入账",
  ],
  notCovered: [
    stable ? "" : "共识不足，结论未定",
    "价值判断类结论无法客观复核，仅代表专家团意见",
    absent.length > 0 ? `缺席专家视角未覆盖：${absent.join("、")}` : "",
  ].filter(Boolean),
};
