import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { activate, deactivate } from "../dist/extension.mjs";

const noSubscription = () => ({ dispose() {} });

const appHost = {
  slots: { update() {} },
  commands: { register: noSubscription },
  views: { register: noSubscription },
  workbench: { onDidChange: noSubscription },
  env: { onDidChange: noSubscription },
};

test("records final metrics and serves a session-specific inline snapshot over MCP", async (t) => {
  const dataPath = await mkdtemp(join(tmpdir(), "token-stats-test-"));
  t.after(() => rm(dataPath, { recursive: true, force: true }));

  let generate;
  let contextChanged;
  let snapshot;
  const subscribe = (setter) => (callback) => {
    setter(callback);
    return { dispose: () => setter(undefined) };
  };
  const warnings = [];
  const host = {
    ...appHost,
    extension: { dataPath },
    models: {
      onDidGenerate: subscribe((callback) => {
        generate = callback;
      }),
    },
    context: {
      onDidChange: subscribe((callback) => {
        contextChanged = callback;
      }),
      get: async () => snapshot,
    },
    log: { warn: (message) => warnings.push(message) },
  };

  const usage = (sessionId, requestId, outputTokens, extra = {}) => ({
    sessionId,
    requestId,
    phase: "final",
    model: { modelId: "test-model" },
    outputTokens,
    outputTokensPerSecond: 42.5,
    timeToFirstTokenMs: 150,
    ...extra,
  });
  activate(host);
  generate(usage("first", "stream", 999, { phase: "streaming" }));
  generate(usage("other", "separate", 9000));
  for (let i = 1; i <= 22; i += 1) generate(usage("first", String(i), i));
  generate(usage("first", "22", 222));
  snapshot = {
    sessionId: "first",
    phase: "request",
    measuredAt: 17,
    revision: 2,
    model: { modelId: "context-model" },
    providerInputTokens: 0,
  };
  contextChanged({ sessionId: "first" });
  snapshot = { ...snapshot, revision: 3, providerInputTokens: 17 };
  contextChanged({ sessionId: "first" });
  snapshot = { ...snapshot, revision: 2, providerInputTokens: 500 };
  contextChanged({ sessionId: "first" });
  snapshot = { ...snapshot, phase: "draft-preview", revision: 4, providerInputTokens: 600 };
  contextChanged({ sessionId: "first" });
  snapshot = { ...snapshot, sessionId: "other", phase: "request", providerInputTokens: 0 };
  contextChanged({ sessionId: "other" });
  await deactivate();
  assert.equal(generate, undefined);
  assert.equal(contextChanged, undefined);

  activate(host);
  generate(usage("first", "23", 23));
  await deactivate();
  assert.deepEqual(warnings, []);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/server.mjs", import.meta.url))],
    env: { ZCODE_PLUGIN_DATA: dataPath },
    stderr: "pipe",
  });
  const client = new Client({ name: "token-stats-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const {
      tools: [tool],
    } = await client.listTools();
    assert.equal(tool.name, "show_token_stats");
    assert.equal(tool._meta.ui.showInline, true);
    const resource = await client.readResource({ uri: tool._meta.ui.resourceUri });
    assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
    assert.match(resource.contents[0].text, /<section aria-labelledby="title"/);
    assert.doesNotMatch(resource.contents[0].text, /<script[^>]+src=/);

    const call = (sessionId, args = {}) =>
      client.callTool({
        name: tool.name,
        arguments: args,
        _meta: { session_id: sessionId },
      });
    const first = await call("first");
    assert.deepEqual(first.structuredContent, {
      latest: {
        modelId: "test-model",
        outputTokens: 23,
        outputTokensPerSecond: 42.5,
        timeToFirstTokenMs: 150,
      },
      contextInput: { modelId: "context-model", inputTokens: 17 },
      observedRequests: 20,
      observedOutputTokens: 270,
    });
    const other = (await call("other")).structuredContent;
    assert.equal(other.latest.outputTokens, 9000);
    assert.equal(other.contextInput.inputTokens, 0);
    assert.equal((await call("missing")).structuredContent.observedOutputTokens, null);
    assert.equal((await call("first", { sessionId: "other" })).isError, true);
    assert.equal((await client.callTool({ name: tool.name, arguments: {} })).isError, true);
  } finally {
    await client.close();
  }
});

test("keeps the composer status visible and scoped during streaming, completion and reload", async (t) => {
  const dataPath = await mkdtemp(join(tmpdir(), "token-stats-composer-"));
  t.after(() => rm(dataPath, { recursive: true, force: true }));
  const updates = new Map();
  let generate, showSessions, setLocale, execute, viewDefinition, contextChanged;
  const openScopes = [];
  const host = {
    ...appHost,
    extension: { dataPath },
    slots: {
      update: (id, patch, scope) => updates.set(scope?.sessionId ?? "app", { id, ...patch }),
    },
    commands: {
      register(id, run) {
        assert.equal(id, "open-stats");
        execute = run;
        return noSubscription();
      },
    },
    views: {
      register(id, definition) {
        assert.equal(id, "details");
        viewDefinition = definition;
        return noSubscription();
      },
      async open(id, scope) {
        openScopes.push({ id, scope });
      },
    },
    workbench: { onDidChange: (listener) => ((showSessions = listener), noSubscription()) },
    env: { onDidChange: (listener) => ((setLocale = listener), noSubscription()) },
    models: { onDidGenerate: (listener) => ((generate = listener), noSubscription()) },
    context: {
      onDidChange: (listener) => ((contextChanged = listener), noSubscription()),
      async get({ sessionId }) {
        return {
          sessionId,
          phase: "request",
          model: { modelId: "m" },
          providerInputTokens: 27342,
          measuredAt: 1,
          revision: 1,
        };
      },
    },
    log: { warn: (message) => assert.fail(message) },
  };
  const report = (...sessions) =>
    showSessions({ sessions: sessions.map((sessionId) => ({ sessionId })) });
  const emit = (sessionId, requestId, phase, outputTokensPerSecond, outputTokens, extra = {}) =>
    generate({
      sessionId,
      requestId,
      phase,
      model: { modelId: "m" },
      outputTokensPerSecond,
      outputTokens,
      ...extra,
    });
  const flags = (sessionId) => updates.get(sessionId ?? "app");
  const details = (sessionId) => viewDefinition.tools.snapshot.run({}, { view: { sessionId } });

  activate(host);
  assert.equal(flags().text, "— tok/s · — tok");
  assert.equal(flags().tooltip, "Token statistics\nNo measured data");
  report("first");
  emit("first", "one", "streaming", 14.5);
  assert.equal(flags("first").text, "14.5 tok/s · — tok");
  emit("first", "one", "streaming", 17.5);
  assert.equal(flags("first").text, "17.5 tok/s · — tok");
  assert.match(flags("first").tooltip, /^Token statistics\nEstimated speed 17.5 tok\/s/);
  emit("first", "one", "final", 18.5, 100);
  emit("first", "two", "streaming", 36);
  await details("first");
  assert.equal(flags("first").text, "36 tok/s · 100 tok");
  emit("first", "two", "final", 38, 40, {
    model: { modelId: "context-window-model" },
    timeToFirstTokenMs: 430,
  });
  contextChanged({ sessionId: "first" });
  assert.equal((await details("first")).observedOutputTokens, 140);
  assert.equal(flags("first").text, "38 tok/s · 140 tok");
  setLocale({ locale: "zh-CN" });
  await deactivate(); // 等待上下文读及其引起的写入收口。
  assert.equal(
    flags("first").tooltip,
    [
      "Token 统计",
      "实测模型 context-window-model",
      "实测速度 38 tok/s",
      "最近输出 40 tok",
      "首 Token 用时 0.43 s",
      "输出合计 140 tok（2 次）",
      "最近上下文输入 27,342 tok",
    ].join("\n"),
  );
  activate(host);
  report("first");
  await details("first");
  emit("second", "long-model", "final", 16.1, Number.MAX_SAFE_INTEGER, {
    model: { modelId: "a".repeat(500) },
    timeToFirstTokenMs: 900,
  });
  await execute({ scope: { kind: "session", sessionId: "first" } });
  assert.deepEqual(openScopes, [{ id: "details", scope: { sessionId: "first" } }]);

  report("second");
  assert.equal(flags("first").text, null);
  await details("second");
  assert.match(flags("second").text, /^16\.1 tok\/s · /);
  assert.ok(flags("second").tooltip.length <= 200);
  const secondRows = flags("second").tooltip.split("\n");
  assert.match(secondRows[1], /^Measured model a+…$/);
  assert.match(secondRows[2], /^Measured speed/);
  assert.equal(secondRows.at(-1), "Context input —");
  report("first");
  await details("first");
  assert.equal(flags("first").text, "38 tok/s · 140 tok");
  await deactivate();

  activate(host);
  assert.equal(flags().text, "— tok/s · — tok");
  report("first");
  await details("first");
  assert.equal(flags("first").text, "38 tok/s · 140 tok");
  await deactivate();
});
