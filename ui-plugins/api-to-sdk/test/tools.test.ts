import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { TypeNamer, tsType } from "../src/codegen.ts";
import { loadApi, parseSpec } from "../src/openapi.ts";
import { createServer } from "../src/server.ts";

// 样例：虚构的 Harbor Bikes Rental API（OpenAPI 3.1，覆盖 $ref/allOf/oneOf+discriminator/const/null/multipart/text/204/安全方案）和真实的 Swagger Petstore 3.0 规范。
const S = process.env.API_SAMPLES ?? "/workspace/zcode-new-plugins/samples/api";
let ws: string;
let call: (name: string, args: Record<string, unknown>) => Promise<any>;
beforeAll(async () => {
  ws = mkdtempSync(join(tmpdir(), "a2s-"));
  mkdirSync(join(ws, "api"));
  for (const f of ["harbor-bikes-api.yaml", "petstore3.json"]) copyFileSync(join(S, f), join(ws, "api", f));
  const server = createServer({ workspaceRoot: ws, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(b);
  call = async (name, args) => (await client.callTool({ name, arguments: args })) as any;
});

describe("spec model and types", () => {
  it("collects operations, merged path-level params, derived ids and security", () => {
    const api = loadApi(parseSpec(readFileSync(join(S, "harbor-bikes-api.yaml"), "utf8")));
    expect(api.ops).toHaveLength(12);
    expect(api.server).toBe("https://api.harborbikes.example/v1");
    const op = (id: string) => api.ops.find((o) => o.id === id)!;
    expect(op("getReportsMonthlyCsv")).toMatchObject({ derivedId: true, method: "GET", path: "/reports/monthly.csv" });
    expect(op("getBike").params.map((p) => `${p.in}:${p.name}`)).toEqual(["path:bikeId"]);
    expect(op("listRentals").params.find((p) => p.in === "header")!.ident).toBe("xBranchId");
    expect(op("health").security).toEqual([]);
    expect(op("getCustomer").security).toEqual([["apiKeyAuth"]]);
    expect(op("uploadBikePhoto").body).toMatchObject({ kind: "multipart", required: true });
    expect(op("deleteBike").success!.status).toBe("204");
    expect(op("createBike").errors.map((e) => e.status)).toEqual(["400", "409"]);
  });
  it("maps schemas to TypeScript", () => {
    const root = parseSpec(readFileSync(join(S, "harbor-bikes-api.yaml"), "utf8"));
    const n = new TypeNamer(Object.keys(root.components.schemas));
    const t = (s: unknown) => tsType(root, s, n).replace(/\s+/g, " ");
    expect(t(root.components.schemas.Bike)).toMatch(/^NewBike & \{ .*id: number; inService: boolean; \}$/);
    expect(t(root.components.schemas.NewRental.properties.customer)).toBe("CustomerRef | NewCustomer");
    expect(t({ type: "string", nullable: true })).toBe("string | null");
    expect(t({ type: ["integer", "null"] })).toBe("number | null");
    expect(t({ type: "object", additionalProperties: { type: "string" } })).toBe("{ [key: string]: string; }");
    expect(t({ type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } })).toBe("Array<string | number>");
    expect(t({ type: "string", format: "binary" })).toBe("Blob");
    expect(t({ properties: { "x-y": { const: 1 } }, required: ["x-y"] })).toBe('{ "x-y": 1; }');
  });
  it("rejects what it can't handle with a clear message", () => {
    expect(() => loadApi({ swagger: "2.0" })).toThrow(/Convert it to OpenAPI 3/);
    expect(() => loadApi({ openapi: "4.0.0", paths: {} })).toThrow(/Unsupported OpenAPI version/);
    expect(() => parseSpec("a: [1,", "x.yaml")).toThrow(/not valid YAML/);
    const api = loadApi({ openapi: "3.0.3", info: { title: "X", version: "1" }, paths: { "/a/{id}": { get: { responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "other.yaml#/Thing" } } } } } } } } });
    expect(api.warnings.join("\n")).toMatch(/External \$ref not supported[\s\S]*path parameter \{id\} is not declared/);
  });
});

describe("tools", () => {
  it("sdk_generate (Harbor Bikes): strict compile + every operation passes against the mock", async () => {
    const r = await call("sdk_generate", { spec: "api/harbor-bikes-api.yaml" });
    expect(r.isError).toBeFalsy();
    const v = r.structuredContent.saved.verify;
    expect(v.diagnostics).toEqual([]);
    expect(v.exampleWarnings).toEqual([]);
    expect(v.ops.filter((o: any) => !o.ok)).toEqual([]);
    expect(v.passed).toBe(12);
    const byOp = Object.fromEntries(v.ops.map((o: any) => [o.op, o.checks.join(" | ")]));
    expect(byOp.listBikes).toMatch(/\?inService&tag/);
    expect(byOp.createBike).toMatch(/error: 400 → ApiError/);
    expect(byOp.deleteBike).toMatch(/empty \(204\)/);
    expect(byOp.uploadBikePhoto).toMatch(/multipart body/);
    expect(byOp.getReportsMonthlyCsv).toMatch(/200 text/);
    const out = join(ws, "sdk/harbor-bikes-rental");
    expect(JSON.parse(readFileSync(join(out, "package.json"), "utf8"))).toMatchObject({ name: "harbor-bikes-rental-sdk", version: "1.4.0", types: "dist/index.d.ts" });
    expect(readFileSync(join(out, "dist/client.d.ts"), "utf8")).toContain("createRental(args: CreateRentalArgs");
    expect(readFileSync(join(out, "README.md"), "utf8")).toContain("| `returnRental` | `POST /rentals/{rentalId}/return` |");
  });

  it("the generated package also builds with the real tsc CLI", () => {
    const tsc = join(import.meta.dirname, "../node_modules/typescript/bin/tsc");
    execFileSync(process.execPath, [tsc, "-p", join(ws, "sdk/harbor-bikes-rental"), "--outDir", join(ws, "tsc-out")], { stdio: "pipe" });
    expect(readFileSync(join(ws, "tsc-out/client.js"), "utf8")).toContain("class HarborBikesRentalClient");
  });

  it("the bundled mock runs on its own", async () => {
    const p = spawn(process.execPath, [join(ws, "sdk/harbor-bikes-rental/mock/server.mjs"), "0"], { stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise<number>((ok, fail) => { let o = ""; p.stdout.on("data", (d) => { o += d; const m = /127\.0\.0\.1:(\d+)/.exec(o); if (m) ok(Number(m[1])); }); setTimeout(() => fail(new Error(o)), 10_000); });
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/bikes/7`);
      expect((await r.json()).serial).toBe("HB-0007");
      const bad = await fetch(`http://127.0.0.1:${port}/v1/bikes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serial: "x" }) });
      expect(bad.status).toBe(400);
      expect((await bad.json()).errors).toEqual(expect.arrayContaining(["body.model: required", "body.category: required"]));
      expect((await fetch(`http://127.0.0.1:${port}/v1/bikes/7`, { headers: { Prefer: "code=404" } })).status).toBe(404);
    } finally { p.kill(); }
  });

  it("sdk_test catches a broken client", async () => {
    const f = join(ws, "sdk/harbor-bikes-rental/src/client.ts");
    const good = readFileSync(f, "utf8");
    writeFileSync(f, good.replace('query: { "category": args.category, "inService": args.inService, "tag": args.tag,', 'query: { "category": args.category, "inService": args.inService,'));
    const r = await call("sdk_test", { out: "sdk/harbor-bikes-rental" });
    writeFileSync(f, good);
    expect(r.structuredContent.saved.verify.ops.find((o: any) => o.op === "listBikes").problems.join()).toMatch(/query tag/);
    writeFileSync(f, good.replace("Promise<GetBikeResponse>", "Promise<GetBikeResponse & { nope: true }> /*x*/").replace("return this.request<GetBikeResponse>", "return this.request<GetBikeResponse & { nope: true }>").replace("async getBike(", "async getBike(this: never, "));
    const r2 = await call("sdk_test", { out: "sdk/harbor-bikes-rental" });
    writeFileSync(f, good);
    expect(r2.structuredContent.saved.verify.compiled).toBe(false);
  });

  it("real-world Petstore 3.0: all 19 operations", async () => {
    const r = await call("sdk_generate", { spec: "api/petstore3.json", out: "sdk/petstore", className: "PetstoreClient", packageName: "@demo/petstore" });
    const v = r.structuredContent.saved.verify;
    expect(v.compiled).toBe(true);
    expect(v.ops.filter((o: any) => !o.ok)).toEqual([]);
    expect(v.passed).toBe(19);
    expect(r.content[0].text).toMatch(/petstore_auth \(oauth2\)/);
  });

  it("sdk_inspect lists operations without writing", async () => {
    const r = await call("sdk_inspect", { spec: "api/petstore3.json" });
    expect(r.structuredContent.api.ops).toHaveLength(19);
    expect(r.content[0].text).toContain("GET    /pet/findByStatus → findPetsByStatus");
    writeFileSync(join(ws, "s2.json"), JSON.stringify({ swagger: "2.0" }));
    expect((await call("sdk_inspect", { spec: "s2.json" })).content[0].text).toMatch(/Swagger 2.0/);
  });
});
