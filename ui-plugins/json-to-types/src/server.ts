import { createApp, esc, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { fields, infer, pascal, type Field } from "./infer.ts";
import { go, jsonSchema, python, ts, zod, type Model } from "./gen.ts";

export const NAME = "json-to-types";
export const VERSION = "0.1.0";
const GEN = { ts: ["types.ts", ts], zod: ["schema.zod.ts", zod], schema: ["schema.json", jsonSchema], python: ["models.py", python], go: ["models.go", go] } as const;
type Lang = keyof typeof GEN;

function getPath(v: unknown, path: string): unknown {
  for (const k of path.split(".").filter(Boolean)) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

function model(p: Project): Model {
  const samples = p.meta.samples as unknown[];
  const rootArray = Boolean(p.meta.rootArray);
  const rootName = pascal(String(p.settings.rootName || "Root"));
  const sh = infer(samples);
  const { types, nameOf, list } = fields(sh, rootName);
  const over = new Map<string, Field>();
  const edits = new Map(p.rows.map((r) => [String(r.path), r]));
  for (const f of list) {
    const e = edits.get(f.path);
    over.set(f.path, e ? { ...f, optional: Boolean(e.optional), nullable: Boolean(e.nullable), description: String(e.description ?? "") } : f);
  }
  return { types, nameOf, over, rootArray, rootName };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "jsontypes",
  title: ["JSON 生成类型定义", "JSON to Types"],
  openDescription:
    "Generate types from sample JSON (API responses, config files, JSONL): TypeScript interfaces, Zod schemas, JSON Schema (2020-12), Python dataclasses and Go structs. Several samples (or every element of an array) are merged, so fields missing from some objects become optional and null values become nullable; integers vs numbers, date-time/date/email/url/uuid strings are detected; nested objects become named types (items → Item). Point at a sub-path (data.orders) to type just that. The field table lets you mark fields optional/nullable and add descriptions (they become doc comments).",
  inputs: { exts: [".json", ".jsonl", ".ndjson"], min: 1, max: 20, label: ["选择一个或多个 JSON 示例", "Pick one or more JSON samples"] },
  settings: [
    { key: "rootName", label: ["根类型名", "Root type name"], type: "text", default: "Root" },
    { key: "path", label: ["只取这个路径（如 data.orders）", "Use only this path (e.g. data.orders)"], type: "text", default: "", reload: true },
    { key: "show", label: ["预览语言", "Preview language"], type: "select", default: "ts", options: [{ value: "ts", label: ["TypeScript", "TypeScript"] }, { value: "zod", label: ["Zod", "Zod"] }, { value: "schema", label: ["JSON Schema", "JSON Schema"] }, { value: "python", label: ["Python dataclass", "Python dataclass"] }, { value: "go", label: ["Go struct", "Go struct"] }] },
  ],
  columns: () => [
    { key: "path", label: ["字段路径", "Field path"], readOnly: true, wide: true },
    { key: "owner", label: ["所属类型", "In type"], readOnly: true },
    { key: "kind", label: ["类型", "Type"], readOnly: true },
    { key: "format", label: ["格式", "Format"], readOnly: true },
    { key: "optional", label: ["可选", "Optional"], type: "bool" },
    { key: "nullable", label: ["可为 null", "Nullable"], type: "bool" },
    { key: "description", label: ["说明", "Description"] },
    { key: "sample", label: ["示例", "Sample"], readOnly: true },
  ],
  async load({ ws, files, settings, previous }) {
    const samples: unknown[] = [];
    let rootArray = false;
    for (const f of files) {
      const text = (await ws.readText(f)).replace(/^\uFEFF/, "");
      let docs: unknown[];
      if (/\.(jsonl|ndjson)$/i.test(f)) docs = text.split(/\r?\n/).filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch { throw new KitError("bad_json", `${f} line ${i + 1} is not valid JSON.`); } });
      else { try { docs = [JSON.parse(text)]; } catch (e) { throw new KitError("bad_json", `${f} is not valid JSON: ${(e as Error).message}`); } }
      for (let d of docs) {
        if (String(settings.path ?? "").trim()) { d = getPath(d, String(settings.path)); if (d === undefined) throw new KitError("bad_path", `Path “${settings.path}” not found in ${f}.`); }
        if (Array.isArray(d)) { rootArray = true; samples.push(...d); } else samples.push(d);
        if (/\.(jsonl|ndjson)$/i.test(f)) rootArray = true;
      }
    }
    if (!samples.some((s) => s && typeof s === "object" && !Array.isArray(s))) throw new KitError("no_objects", "No JSON objects to infer types from (choose a path that points to an object or an array of objects).");
    const keep = new Map((previous ?? []).map((r) => [String(r.path), r]));
    const { list } = fields(infer(samples), pascal(String(settings.rootName || "Root")));
    return { rows: list.map((f) => ({ ...f, ...(keep.has(f.path) ? { optional: keep.get(f.path)!.optional, nullable: keep.get(f.path)!.nullable, description: keep.get(f.path)!.description } : {}) })), meta: { samples, rootArray, count: samples.length } };
  },
  compute(p) {
    const m = model(p);
    const issues: Issue[] = [];
    p.rows.forEach((r, i) => {
      if (String(r.kind).includes("|")) issues.push({ level: "info", row: i, message: `${r.path} has mixed types (${r.kind}); generated as a union.` });
      if (r.kind === "null") issues.push({ level: "warn", row: i, message: `${r.path} is always null in the samples, so its real type is unknown. Add a sample where it has a value.` });
      if (String(r.kind) === "array" && r.emptyArray === true) issues.push({ level: "info", row: i, message: `${r.path} is always an empty array; element type unknown.` });
    });
    const lang = (String(p.settings.show ?? "ts") in GEN ? p.settings.show : "ts") as Lang;
    const code = GEN[lang][1](m);
    const preview = `<p>${p.meta.count} sample object(s) → <b>${m.types.size}</b> type(s): ${[...m.types.keys()].map(esc).join(", ")} · ${p.rows.filter((r) => r.optional).length} optional field(s)</p><pre style="white-space:pre;overflow:auto;font-size:12px">${esc(code)}</pre>`;
    return { rows: p.rows, issues, preview, summary: `${m.types.size} types, ${p.rows.length} fields from ${p.meta.count} samples`, stats: { types: m.types.size, fields: p.rows.length, samples: Number(p.meta.count) } };
  },
  exports: (Object.keys(GEN) as Lang[]).map((id) => ({
    id,
    label: [{ ts: "TypeScript", zod: "Zod", schema: "JSON Schema", python: "Python", go: "Go" }[id], { ts: "TypeScript", zod: "Zod", schema: "JSON Schema", python: "Python", go: "Go" }[id]] as [string, string],
    description: GEN[id][0],
    run: async ({ project, write }) => [await write(GEN[id][0], GEN[id][1](model(project)))],
  })),
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
