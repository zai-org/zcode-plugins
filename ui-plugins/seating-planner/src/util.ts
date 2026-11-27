import { num } from "./kit/columns.ts";

/** 小工具：去空白字符串、带默认值的数字、是/否判断。 */
export const s = (v: unknown) => String(v ?? "").trim();
export const n0 = (v: unknown, d = 0) => {
  const x = num(v);
  return Number.isFinite(x) ? x : d;
};
export const yes = (v: unknown) => v === true || /^(1|y|yes|true|是|√|✓|x|on)$/i.test(s(v));
export const fmt2 = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
/** 插件自己的输出文件夹（工作区顶层 <name>/）不当作输入。 */
export const notOutput = (name: string) => (p: string) => !p.startsWith(`${name}/`);
export const pad2 = (n: number) => String(n).padStart(2, "0");
