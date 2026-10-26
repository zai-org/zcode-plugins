import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertKicadRuntimeTools, prepareKicadRuntime } from "./prepare-kicad-runtime.mjs";

async function fixture(t, content) {
  const dir = await mkdtemp(join(tmpdir(), "kicad-prepare-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const launcher = join(dir, "launcher.mjs");
  await writeFile(launcher, content);
  return [launcher, dir];
}

test("preparation waits for runtime and forwards only allowed network settings", async (t) => {
  const [launcher, cwd] = await fixture(t, `
    import assert from 'node:assert/strict';
    assert.equal(process.argv[2], '--prepare-runtime');
    assert.equal(process.env.HTTPS_PROXY, 'http://localhost:1234');
    assert.equal(process.env.CI_JOB_TOKEN, undefined);
    setTimeout(() => console.log('ready'), 100);
  `);
  assert.deepEqual(await prepareKicadRuntime(launcher, cwd, { env: {
    HTTPS_PROXY: "http://localhost:1234", CI_JOB_TOKEN: "must-not-reach-child",
  } }), { UV_OFFLINE: "1", UV_PYTHON_INSTALL_DIR: join(userInfo().homedir, ".cache", "zcode-plugins", "uv-python") });
});

test("failed preparation cannot become a successful fallback artifact", async (t) => {
  const [launcher, cwd] = await fixture(t, "console.log('ready'); process.exitCode = 1;");
  await assert.rejects(prepareKicadRuntime(launcher, cwd), /preparation failed/);
});

test("unexpected preparation output fails before the MCP transport starts", async (t) => {
  const [launcher, cwd] = await fixture(t, "console.log('/python\\nextra output');");
  await assert.rejects(prepareKicadRuntime(launcher, cwd), /preparation failed/);
});

test("hung preparation is bounded", async (t) => {
  const [launcher, cwd] = await fixture(t, "setInterval(() => {}, 1000);");
  await assert.rejects(prepareKicadRuntime(launcher, cwd, { timeoutMs: 100 }), /SIGKILL/);
});

test("only the actual Python tool set passes the artifact check", () => {
  assert.throws(() => assertKicadRuntimeTools([{ name: "kicad_setup_help" }, { name: "kicad_board_view" }]), /requires the Python server/);
  assert.throws(() => assertKicadRuntimeTools([]), /requires the Python server/);
  assert.doesNotThrow(() => assertKicadRuntimeTools([{ name: "pcb_build" }]));
});


test("preparation reuses CI build egress without leaking it into the MCP environment", async (t) => {
  const [launcher, cwd] = await fixture(t, `
    import assert from 'node:assert/strict';
    assert.equal(process.env.HTTPS_PROXY, 'http://localhost:5678');
    assert.equal(process.env.https_proxy, 'http://localhost:5678');
    assert.equal(process.env.CRAFT_HTTPS_PROXY, undefined);
    console.log('ready');
  `);
  assert.deepEqual(await prepareKicadRuntime(launcher, cwd, { env: { CRAFT_HTTPS_PROXY: "http://localhost:5678" } }), { UV_OFFLINE: "1", UV_PYTHON_INSTALL_DIR: join(userInfo().homedir, ".cache", "zcode-plugins", "uv-python") });
});

test("an explicit lowercase HTTPS proxy wins over CI build egress", async (t) => {
  const [launcher, cwd] = await fixture(t, `
    import assert from 'node:assert/strict';
    assert.equal(process.env.https_proxy, 'http://localhost:1234');
    assert.equal(process.env.HTTPS_PROXY, undefined);
    console.log('ready');
  `);
  await prepareKicadRuntime(launcher, cwd, { env: { https_proxy: "http://localhost:1234", CRAFT_HTTPS_PROXY: "http://localhost:5678" } });
});


test("fresh isolated homes reuse one managed Python directory", async (t) => {
  const script = `
    import assert from 'node:assert/strict';
    assert.notEqual(process.env.UV_PYTHON_INSTALL_DIR, process.env.HOME);
    assert.ok(!process.env.UV_PYTHON_INSTALL_DIR.startsWith(process.env.HOME + '/'));
    console.log('ready');
  `;
  const first = await fixture(t, script);
  const second = await fixture(t, script);
  const firstEnv = await prepareKicadRuntime(...first);
  const secondEnv = await prepareKicadRuntime(...second);
  assert.equal(firstEnv.UV_PYTHON_INSTALL_DIR, secondEnv.UV_PYTHON_INSTALL_DIR);
});

test("an explicit managed Python directory is used for preparation and handshake", async (t) => {
  const [launcher, cwd] = await fixture(t, `
    import assert from 'node:assert/strict';
    assert.equal(process.env.UV_PYTHON_INSTALL_DIR, '/configured/python-cache');
    const { realpathSync } = await import('node:fs');
    assert.equal(realpathSync(process.env.HOME), process.cwd());
    console.log('ready');
  `);
  const env = await prepareKicadRuntime(launcher, cwd, { env: { UV_PYTHON_INSTALL_DIR: '/configured/python-cache' } });
  assert.equal(env.UV_PYTHON_INSTALL_DIR, '/configured/python-cache');
  assert.equal(env.UV_OFFLINE, '1');
});
