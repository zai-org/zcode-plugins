import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { type AppConfig, buildableHere, builderArgs, builderYml, mainCjs, packageJson, validate } from "../src/config.ts";
import { detect } from "../src/detect.ts";
import { defaultIcon, pngSize } from "../src/png.ts";
import { createServer } from "../src/server.ts";

// 两个虚构样例项目：focus-timer（静态单页应用，绝对路径 /assets、前端路由）和 notes-server（无依赖 Node 服务）。
const SAMPLES = process.env.APP_SAMPLES ?? "/workspace/zcode-new-plugins/samples/app";
let ws: string;
async function connect(platform: NodeJS.Platform, wine = false) {
  const server = createServer({ workspaceRoot: ws, assetRoot: join(import.meta.dirname, "../dist"), platform, wine });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(b);
  return async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
}
beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "aib-"));
  await cp(SAMPLES, ws, { recursive: true });
  execFileSync(process.execPath, ["build.mjs"], { cwd: join(ws, "focus-timer") });
});

const base: AppConfig = { name: "Focus Timer", appId: "com.penovalabs.focustimer", version: "1.3.0", mode: "static", webDir: "dist", width: 1200, height: 800, targets: ["dmg", "nsis"] };

describe("detect", () => {
  it("finds the static site, the server and icons", async () => {
    const s = await detect(join(ws, "focus-timer"), "focus-timer");
    expect(s).toMatchObject({ kind: "static", webDir: "dist", name: "Focus Timer", version: "1.3.0", author: "Penova Labs" });
    expect(s.icons[0]).toEqual({ path: "branding/icon-1024.png", width: 1024, height: 1024 });
    const n = await detect(join(ws, "notes-server"), "notes-server");
    expect(n).toMatchObject({ kind: "server", entry: "server.js", usesPortEnv: true, port: 3000, name: "Team Notes", version: "0.4.2" });
    expect(n.icons).toEqual([]);
  });
});

describe("config", () => {
  it("validates", () => {
    expect(validate(base, { web: true }).filter((i) => i.severity !== "info")).toEqual([]);
    const bad = validate({ ...base, appId: "focus", version: "1.3", name: "A/B", targets: [], width: 100 }, { web: false, icon: { width: 256, height: 256 } });
    expect(bad.filter((i) => i.severity === "error").map((i) => i.field).sort()).toEqual(["appId", "name", "targets", "version", "webDir", "window"]);
    expect(validate({ ...base, icon: "x.png" }, { web: true, icon: { width: 256, height: 256 } }).find((i) => i.field === "icon")?.message).toMatch(/at least 512/);
    expect(validate({ ...base, mode: "server", entry: "server.js", usesPortEnv: false }, { entry: true }).find((i) => i.field === "port")?.severity).toBe("error");
    expect(validate({ ...base, appId: "com.example.focustimer" }, { web: true }).find((i) => i.field === "appId")?.severity).toBe("warning");
    expect(validate(base, { web: true }).filter((i) => i.field === "signing").map((i) => i.message).join()).toMatch(/unsigned.*SmartScreen/s);
  });
  it("writes electron-builder.yml for dmg + nsis, unsigned or with the user's certificate", () => {
    const y = builderYml(base);
    expect(y).toMatch(/appId: "com\.penovalabs\.focustimer"/);
    expect(y).toMatch(/mac:\n  target: \[dmg\]/);
    expect(y).toMatch(/win:\n  target: \[nsis\]/);
    expect(y).toMatch(/identity: null/);
    expect(y).toMatch(/- from: "\.\.\/dist"\n    to: web/);
    expect(y).not.toMatch(/certificateFile/);
    const s = builderYml({ ...base, signing: { macIdentity: "Developer ID Application: Penova Labs (ABCDE12345)", winCertificateFile: "certs/sign.pfx" } });
    expect(s).toMatch(/identity: "Developer ID Application: Penova Labs \(ABCDE12345\)"\n  hardenedRuntime: true/);
    expect(s).toMatch(/certificateFile: "\.\.\/certs\/sign\.pfx"/);
    expect(s).not.toMatch(/certificatePassword/);
    const srv = builderYml({ ...base, mode: "server", entry: "server.js" });
    expect(srv).toMatch(/- from: \.\.\n    to: server/);
    expect(JSON.parse(packageJson(base))).toMatchObject({ name: "focus-timer", productName: "Focus Timer", main: "main.cjs", devDependencies: { electron: expect.any(String), "electron-builder": expect.any(String) } });
  });
  it("generates a main.cjs that parses", async () => {
    for (const c of [base, { ...base, mode: "server" as const, entry: "server.js", usesPortEnv: true }]) {
      const f = join(ws, `main-${c.mode}.cjs`);
      await writeFile(f, mainCjs(c));
      expect(() => execFileSync(process.execPath, ["--check", f])).not.toThrow();
    }
    expect(mainCjs(base)).toMatch(/protocol\.handle\("app"/);
    expect(mainCjs({ ...base, mode: "server", entry: "server.js" })).toMatch(/ELECTRON_RUN_AS_NODE/);
  });
  it("knows what each OS can build", () => {
    expect(buildableHere("dmg", "linux", false).ok).toBe(false);
    expect(buildableHere("dmg", "darwin", false).ok).toBe(true);
    expect(buildableHere("nsis", "darwin", false)).toEqual({ ok: false, why: expect.stringMatching(/Wine/) });
    expect(buildableHere("nsis", "linux", true).ok).toBe(true);
    expect(buildableHere("appimage", "win32", false).ok).toBe(false);
    expect(builderArgs("dir", "darwin")).toEqual(["--mac", "dir"]);
    expect(builderArgs("nsis", "linux")).toEqual(["--win", "nsis"]);
  });
  it("draws a default icon", () => {
    const png = defaultIcon("#0f766e");
    expect(pngSize(png)).toEqual({ width: 1024, height: 1024 });
    expect(png.length).toBeLessThan(200_000);
  });
});

describe("tools", () => {
  it("scans, generates and refuses targets this OS cannot build", async () => {
    const call = await connect("linux");
    expect((await call("app_scan", { dir: "notes-server" })).content[0].text).toMatch(/server \(entry server\.js, reads PORT\)/);
    const s = await call("app_setup", { dir: "focus-timer", appId: "com.penovalabs.focustimer" });
    expect(s.content[0].text).toMatch(/Generated focus-timer\/desktop\/.*icon-1024\.png/);
    expect(s.structuredContent.generated).toEqual(["package.json", "main.cjs", "electron-builder.yml", "build/icon.png", "README.md"]);
    expect(await readFile(join(ws, "focus-timer/desktop/README.md"), "utf8")).toMatch(/\*\*unsigned\*\*/);
    expect((await call("app_build", { target: "dmg" })).content[0].text).toMatch(/\[wrong_platform\] dmg can only be built on macOS\. .*--mac dmg/);
    expect((await call("app_build", { target: "nsis" })).content[0].text).toMatch(/needs Wine/);
    const bad = await call("app_setup", { version: "two" });
    expect(bad.content[0].text).toMatch(/NOT generated[\s\S]*semver/);
    expect((await call("app_build", { target: "dir" })).content[0].text).toMatch(/\[invalid_config\]/);
    const n = await call("app_setup", { dir: "notes-server", appId: "com.penovalabs.teamnotes", targets: ["dmg", "nsis", "appimage"] });
    expect(n.content[0].text).toMatch(/build\/icon\.png \(generated\).*\(server server\.js\)/s);
    expect(pngSize(await readFile(join(ws, "notes-server/desktop/build/icon.png")))).toEqual({ width: 1024, height: 1024 });
    expect((await call("app_setup", { dir: "../x" })).content[0].text).toMatch(/outside_workspace/);
  });
  it("on a Mac the same config can build dmg; nsis needs Wine", async () => {
    const call = await connect("darwin");
    const c = await call("app_check", { dir: "notes-server" });
    expect(c.content[0].text).toMatch(/dmg: can build here; nsis: not here — nsis on macOS needs Wine/);
  });
});
