/** 可复现的伪随机数（mulberry32）。 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
type R = () => number;
const pick = <T>(r: R, a: readonly T[]) => a[Math.floor(r() * a.length)];
const int = (r: R, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const ZH_SUR = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高郑梁谢宋唐许韩冯邓曹彭曾萧田董潘袁蔡蒋余于杜叶程魏苏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤".split("");
const ZH_GIVEN = "伟芳娜秀英敏静丽强磊军洋勇艳杰娟涛明超秀兰霞平刚桂英晓宁欣怡子涵浩然梓轩雨桐若曦一诺思远嘉怡佳琪俊杰宇航文博心悦晨曦语嫣小满".match(/../g)!.concat("伟芳娜敏静丽强磊军洋勇艳杰娟涛明超霞平刚宁欣怡晨悦琪航博".split(""));
const EN_FIRST = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "David", "Elizabeth", "William", "Susan", "Richard", "Jessica", "Joseph", "Sarah", "Thomas", "Karen", "Daniel", "Lisa", "Matthew", "Nancy", "Anthony", "Emily", "Mark", "Olivia", "Ethan", "Sophia", "Noah", "Ava", "Liam", "Mia", "Lucas", "Chloe", "Alex", "Grace"];
const EN_LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White", "Harris", "Clark", "Lewis", "Walker", "Young", "King", "Wright", "Scott", "Green", "Baker", "Nguyen", "Chen", "Wong", "Patel", "Kim"];
const ZH_CITY = ["北京", "上海", "广州", "深圳", "杭州", "成都", "南京", "武汉", "西安", "苏州", "重庆", "天津", "长沙", "郑州", "青岛", "厦门", "宁波", "合肥", "福州", "昆明"];
const EN_CITY = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Seattle", "Denver", "Boston", "Austin", "Portland", "Atlanta", "Miami", "San Diego", "Dallas", "Toronto", "Vancouver", "London", "Sydney"];
const ZH_ROAD = ["人民路", "解放路", "中山路", "建设路", "和平路", "文化路", "长江路", "东风路", "新华路", "滨江路", "学院路", "科技路"];
const EN_ROAD = ["Main St", "Oak Ave", "Maple Dr", "Cedar Ln", "Park Rd", "Pine St", "Elm St", "Lake View Dr", "Hill Rd", "River Rd"];
const ZH_CO_A = ["青禾", "远航", "星辰", "蓝海", "云帆", "鼎盛", "华信", "新创", "博远", "恒通", "瑞丰", "启明"];
const ZH_CO_B = ["科技", "贸易", "文化传媒", "信息技术", "电子商务", "餐饮管理", "教育咨询", "物流"];
const EN_CO = ["Acme", "Globex", "Initech", "Umbrella", "Northwind", "Contoso", "Fabrikam", "Bluebird", "Summit", "Brightline", "Evergreen", "Pioneer"];
const EN_CO_B = ["Labs", "Group", "Systems", "Studio", "Partners", "Logistics", "Foods", "Media"];
const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation".split(" ");
const ZH_TEXT = "这款产品质量很好，包装也很用心。物流速度快，客服回复及时。价格合理，下次还会再来购买。颜色和图片一致，尺寸刚刚好。推荐给朋友了，大家都说不错。".match(/[^，。]+[，。]/g)!;
const DOMAINS = ["example.com", "example.org", "example.net", "test.example"];

export const TYPES = ["sequence", "name", "first_name", "last_name", "phone", "email", "city", "address", "company", "date", "datetime", "integer", "decimal", "boolean", "choice", "uuid", "text", "pattern", "constant", "url", "ip"] as const;
export type ColType = (typeof TYPES)[number];
export interface ColDef { name: string; type: ColType; arg: string; blank: number }

const toAscii = (s: string, r: R) => (/^[\x00-\x7f]+$/.test(s) ? s.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "") : `user${int(r, 1000, 99999)}`);

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function range(arg: string, lo: number, hi: number): [number, number] {
  const m = arg.match(/^\s*(-?[\d.]+)?\s*\.\.\s*(-?[\d.]+)?\s*$/);
  return m ? [m[1] !== undefined ? Number(m[1]) : lo, m[2] !== undefined ? Number(m[2]) : hi] : [lo, hi];
}
function dateRange(arg: string): [number, number] {
  const m = arg.match(/(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})/);
  return m ? [Date.parse(m[1] + "T00:00:00Z"), Date.parse(m[2] + "T00:00:00Z")] : [Date.parse("2024-01-01T00:00:00Z"), Date.parse("2026-12-31T00:00:00Z")];
}
export function choices(arg: string): { v: string; w: number }[] {
  return arg.split(/[|｜,，]/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = x.match(/^(.*)\*(\d+(\.\d+)?)$/); return m ? { v: m[1], w: Number(m[2]) } : { v: x, w: 1 }; });
}

export interface Ctx { r: R; zh: boolean; row: number; name?: string }

export function value(c: ColDef, x: Ctx): string {
  const { r, zh } = x;
  if (c.blank > 0 && r() < c.blank) return "";
  switch (c.type) {
    case "sequence": {
      const m = c.arg.match(/^(.*?)\{(0+|#+)\}(.*)$/);
      const n = x.row + 1;
      return m ? `${m[1]}${String(n).padStart(m[2].length, "0")}${m[3]}` : `${c.arg}${n}`;
    }
    case "name": return zh ? pick(r, ZH_SUR) + pick(r, ZH_GIVEN) : `${pick(r, EN_FIRST)} ${pick(r, EN_LAST)}`;
    case "first_name": return zh ? pick(r, ZH_GIVEN) : pick(r, EN_FIRST);
    case "last_name": return zh ? pick(r, ZH_SUR) : pick(r, EN_LAST);
    case "phone": return zh ? `1${pick(r, ["3", "5", "7", "8", "9"])}${String(int(r, 0, 999999999)).padStart(9, "0")}` : `(${int(r, 201, 989)}) 555-${String(int(r, 100, 199)).padStart(4, "0")}`;
    case "email": return `${x.name ? toAscii(x.name, r) : `user${int(r, 1000, 99999)}`}${int(r, 1, 99)}@${pick(r, DOMAINS)}`;
    case "city": return zh ? pick(r, ZH_CITY) : pick(r, EN_CITY);
    case "address": return zh ? `${pick(r, ZH_CITY)}市${pick(r, ZH_ROAD)}${int(r, 1, 999)}号${int(r, 1, 30)}栋${int(r, 101, 2808)}室` : `${int(r, 1, 9999)} ${pick(r, EN_ROAD)}, ${pick(r, EN_CITY)}`;
    case "company": return zh ? `${pick(r, ZH_CITY)}${pick(r, ZH_CO_A)}${pick(r, ZH_CO_B)}有限公司` : `${pick(r, EN_CO)} ${pick(r, EN_CO_B)}`;
    case "date": { const [a, b] = dateRange(c.arg); return ymd(new Date(a + Math.floor(r() * ((b - a) / 86400000 + 1)) * 86400000)); }
    case "datetime": { const [a, b] = dateRange(c.arg); const d = new Date(a + Math.floor(r() * (b - a + 86400000))); return `${ymd(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }
    case "integer": { const [a, b] = range(c.arg, 0, 1000); return String(int(r, Math.ceil(a), Math.floor(b))); }
    case "decimal": { const [a, b] = range(c.arg, 0, 1000); const dp = (c.arg.split("..")[1]?.split(".")[1] ?? "00").length || 2; return (a + r() * (b - a)).toFixed(dp); }
    case "boolean": { const p = c.arg.trim() ? Number(c.arg) : 0.5; return r() < (isNaN(p) ? 0.5 : p) ? "true" : "false"; }
    case "choice": { const ch = choices(c.arg); if (!ch.length) return ""; const total = ch.reduce((s, o) => s + o.w, 0); let t = r() * total; for (const o of ch) { t -= o.w; if (t < 0) return o.v; } return ch[ch.length - 1].v; }
    case "uuid": { const h = () => Math.floor(r() * 16).toString(16); const s = Array.from({ length: 32 }, h); s[12] = "4"; s[16] = "89ab"[Math.floor(r() * 4)]; return `${s.slice(0, 8).join("")}-${s.slice(8, 12).join("")}-${s.slice(12, 16).join("")}-${s.slice(16, 20).join("")}-${s.slice(20).join("")}`; }
    case "text": { const [a, b] = range(c.arg, 5, 15); const n = int(r, a, b); return zh ? Array.from({ length: Math.max(1, Math.round(n / 6)) }, () => pick(r, ZH_TEXT)).join("") : Array.from({ length: n }, () => pick(r, LOREM)).join(" ").replace(/^./, (s) => s.toUpperCase()) + "."; }
    case "pattern": return c.arg.replace(/#/g, () => String(int(r, 0, 9))).replace(/\?/g, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[int(r, 0, 23)]).replace(/\*/g, () => "abcdefghijkmnpqrstuvwxyz23456789"[int(r, 0, 31)]);
    case "constant": return c.arg;
    case "url": return `https://${pick(r, DOMAINS)}/${pick(r, LOREM)}/${int(r, 1, 9999)}`;
    case "ip": return `${int(r, 10, 223)}.${int(r, 0, 255)}.${int(r, 0, 255)}.${int(r, 1, 254)}`;
  }
  return "";
}

export function generate(cols: ColDef[], count: number, seed: number, zh: boolean, uniqueCols: Set<string>): { rows: string[][]; dupes: string[] } {
  const r = rng(seed);
  const seen = cols.map(() => new Set<string>());
  const dupes = new Set<string>();
  const rows: string[][] = [];
  for (let i = 0; i < count; i++) {
    let name: string | undefined;
    const row = cols.map((c, ci) => {
      let v = "";
      for (let k = 0; k < 20; k++) {
        v = value(c, { r, zh, row: i, name });
        if (!uniqueCols.has(c.name) || !v || !seen[ci].has(v)) break;
        if (k === 19) dupes.add(c.name);
      }
      seen[ci].add(v);
      if (c.type === "name" && !name) name = zh ? undefined : v;
      return v;
    });
    rows.push(row);
  }
  return { rows, dupes: [...dupes] };
}
