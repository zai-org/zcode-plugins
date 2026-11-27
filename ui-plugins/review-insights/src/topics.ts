export const DEFAULT_TOPICS = `质量: 质量, 品质, 做工, 用料, 结实, 耐用, 掉色, 起球, 开线, quality, durable, broke, cheap
尺码: 尺码, 码数, 偏大, 偏小, 大了, 小了, 合身, 显瘦, 紧, 松, size, fit, tight, loose, small, large
物流: 物流, 快递, 发货, 送货, 到货, 几天, 慢, shipping, delivery, arrived, late
包装: 包装, 盒子, 破损, 压坏, 漏, packaging, box, damaged
价格: 价格, 便宜, 贵, 性价比, 划算, 值, 优惠, price, cheap, expensive, value, worth
外观: 颜色, 色差, 好看, 漂亮, 款式, 样子, 图片, 实物, 颜值, color, colour, looks, pretty, design
气味: 味道, 气味, 异味, 很臭, 香, smell, odor
使用体验: 好用, 舒服, 舒适, 方便, 效果, 手感, 柔软, 软, 硬, 操作, comfortable, soft, easy, works
客服: 客服, 售后, 退货, 换货, 态度, 回复, 商家, service, support, refund, return`;

export interface Topic { name: string; words: string[] }
export function parseTopics(text: string): Topic[] {
  return text.split(/\r?\n/).map((l) => /^\s*([^:：]+)[:：](.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ name: m[1].trim(), words: m[2].split(/[,，、|]/).map((w) => w.trim().toLowerCase()).filter(Boolean) })).filter((t) => t.words.length);
}

const POS = ["好", "不错", "满意", "用心", "很正", "喜欢", "推荐", "很快", "舒服", "漂亮", "好看", "值", "划算", "柔软", "结实", "合身", "超赞", "完美", "赞", "great", "good", "love", "perfect", "nice", "recommend", "excellent", "comfortable", "fast"];
const NEG = ["差", "不好", "失望", "垃圾", "退货", "慢", "破", "坏", "掉色", "起球", "色差", "异味", "臭", "偏大", "偏小", "紧", "贵", "不值", "开线", "漏", "压坏", "敷衍", "后悔", "不回", "粗糙", "一般", "bad", "poor", "broke", "late", "terrible", "disappointed", "smell", "return", "small", "tight", "worst"];
const NEGATORS = /(不|没|没有|别|not|no|never|isn't|wasn't|don't)\s*$/i;

/** 一句话的情绪：+1 / -1 / 0。处理“不好”“不太满意”“没有色差”这类否定。 */
export function clauseTone(c: string) {
  const t = c.toLowerCase();
  const used = new Array(t.length).fill(false);
  const words = [...POS.map((w) => [w, 1] as const), ...NEG.map((w) => [w, -1] as const)].sort((x, y) => y[0].length - x[0].length);
  let score = 0;
  for (const [w, sign] of words) {
    let i = t.indexOf(w);
    while (i >= 0) {
      if (!used.slice(i, i + w.length).some(Boolean)) {
        for (let k = i; k < i + w.length; k++) used[k] = true;
        const before = t.slice(Math.max(0, i - 5), i).replace(/太|很|是|怎么|那么|算|有点/g, "");
        score += NEGATORS.test(before) ? -sign : sign;
      }
      i = t.indexOf(w, i + w.length);
    }
  }
  return Math.sign(score);
}

export const clauses = (text: string) => text.split(/[。！？!?；;，,\n~～]+|(?<=[a-z])\.\s/i).map((c) => c.trim()).filter((c) => c.length > 1);

export function tagReview(text: string, topics: Topic[]) {
  const found = new Map<string, { tone: number; snippet: string }>();
  for (const c of clauses(text)) {
    const lc = c.toLowerCase();
    for (const tp of topics) {
      if (!tp.words.some((w) => (/^[a-z]+$/.test(w) ? new RegExp(`\\b${w}`, "i").test(lc) : lc.includes(w)))) continue;
      const tone = clauseTone(c), prev = found.get(tp.name);
      if (!prev || Math.abs(tone) > Math.abs(prev.tone)) found.set(tp.name, { tone, snippet: c });
    }
  }
  return found;
}
