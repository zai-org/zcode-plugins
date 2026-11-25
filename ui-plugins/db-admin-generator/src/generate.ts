import { readFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
// @ts-expect-error plain JS runtime shared with the generated admin
import { introspect, labelColumn, required } from "./runtime/schema.mjs";

export type Op = "read" | "create" | "update" | "delete";
export const OPS: Op[] = ["read", "create", "update", "delete"];
export interface Column { name: string; type: string; kind: string; notNull: boolean; default: string | null; pk: number; unique: boolean; auto: boolean; fk?: { table: string; column: string }; options?: string[]; maxLength?: number }
export interface Table { name: string; type: "table" | "view"; sql: string; pk: string[]; rowid: boolean; columns: Column[]; rows: number; refs: { table: string; column: string }[] }
export interface TablePlan { name: string; label: string; ops: Op[]; list: string[]; search: string[]; hidden: string[]; labelColumn: string }
export interface Plan { title: string; lang: "zh" | "en"; db: string; out: string; port: number; pageSize: number; roles: Record<"admin" | "editor" | "viewer", Op[]>; tables: TablePlan[] }

export const DEFAULT_ROLES: Plan["roles"] = { admin: ["read", "create", "update", "delete"], editor: ["read", "create", "update"], viewer: ["read"] };
const SENSITIVE = /(^|_)(password|passwd|pwd|hash|salt|secret|token|api_?key|otp)(_|$)/i;
const INTERNAL = /(^_|migrations?$|^schema_version$|^knex_|^__)/i;

export async function openDb(abs: string, readOnly = true) {
  let mod: typeof import("node:sqlite");
  try { mod = await import("node:sqlite"); } catch { throw new Error("This needs Node.js 22.13 or newer (built-in node:sqlite)."); }
  return new mod.DatabaseSync(abs, { readOnly });
}
export function inspect(db: unknown): Table[] { return introspect(db) as Table[]; }
export const isRequired = (c: Column): boolean => required(c);

export function slug(s: string) { return s.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "db"; }

export function defaultPlan(dbRel: string, tables: Table[]): Plan {
  const name = basename(dbRel, extname(dbRel));
  return {
    title: `${name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Admin`, lang: "en", db: dbRel, out: `${slug(name)}-admin`, port: 8787, pageSize: 25, roles: structuredClone(DEFAULT_ROLES),
    tables: tables.map((t) => {
      const hidden = t.columns.filter((c) => SENSITIVE.test(c.name)).map((c) => c.name);
      const visible = t.columns.filter((c) => !hidden.includes(c.name));
      return {
        name: t.name, label: t.name.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
        ops: INTERNAL.test(t.name) ? [] : t.type === "view" ? ["read"] : [...OPS],
        list: visible.filter((c) => c.kind !== "longtext").slice(0, 7).map((c) => c.name),
        search: visible.filter((c) => ["text", "email", "tel", "select", "longtext", "url"].includes(c.kind)).map((c) => c.name),
        hidden, labelColumn: labelColumn(t),
      };
    }),
  };
}

export interface TablePatch { name: string; label?: string; ops?: Op[]; list?: string[]; search?: string[]; hidden?: string[]; labelColumn?: string }
export function applyPatch(plan: Plan, tables: Table[], patch: { title?: string; lang?: "zh" | "en"; out?: string; port?: number; pageSize?: number; roles?: Partial<Record<"editor" | "viewer", Op[]>>; tables?: TablePatch[]; only?: string[] }) {
  if (patch.title) plan.title = patch.title;
  if (patch.lang) plan.lang = patch.lang;
  if (patch.out) plan.out = patch.out.replace(/\\/g, "/").replace(/\/+$/, "");
  if (patch.port) plan.port = patch.port;
  if (patch.pageSize) plan.pageSize = patch.pageSize;
  for (const r of ["editor", "viewer"] as const) if (patch.roles?.[r]) plan.roles[r] = OPS.filter((o) => patch.roles![r]!.includes(o));
  if (patch.only) { const set = new Set(patch.only); for (const tp of plan.tables) if (!set.has(tp.name)) tp.ops = []; for (const n of set) if (!plan.tables.find((x) => x.name === n)) throw new Error(`No table “${n}”. Tables: ${plan.tables.map((x) => x.name).join(", ")}`); }
  for (const p of patch.tables ?? []) {
    const tp = plan.tables.find((x) => x.name === p.name), t = tables.find((x) => x.name === p.name);
    if (!tp || !t) throw new Error(`No table “${p.name}”. Tables: ${tables.map((x) => x.name).join(", ")}`);
    const cols = new Set(t.columns.map((c) => c.name));
    const check = (list: string[] | undefined, what: string) => { for (const c of list ?? []) if (!cols.has(c)) throw new Error(`${p.name}.${what}: no column “${c}”. Columns: ${[...cols].join(", ")}`); return list; };
    if (p.label) tp.label = p.label;
    if (p.ops) { tp.ops = OPS.filter((o) => p.ops!.includes(o)); if (t.type === "view") tp.ops = tp.ops.filter((o) => o === "read"); if (tp.ops.length && !tp.ops.includes("read")) tp.ops.unshift("read"); }
    if (p.list) tp.list = check(p.list, "list")!;
    if (p.search) tp.search = check(p.search, "search")!;
    if (p.hidden) tp.hidden = check(p.hidden, "hidden")!;
    if (p.labelColumn) tp.labelColumn = check([p.labelColumn], "labelColumn")![0];
  }
  if (!plan.tables.some((t) => t.ops.length)) throw new Error("Choose at least one table.");
  return plan;
}

/** Files of the generated admin: path (relative to the output folder) → contents. */
export async function emit(plan: Plan, runtimeDir: string, workspaceRoot: string): Promise<Record<string, string>> {
  const rt = async (p: string) => readFile(join(runtimeDir, p), "utf8");
  const zh = plan.lang === "zh";
  const dbFromOut = relative(join(workspaceRoot, plan.out), join(workspaceRoot, plan.db)).replace(/\\/g, "/");
  const enabled = plan.tables.filter((t) => t.ops.length);
  const config = {
    title: plan.title, lang: plan.lang, db: dbFromOut, port: plan.port, pageSize: plan.pageSize, sessionHours: 12, roles: plan.roles,
    tables: enabled.map((t) => ({ name: t.name, label: t.label, ops: t.ops, list: t.list.filter((c) => !t.hidden.includes(c)), search: t.search.filter((c) => !t.hidden.includes(c)), hidden: t.hidden, labelColumn: t.labelColumn })),
  };
  const matrix = (["admin", "editor", "viewer"] as const).map((r) => `| ${r} | ${plan.roles[r].join(", ") || "—"} |`).join("\n");
  const tableRows = enabled.map((t) => `| \`${t.name}\` | ${t.label} | ${t.ops.join(", ")} |${t.hidden.length ? ` ${t.hidden.join(", ")}` : " —"} |`).join("\n");
  const readme = zh ? `# ${plan.title}

由 ZCode 的“数据库转管理后台”插件生成的管理后台。没有第三方依赖，只需要 **Node.js 22.13 或更新版本**（内置 \`node:sqlite\`）。

## 启动

\`\`\`bash
node server.mjs
\`\`\`

打开 http://127.0.0.1:${plan.port} 。第一次启动时，如果还没有用户，会自动创建 \`admin\` 用户，并在终端里打印随机密码。

- 数据库：\`${dbFromOut}\`（相对于本文件夹；可用环境变量 \`ADMIN_DB\` 指定其他文件）
- 端口和地址：\`PORT\`（默认 ${plan.port}）、\`HOST\`（默认 127.0.0.1，只允许本机访问）

## 用户与角色

\`\`\`bash
node server.mjs user add alice editor      # 添加用户，会打印随机密码；也可以用 ADMIN_PASSWORD=... 指定
node server.mjs user passwd admin          # 修改密码
node server.mjs user list
node server.mjs user remove alice
\`\`\`

| 角色 | 允许的操作 |
|---|---|
${matrix}

每张表实际能做的操作 = 表的设置 ∩ 角色的权限。权限检查都在服务器端完成。

| 表 | 名称 | 操作 | 隐藏的列 |
|---|---|---|---|
${tableRows}

## 安全

- 密码使用 scrypt 加盐哈希，保存在 \`users.json\`；会话 Cookie 带 HMAC 签名（密钥在 \`.session-secret\`），HttpOnly + SameSite=Strict，修改类请求还要求 \`X-Admin\` 请求头。
- 同一 IP 连续输错 5 次密码，会锁定 10 分钟；所有修改都记入 \`audit.log\`。
- 所有 SQL 都使用参数绑定，表名和列名只来自数据库结构白名单。
- 默认只监听本机。如果要给别人用，请放在 HTTPS 反向代理后面，再设置 \`HOST=0.0.0.0\`。
- \`users.json\`、\`.session-secret\`、\`audit.log\` 已加入 \`.gitignore\`，不要提交。

## 修改

可以直接编辑 \`admin.config.json\`（表、操作、列表列、搜索列、隐藏列、角色），重启后生效；也可以在 ZCode 里让插件重新生成。
` : `# ${plan.title}

Admin panel generated by the ZCode **DB Admin Generator** plugin. No third-party dependencies; needs **Node.js 22.13 or newer** (built-in \`node:sqlite\`).

## Run

\`\`\`bash
node server.mjs
\`\`\`

Open http://127.0.0.1:${plan.port}. On first start with no users, an \`admin\` user is created and its random password is printed in the terminal.

- Database: \`${dbFromOut}\` (relative to this folder; set \`ADMIN_DB\` to use another file)
- Port / address: \`PORT\` (default ${plan.port}), \`HOST\` (default 127.0.0.1, this computer only)

## Users and roles

\`\`\`bash
node server.mjs user add alice editor      # prints a random password, or set ADMIN_PASSWORD=...
node server.mjs user passwd admin
node server.mjs user list
node server.mjs user remove alice
\`\`\`

| Role | Allowed operations |
|---|---|
${matrix}

What a user can do on a table = the table's operations ∩ the role's operations, enforced on the server.

| Table | Label | Operations | Hidden columns |
|---|---|---|---|
${tableRows}

## Security

- Passwords are salted scrypt hashes in \`users.json\`. Session cookies are HMAC-signed (key in \`.session-secret\`), HttpOnly and SameSite=Strict, and write requests also need the \`X-Admin\` header.
- 5 wrong passwords from one IP lock sign-in for 10 minutes. Every change is appended to \`audit.log\`.
- All SQL uses bound parameters; table and column names come only from the database schema.
- Listens on this computer only by default. To share it, put it behind an HTTPS reverse proxy and set \`HOST=0.0.0.0\`.
- \`users.json\`, \`.session-secret\` and \`audit.log\` are in \`.gitignore\`; don't commit them.

## Changing it

Edit \`admin.config.json\` (tables, operations, list/search/hidden columns, roles) and restart, or ask the plugin in ZCode to regenerate.
`;
  return {
    "server.mjs": await rt("server.mjs"),
    "schema.mjs": await rt("schema.mjs"),
    "public/index.html": (await rt("public/index.html")).replace("<title>Admin</title>", `<title>${plan.title.replace(/[<&>"]/g, "")}</title>`),
    "public/app.js": await rt("public/app.js"),
    "public/style.css": await rt("public/style.css"),
    "admin.config.json": JSON.stringify(config, null, 2) + "\n",
    "package.json": JSON.stringify({ name: slug(plan.title), version: "0.1.0", private: true, type: "module", scripts: { start: "node server.mjs" }, engines: { node: ">=22.13" } }, null, 2) + "\n",
    "README.md": readme,
    ".gitignore": "users.json\n.session-secret\naudit.log\n",
  };
}
