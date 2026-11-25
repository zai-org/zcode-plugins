import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { typecheck } from "../src/compile.ts";
import { createServer } from "../src/server.ts";
import { DEFAULT_TOKENS, tokensCss, tokensTs, validateTokens } from "../src/tokens.ts";

// 虚构的 “Fieldnote UI” 设计稿和 Agent 写的组件（samples/components）。
const SAMPLES = process.env.DC_SAMPLES ?? "/workspace/zcode-new-plugins/samples/components";
const DIST = join(import.meta.dirname, "../dist");
let ws: string;
let call: (name: string, args: Record<string, unknown>) => Promise<any>;
const A = (f: string) => readFile(join(SAMPLES, "agent", f), "utf8");
beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "dc-"));
  await cp(SAMPLES, join(ws, "design"), { recursive: true });
  const server = createServer({ workspaceRoot: ws, assetRoot: DIST });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(b);
  call = async (name, args) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })) as any;
});

describe("tokens", () => {
  it("generates CSS variables and a typed module", () => {
    expect(tokensCss(DEFAULT_TOKENS)).toContain("--color-primary: #2563eb;");
    expect(tokensCss(DEFAULT_TOKENS)).toContain("--font-size-md: 16px;");
    expect(tokensCss(DEFAULT_TOKENS)).toContain("--space-4: 16px;");
    expect(tokensTs(DEFAULT_TOKENS)).toContain('"primary": { value: "#2563eb", css: "var(--color-primary)" }');
    expect(validateTokens(DEFAULT_TOKENS)).toEqual([]);
    const bad = validateTokens({ ...DEFAULT_TOKENS, colors: { Primary: "#12", ok: "red;}" }, radii: { md: "big" } });
    expect(bad.map((b) => `${b.group}.${b.key}`)).toEqual(["colors.Primary", "colors.Primary", "colors.ok", "radii.md"]);
  });
  it("type-checks TSX against the bundled React types", () => {
    const ok = typecheck({ "src/A.tsx": 'import { useState } from "react";\nexport function A() { const [n, set] = useState(0); return <button onClick={() => set(n + 1)}>{n}</button>; }\n' }, join(DIST, "types"));
    expect(ok).toEqual([]);
    const bad = typecheck({ "src/A.tsx": 'export function A({ n }: { n: number }) { return <div onClik={1}>{n.toFixed()}</div>; }\nexport const x = <A n="1" />;\n' }, join(DIST, "types"));
    expect(bad.map((i) => i.line)).toEqual([1, 2]);
    expect(bad[0].message).toMatch(/onClik/);
  });
});

describe("tools", () => {
  it("builds the Fieldnote kit from a bad draft to a clean catalog", async () => {
    const n = await call("dc_new", { name: "Fieldnote UI", design: ["design/fieldnote-design.png"], tokens: JSON.parse(await A("tokens.json")) });
    expect(n.isError).toBeFalsy();
    expect(await readFile(join(ws, "ui-kit/fieldnote-ui/tokens.css"), "utf8")).toContain("--color-primary: #1f6f5c;");
    await call("dc_plan", { components: [{ name: "Button", states: ["primary", "secondary", "disabled", "loading"] }, { name: "TextField", states: ["default", "error"] }, { name: "Badge", states: ["success", "warning", "neutral"] }, { name: "Card", states: [] }] });
    expect((await call("dc_plan", { components: [{ name: "price-tag", states: [] }] })).content[0].text).toMatch(/PascalCase/);
    const d = await call("dc_write", { files: { "Button.tsx": await A("Button.first-draft.tsx"), "Button.css": await A("Button.css") } });
    const msgs = d.structuredContent.issues.map((i: any) => `${i.severity}:${i.source}:${i.line ?? ""}`);
    expect(msgs).toEqual(expect.arrayContaining(["error:typescript:5", "error:typescript:8", "warning:check:5"]));
    expect(d.content[0].text).toMatch(/No example for the planned state “loading”/);
    expect(d.content[0].text).toMatch(/Hard-coded colour #1f6f5c/);
    const files: Record<string, string> = {};
    for (const f of ["Button", "TextField", "Badge", "Card"]) for (const e of ["tsx", "css"]) files[`${f}.${e}`] = await A(`${f}.${e}`);
    const w = await call("dc_write", { files });
    expect(w.structuredContent.issues).toEqual([]);
    expect(w.structuredContent.plan.map((p: any) => `${p.name}:${p.status}:${p.examples}`)).toEqual(["Button:done:4", "TextField:done:2", "Badge:done:3", "Card:done:2"]);
    const pv: string = w.structuredContent.preview;
    expect(pv).toContain('<button class="fn-button fn-button--primary">Save entry</button>');
    expect(pv).toMatch(/aria-busy="true"/);
    expect(pv).toContain('aria-invalid="true"');
    expect(pv).toContain(".fn-badge--success{");
    const cat = await readFile(join(ws, "ui-kit/fieldnote-ui/catalog/index.html"), "utf8");
    expect(cat).toContain("globalThis.__dc");
    expect(cat).toContain("--color-primary: #1f6f5c;");
    expect(await readFile(join(ws, "ui-kit/fieldnote-ui/index.ts"), "utf8")).toContain('export { TextField } from "./src/TextField";');
  });
  it("reports render errors, bad imports and missing exports; updates tokens", async () => {
    const r = await call("dc_write", { files: { "Broken.tsx": 'import x from "lodash";\nexport const y = x;\nexport const examples = [];\n' } });
    expect(r.content[0].text).toMatch(/Package “lodash” is not available/);
    const t = await call("dc_write", { files: { "Broken.tsx": 'export function Broken(): JSX.Element { throw new Error("boom"); }\nexport const examples = [{ name: "Default", render: () => <Broken /> }];\n' } });
    expect(t.content[0].text).toMatch(/Example “Default” failed to render: boom/);
    const m = await call("dc_write", { files: { "Broken.tsx": "export const examples = [];\n" } });
    expect(m.content[0].text).toMatch(/must export a component named Broken/);
    expect((await call("dc_write", { files: {}, delete: ["Broken.tsx"] })).structuredContent.issues).toEqual([]);
    expect((await call("dc_write", { files: { "../evil.ts": "x" } })).content[0].text).toMatch(/bad_path/);
    const tk = await call("dc_tokens", { tokens: { colors: { primary: "#0b5d4b" } } });
    expect(tk.structuredContent.preview).toContain("--color-primary: #0b5d4b;");
    expect((await call("dc_tokens", { tokens: { colors: { primary: "green-ish" } } })).content[0].text).toMatch(/not a colour/);
  });
});
