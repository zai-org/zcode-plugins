/** 教案 Markdown 解析与检查。 */
export interface Step { phase: string; minutes: number; teacher: string; students: string; intent: string; materials: string }
export interface Lesson {
  title: string; info: Record<string, string>; minutes: number;
  sections: Record<string, string[]>; steps: Step[]; order: string[];
}

export const SECTIONS: [string, RegExp][] = [
  ["objectives", /教学目标|学习目标|目标|objectives?|learning goals?/i],
  ["keypoints", /重点|难点|重难点|key points?/i],
  ["materials", /教学准备|课前准备|教具|学具|材料|资源|materials?|resources?/i],
  ["process", /教学过程|教学流程|教学环节|过程|procedure|lesson flow|activities/i],
  ["board", /板书|board/i],
  ["homework", /作业|课后|homework|assignment/i],
  ["reflection", /反思|教学后记|reflection/i],
];
export const SECTION_ZH: Record<string, string> = { objectives: "教学目标", keypoints: "教学重难点", materials: "教学准备", process: "教学过程", board: "板书设计", homework: "作业布置", reflection: "教学反思" };
const INFO: [string, RegExp][] = [
  ["subject", /^(学科|科目|subject)$/i], ["grade", /^(年级|班级|grade|class)$/i], ["textbook", /^(教材|版本|textbook)$/i],
  ["duration", /^(课时|时长|时间|duration)$/i], ["teacher", /^(授课人|执教|教师|老师|teacher)$/i], ["date", /^(日期|授课时间|date)$/i], ["type", /^(课型|type)$/i],
];

const strip = (t: string) => t.replace(/^\s*(?:[-*+]|\d+[.、)]|[一二三四五六七八九十]+[、.])\s*/, "").replace(/\*\*/g, "").trim();
export function minutesOf(t: string): number {
  const m = /(\d+(?:\.\d+)?)\s*(?:分钟|min(?:ute)?s?|′|')/i.exec(t);
  return m ? +m[1] : NaN;
}
const ROLE: [keyof Step, RegExp][] = [["teacher", /^(教师|老师|师|教师活动|teacher)\s*[:：]/i], ["students", /^(学生|生|学生活动|students?)\s*[:：]/i], ["intent", /^(设计意图|意图|目的|purpose|why)\s*[:：]/i], ["materials", /^(材料|教具|资源|用到|materials?)\s*[:：]/i]];

export function parseLesson(md: string, fallbackTitle = ""): Lesson {
  const lines = md.replace(/\r/g, "").split("\n");
  const L: Lesson = { title: "", info: {}, minutes: NaN, sections: {}, steps: [], order: [] };
  let sec = "", cur: Step | undefined, tableHead: string[] | undefined;
  const newStep = (phase: string) => { cur = { phase, minutes: minutesOf(phase), teacher: "", students: "", intent: "", materials: "" }; cur.phase = phase.replace(/[（(]\s*\d+(?:\.\d+)?\s*(?:分钟|min\w*|′|')\s*[)）]|\s*\d+(?:\.\d+)?\s*(?:分钟|min\w*)\s*/gi, "").replace(/[:：]\s*$/, "").trim(); L.steps.push(cur); };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { tableHead = undefined; continue; }
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      const text = strip(h[2]);
      if (h[1].length === 1 && !L.title) { L.title = text.replace(/^(课题|title)\s*[:：]\s*/i, ""); continue; }
      const k = SECTIONS.find(([, re]) => re.test(text) && text.length <= 16)?.[0];
      if (k && (h[1].length <= 2 || sec !== "process")) { sec = k; cur = undefined; if (!L.order.includes(k)) L.order.push(k); L.sections[k] ??= []; continue; }
      if (sec === "process") { newStep(text); continue; }
      continue;
    }
    const kv = /^(?:[-*]\s*)?\**([^:：*]{1,8})\**\s*[:：]\s*(.+)$/.exec(line);
    if (!sec && kv) {
      const key = kv[1].trim(), val = kv[2].trim();
      if (/^(课题|title)$/i.test(key)) { L.title = val; continue; }
      const k = INFO.find(([, re]) => re.test(key))?.[0];
      if (k) { L.info[k] = val; if (k === "duration") L.minutes = minutesOf(val) || (/\d+/.test(val) && /课时/.test(val) ? NaN : +((/\d+/.exec(val) ?? [""])[0]) || NaN); continue; }
    }
    if (sec === "process") {
      if (/^\|/.test(line)) {
        const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
        if (!tableHead) { tableHead = cells; continue; }
        const get = (re: RegExp) => { const i = tableHead!.findIndex((c) => re.test(c)); return i >= 0 ? (cells[i] ?? "").replace(/<br\s*\/?>/gi, "\n") : ""; };
        const phase = get(/环节|步骤|阶段|phase|step/i), min = get(/时间|时长|分钟|time|min/i);
        L.steps.push({ phase, minutes: minutesOf(min) || (/^\d+(\.\d+)?$/.test(min) ? +min : NaN), teacher: get(/教师|老师|teacher/i), students: get(/学生|student/i), intent: get(/意图|目的|purpose/i), materials: get(/材料|教具|资源|material/i) });
        continue;
      }
      const t = strip(line), role = ROLE.find(([, re]) => re.test(t));
      if (role && cur) { const v = t.replace(role[1], "").trim(); cur[role[0]] = (cur[role[0]] ? `${cur[role[0]]}\n` : "") + v as never; continue; }
      if (/^([-*]|\d+[.、])/.test(line) && !/^\s{2,}/.test(raw)) {
        const m = /^(.+?)[（(]?\s*(\d+(?:\.\d+)?)\s*(?:分钟|min\w*)\s*[)）]?\s*[:：]\s*(.*)$/.exec(t);
        if (m) { newStep(m[1].trim()); cur!.minutes = +m[2]; cur!.teacher = m[3]; continue; }
      }
      if (cur) { cur.teacher = (cur.teacher ? `${cur.teacher}\n` : "") + t; continue; }
      continue;
    }
    if (sec) L.sections[sec].push(strip(line));
  }
  if (!L.title) L.title = fallbackTitle;
  return L;
}

/** 行为动词不清楚的目标（“了解”“理解”“掌握”“体会”后面没有可观察的行为）。 */
export const VAGUE = /^(?:学生)?(?:初步)?(了解|理解|掌握|体会|感受|知道|熟悉|认识|understand|know|appreciate|learn about)/i;
export const OBSERVABLE = /能|会|说出|写出|算出|画出|比较|解释|举例|判断|设计|完成|列出|区分|表示|读出|explain|identify|compare|solve|write|describe|list|draw|calculate|demonstrate/i;

export const MATERIAL_WORDS = /PPT|课件|视频|音频|卡片|学习单|练习纸|作业纸|实物|模型|图片|挂图|白板|教具|学具|彩纸|彩笔|剪刀|尺子|量杯|计时器|投影|平板|worksheet|slides?|video|cards?|handout|blocks/gi;

export function fmtClock(start: string, plus: number): string {
  const m = /^(\d{1,2})[:：](\d{2})$/.exec(start.trim());
  if (!m) return `${Math.floor(plus)}′`;
  const t = +m[1] * 60 + +m[2] + plus;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(Math.round(t % 60)).padStart(2, "0")}`;
}
