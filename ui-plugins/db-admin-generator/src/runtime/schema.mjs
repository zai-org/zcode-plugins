// Shared by DB Admin Generator (the plugin) and the generated admin server. Plain JS, Node >= 22.13 (node:sqlite).
// Reads a SQLite schema and validates rows against it.

/** @param {string} s */
const qi = (s) => `"${String(s).replace(/"/g, '""')}"`;
export const quoteIdent = qi;

function affinity(type) {
  const t = String(type || "").toUpperCase();
  if (t.includes("INT")) return "integer";
  if (/CHAR|CLOB|TEXT/.test(t)) return "text";
  if (t === "" || t.includes("BLOB")) return t === "" ? "any" : "blob";
  if (/REAL|FLOA|DOUB/.test(t)) return "real";
  return "numeric";
}

/** Parse `col IN ('a','b')` style CHECK constraints from CREATE TABLE sql. */
function checkOptions(sql, col) {
  if (!sql) return undefined;
  const esc = col.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`CHECK\\s*\\(\\s*["\`\\[]?${esc}["\`\\]]?\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`, "i");
  const m = re.exec(sql);
  if (!m) return undefined;
  const opts = [...m[1].matchAll(/'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?)/g)].map((x) => (x[1] !== undefined ? x[1].replace(/''/g, "'") : x[2]));
  return opts.length ? opts : undefined;
}

function kindOf(c, table) {
  const t = c.type.toUpperCase(), n = c.name.toLowerCase();
  if (c.fk) return "ref";
  if (c.options) return c.options.every((o) => o === "0" || o === "1") ? "boolean" : "select";
  if (/BOOL/.test(t) || (c.affinity === "integer" && /^(is|has|can|in)_/.test(n))) return "boolean";
  if (/DATETIME|TIMESTAMP/.test(t) || (c.affinity !== "integer" && /_at$/.test(n))) return "datetime";
  if (/^DATE$/.test(t) || /(_on|_date|^date)$/.test(n)) return "date";
  if (c.affinity === "integer") return "integer";
  if (c.affinity === "real" || (c.affinity === "numeric" && !/DATE|TIME|BOOL/.test(t))) return "number";
  if (/e-?mail/.test(n)) return "email";
  if (/(^|_)(url|website|link)$/.test(n)) return "url";
  if (/(^|_)(phone|tel|mobile)$/.test(n)) return "tel";
  if (/^(notes?|description|body|content|comment|bio|details)$/.test(n) || /TEXT|CLOB/.test(t) && /note|desc|comment/.test(n)) return "longtext";
  void table;
  return "text";
}

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {Array<{name:string,type:"table"|"view",sql:string,pk:string[],rowid:boolean,columns:any[],rows:number,refs:any[]}>}
 */
export function introspect(db) {
  const objs = db.prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const tables = [];
  for (const o of objs) {
    const cols = db.prepare(`PRAGMA table_xinfo(${qi(o.name)})`).all().filter((c) => !c.hidden);
    const fks = o.type === "table" ? db.prepare(`PRAGMA foreign_key_list(${qi(o.name)})`).all() : [];
    const uniques = new Set();
    if (o.type === "table") for (const ix of db.prepare(`PRAGMA index_list(${qi(o.name)})`).all()) {
      if (!ix.unique || ix.origin === "pk") continue;
      const ic = db.prepare(`PRAGMA index_info(${qi(ix.name)})`).all();
      if (ic.length === 1) uniques.add(ic[0].name);
    }
    const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    const withoutRowid = /WITHOUT\s+ROWID\s*;?\s*$/i.test(o.sql || "");
    const columns = cols.map((c) => {
      const fk = fks.find((f) => f.from === c.name && fks.filter((g) => g.id === f.id).length === 1);
      const col = {
        name: c.name, type: c.type || "", affinity: affinity(c.type), notNull: !!c.notnull || (c.pk > 0 && !(pk.length === 1 && /^INTEGER$/i.test(c.type || "") && !withoutRowid)),
        default: c.dflt_value, pk: c.pk, unique: uniques.has(c.name) || (pk.length === 1 && pk[0] === c.name),
        fk: fk ? { table: fk.table, column: fk.to ?? null, onDelete: fk.on_delete } : undefined,
        options: checkOptions(o.sql, c.name),
        maxLength: /\(\s*(\d+)\s*\)/.test(c.type || "") && /CHAR/i.test(c.type) ? Number(/\(\s*(\d+)/.exec(c.type)[1]) : undefined,
        auto: pk.length === 1 && pk[0] === c.name && /^INTEGER$/i.test(c.type || "") && !withoutRowid,
      };
      col.kind = kindOf(col, o.name);
      return col;
    });
    let rows = 0;
    try { rows = db.prepare(`SELECT COUNT(*) AS n FROM ${qi(o.name)}`).get().n; } catch { rows = -1; }
    tables.push({ name: o.name, type: o.type, sql: o.sql || "", pk, rowid: o.type === "table" && !withoutRowid && pk.length === 0, columns, rows, refs: [] });
  }
  // FK target column defaults to the target's primary key
  for (const t of tables) for (const c of t.columns) if (c.fk) {
    const target = tables.find((x) => x.name === c.fk.table);
    if (!c.fk.column) c.fk.column = target?.pk[0] ?? "rowid";
    if (target) target.refs.push({ table: t.name, column: c.name });
  }
  return tables;
}

/** A column a human would recognise a row by. */
export function labelColumn(t) {
  const names = t.columns.map((c) => c.name);
  for (const want of ["name", "full_name", "display_name", "title", "label", "username", "model", "email", "serial", "code"]) { const hit = names.find((n) => n.toLowerCase() === want); if (hit) return hit; }
  return t.columns.find((c) => c.kind === "text" && !c.pk)?.name ?? t.pk[0] ?? names[0];
}

export const required = (c) => c.notNull && c.default === null && !c.auto;
export const editable = (c) => !c.auto && !(c.name === "created_at" || c.name === "updated_at") ;

const DATE = /^\d{4}-\d{2}-\d{2}$/, DT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validate and coerce one row for insert/update. Returns { values, errors } where errors maps column → message.
 * @param {{columns:any[]}} t
 * @param {Record<string, unknown>} input
 * @param {"create"|"update"} mode
 */
export function validateRow(t, input, mode, lang = "en") {
  const zh = lang === "zh";
  const M = zh ? { req: "必填", int: "需要整数", num: "需要数字", date: "日期格式应为 YYYY-MM-DD", dt: "时间格式应为 YYYY-MM-DD HH:MM", email: "邮箱格式不对", url: "需要 http(s) 链接", opt: "不在可选值里", len: (n) => `最多 ${n} 个字符`, bool: "需要 是/否" }
    : { req: "Required", int: "Must be a whole number", num: "Must be a number", date: "Use YYYY-MM-DD", dt: "Use YYYY-MM-DD HH:MM", email: "Not a valid email", url: "Needs an http(s) link", opt: "Not one of the allowed values", len: (n) => `At most ${n} characters`, bool: "Must be yes/no" };
  const values = {}, errors = {};
  for (const c of t.columns) {
    if (!editable(c)) continue;
    if (!(c.name in input)) { if (mode === "create" && required(c)) errors[c.name] = M.req; continue; }
    let v = input[c.name];
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) v = null;
    if (v === null) {
      if (required(c) || (mode === "update" && c.notNull)) errors[c.name] = M.req;
      else if (!(mode === "create" && c.default !== null)) values[c.name] = null; // let the column default apply on insert
      continue;
    }
    switch (c.kind) {
      case "boolean": if (v === true || v === 1 || v === "1" || v === "true") v = 1; else if (v === false || v === 0 || v === "0" || v === "false") v = 0; else { errors[c.name] = M.bool; continue; } break;
      case "integer": if (!/^-?\d+$/.test(String(v))) { errors[c.name] = M.int; continue; } v = Number(v); break;
      case "number": if (!Number.isFinite(Number(v))) { errors[c.name] = M.num; continue; } v = Number(v); break;
      case "date": if (!DATE.test(String(v))) { errors[c.name] = M.date; continue; } break;
      case "datetime": if (!DT.test(String(v))) { errors[c.name] = M.dt; continue; } v = String(v).replace("T", " ").replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/, "$1:00"); break;
      case "email": if (!EMAIL.test(String(v))) { errors[c.name] = M.email; continue; } break;
      case "url": if (!/^https?:\/\/\S+$/i.test(String(v))) { errors[c.name] = M.url; continue; } break;
      case "ref": if (c.affinity === "integer") { if (!/^-?\d+$/.test(String(v))) { errors[c.name] = M.int; continue; } v = Number(v); } break;
      default: break;
    }
    if (c.options && !c.options.includes(String(v))) { errors[c.name] = M.opt; continue; }
    if (c.maxLength && String(v).length > c.maxLength) { errors[c.name] = M.len(c.maxLength); continue; }
    if (typeof v === "object") v = JSON.stringify(v);
    values[c.name] = v;
  }
  return { values, errors };
}
