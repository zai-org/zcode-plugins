import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/version.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
var SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
function productVersion(moduleUrl = import.meta.url) {
  const manifestPath = fileURLToPath(new URL("../../.zcode-plugin/plugin.json", moduleUrl));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) {
    throw new Error(`Cycle for Zcode manifest has an invalid version: ${manifestPath}`);
  }
  return manifest.version;
}

// src/client.ts
import { createHash, createHmac, randomUUID } from "node:crypto";
import { constants, createReadStream, existsSync } from "node:fs";
import { access, chmod, copyFile, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { join, posix, resolve, win32 } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createRequire as createRequire2 } from "node:module";
var AUTH_DOMAIN = Buffer.from("zcode-cycle-ipc-auth-v1");
var MAX_FRAME_BYTES = 8 * 1024 * 1024;
var CANDIDATE_OPERATION_TIMEOUT_MILLIS = 30 * 60000;
var VERIFICATION_RESPONSE_TIMEOUT_MILLIS = 30 * 60000;
var IPC_TIMEOUTS = Object.freeze({
  candidateOperation: CANDIDATE_OPERATION_TIMEOUT_MILLIS,
  verificationResponse: VERIFICATION_RESPONSE_TIMEOUT_MILLIS,
  healthWait: 15000,
  default: 1e4
});
var HEALTH_WAIT_MS = 15000;
var MAX_NATIVE_BINARY_BYTES = 256 * 1024 * 1024;
var MAX_NATIVE_MANIFEST_BYTES = 64 * 1024;
var require2 = createRequire2(import.meta.url);

class ControlPlaneError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ControlPlaneError";
  }
}

class NewerDaemonError extends ControlPlaneError {
}
function compareVersions(left, right) {
  const parts = (value) => value.split("-")[0].split(".").map((part) => Number(part) || 0);
  const [a, b] = [parts(left), parts(right)];
  for (let index = 0;index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0)
      return difference;
  }
  return 0;
}
function daemonsServing(dataDirectory, platform = process.platform) {
  const wanted = platform === "win32" ? win32.resolve(dataDirectory).toLowerCase() : posix.resolve(dataDirectory);
  const lines = platform === "win32" ? spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Get-CimInstance Win32_Process -Filter "Name='workflowd.exe'" | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }`
  ], { encoding: "utf8", shell: false, windowsHide: true }).stdout : spawnSync("ps", ["-axo", "pid=,args="], { encoding: "utf8", shell: false }).stdout;
  const pids = [];
  for (const line of (lines ?? "").split(/\r?\n/u)) {
    const match = platform === "win32" ? /^(\d+)\t(.*)$/u.exec(line) : /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (!match)
      continue;
    const commandLine = match[2];
    if (platform !== "win32" && !/(^|\/)workflowd\s/u.test(commandLine))
      continue;
    const marker = commandLine.lastIndexOf("--data-dir ");
    if (marker < 0)
      continue;
    let served = commandLine.slice(marker + "--data-dir ".length).trim();
    if (served.startsWith('"') && served.endsWith('"'))
      served = served.slice(1, -1);
    const normalized = platform === "win32" ? win32.resolve(served).toLowerCase() : posix.resolve(served);
    const pid = Number(match[1]);
    if (normalized === wanted && pid !== process.pid)
      pids.push(pid);
  }
  return pids;
}
function stopDaemonsServing(dataDirectory, platform = process.platform) {
  const pids = daemonsServing(dataDirectory, platform);
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {}
  }
  return pids.length;
}

class LocalControlPlane {
  #architecture;
  #binaryPath;
  #dataDirectory;
  #endpoint;
  #environment;
  #expectedProductVersion;
  #expectedProtocolVersion;
  #platform;
  #secretPath;
  #stopOwnedProcessOnDispose;
  #ownedProcess;
  constructor(options = {}) {
    const platform = options.platform ?? process.platform;
    const environment = options.environment ?? process.env;
    this.#platform = platform;
    this.#architecture = process.arch;
    this.#environment = environment;
    this.#dataDirectory = options.dataDirectory ?? resolveDataDirectory(platform, environment);
    this.#binaryPath = options.binaryPath;
    this.#secretPath = join(this.#dataDirectory, "runtime", "ipc.secret");
    this.#endpoint = platform === "win32" ? "" : join(this.#dataDirectory, "runtime", "workflow.sock");
    this.#expectedProductVersion = options.expectedProductVersion ?? productVersion();
    this.#expectedProtocolVersion = options.expectedProtocolVersion ?? 1;
    this.#stopOwnedProcessOnDispose = options.stopOwnedProcessOnDispose ?? false;
  }
  get dataDirectory() {
    return this.#dataDirectory;
  }
  async health() {
    const existing = await readSecret(this.#secretPath);
    let lastError;
    if (existing !== undefined) {
      try {
        return await this.#query(existing);
      } catch (error) {
        if (error instanceof ControlPlaneError && error.message.includes("protocol"))
          throw error;
        if (error instanceof NewerDaemonError)
          throw error;
        lastError = error;
        await this.#reclaimStaleDaemon();
      }
    }
    return this.#spawnAndWait(lastError);
  }
  async#spawnAndWait(previousError) {
    let lastError = previousError;
    if (this.#ownedProcess === undefined || this.#ownedProcess.exitCode !== null || this.#ownedProcess.signalCode !== null) {
      const binaryPath = this.#binaryPath ?? await prepareNativeBinary({
        architecture: this.#architecture,
        dataDirectory: this.#dataDirectory,
        environment: this.#environment,
        platform: this.#platform
      });
      await access(binaryPath, constants.X_OK).catch((cause) => {
        throw new ControlPlaneError(`workflowd binary is unavailable: ${binaryPath}`, { cause });
      });
      this.#ownedProcess = spawn(binaryPath, ["--data-dir", this.#dataDirectory], {
        detached: !this.#stopOwnedProcessOnDispose,
        shell: false,
        stdio: "ignore",
        windowsHide: true
      });
      this.#ownedProcess.unref();
    }
    const deadline = Date.now() + HEALTH_WAIT_MS;
    while (Date.now() < deadline) {
      const secret = await readSecret(this.#secretPath);
      if (secret !== undefined) {
        try {
          return await this.#query(secret);
        } catch (error) {
          if (error instanceof ControlPlaneError && error.message.includes("incompatible"))
            throw error;
          lastError = error;
        }
      }
      await new Promise((resolve2) => setTimeout(resolve2, 25));
    }
    throw new ControlPlaneError("workflowd did not become healthy within 15 seconds", {
      cause: lastError
    });
  }
  async#reclaimStaleDaemon() {
    const child = this.#ownedProcess;
    this.#ownedProcess = undefined;
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    stopDaemonsServing(this.#dataDirectory, this.#platform);
    const deadline = Date.now() + 5000;
    while (daemonsServing(this.#dataDirectory, this.#platform).length > 0 && Date.now() < deadline) {
      await new Promise((resolve2) => setTimeout(resolve2, 50));
    }
  }
  async dispose() {
    if (this.#stopOwnedProcessOnDispose && this.#ownedProcess !== undefined) {
      const process2 = this.#ownedProcess;
      if (process2.exitCode === null && process2.signalCode === null) {
        const exited = once(process2, "exit");
        process2.kill();
        await Promise.race([exited, new Promise((resolve2) => setTimeout(resolve2, 2000))]);
      }
    }
    this.#ownedProcess = undefined;
  }
  async audit(observation) {
    await this.health();
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: { observation, request_id: 2 },
        type: "audit"
      }));
      const message = asRecord(await readJson(socket, decoder));
      if (message.type === "error") {
        const data2 = asRecord(message.data);
        throw new ControlPlaneError(typeof data2.message === "string" ? data2.message : "workflowd rejected the audit event");
      }
      if (message.type !== "audit_recorded") {
        throw new ControlPlaneError("workflowd returned an unexpected audit response");
      }
      const data = asRecord(message.data);
      if (data.request_id !== 2 || !Number.isSafeInteger(data.sequence) || typeof data.entry_hash !== "string" || !/^[0-9a-f]{64}$/u.test(data.entry_hash)) {
        throw new ControlPlaneError("workflowd returned a malformed audit receipt");
      }
      return { entryHash: data.entry_hash, sequence: data.sequence };
    } finally {
      socket.destroy();
    }
  }
  async history(projectKey, operation) {
    await this.health();
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: { operation, project_key: projectKey, request_id: 3 },
        type: "history"
      }));
      const message = asRecord(await readJson(socket, decoder));
      if (message.type === "error") {
        const data2 = asRecord(message.data);
        throw new ControlPlaneError(typeof data2.message === "string" ? data2.message : "workflowd rejected the history request");
      }
      if (message.type !== "history") {
        throw new ControlPlaneError("workflowd returned an unexpected history response");
      }
      const data = asRecord(message.data);
      if (data.request_id !== 3 || !("result" in data)) {
        throw new ControlPlaneError("workflowd returned a malformed history response");
      }
      return data.result;
    } finally {
      socket.destroy();
    }
  }
  async goal(projectKey, operation) {
    await this.health();
    if (!projectKey)
      throw new ControlPlaneError("goal operation requires a project key");
    const data = await this.#exchange(16, "goal", "goal", {
      operation,
      project_key: projectKey
    });
    if (!("result" in data)) {
      throw new ControlPlaneError("workflowd returned a malformed goal response");
    }
    return data.result;
  }
  async control(projectKey, operation, workflowId) {
    await this.health();
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: {
          operation,
          operation_id: randomUUID(),
          project_key: projectKey,
          request_id: 12,
          workflow_id: workflowId ?? null
        },
        type: "control"
      }));
      const message = asRecord(await readJson(socket, decoder));
      if (message.type === "error") {
        const data2 = asRecord(message.data);
        throw new ControlPlaneError(typeof data2.message === "string" ? data2.message : "workflowd rejected the control request");
      }
      if (message.type !== "control") {
        throw new ControlPlaneError("workflowd returned an unexpected control response");
      }
      const data = asRecord(message.data);
      if (data.request_id !== 12 || !("result" in data)) {
        throw new ControlPlaneError("workflowd returned a malformed control response");
      }
      return data.result;
    } finally {
      socket.destroy();
    }
  }
  async admission(projectKey, workflowId, workspace, operation) {
    await this.health();
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: {
          operation,
          project_key: projectKey,
          request_id: 13,
          workflow_id: workflowId,
          workspace
        },
        type: "admission"
      }));
      const message = asRecord(await readJson(socket, decoder));
      if (message.type === "error") {
        const data2 = asRecord(message.data);
        throw new ControlPlaneError(typeof data2.message === "string" ? data2.message : "workflowd rejected the admission request");
      }
      if (message.type !== "admission") {
        throw new ControlPlaneError("workflowd returned an unexpected admission response");
      }
      const data = asRecord(message.data);
      const result = asRecord(data.result);
      if (data.request_id !== 13 || typeof result.admitted !== "boolean" || !Number.isSafeInteger(result.active) || !Number.isSafeInteger(result.maximumActive) || !Number.isSafeInteger(result.retryAfterMillis) || result.leaseExpiresUnixMillis !== null && !Number.isSafeInteger(result.leaseExpiresUnixMillis) || result.reason !== null && typeof result.reason !== "string") {
        throw new ControlPlaneError("workflowd returned a malformed admission response");
      }
      return result;
    } finally {
      socket.destroy();
    }
  }
  async codeIndex(projectKey, workflowId, projectDirectory) {
    await this.health();
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: {
          project_directory: projectDirectory,
          project_key: projectKey,
          request_id: 14,
          workflow_id: workflowId
        },
        type: "code_index"
      }));
      const message = asRecord(await readJson(socket, decoder, 30 * 60000));
      if (message.type === "error") {
        const data2 = asRecord(message.data);
        throw new ControlPlaneError(typeof data2.message === "string" ? data2.message : "workflowd rejected the code index");
      }
      if (message.type !== "code_index") {
        throw new ControlPlaneError("workflowd returned an unexpected code index response");
      }
      const data = asRecord(message.data);
      const result = asRecord(data.result);
      const context = asRecord(result.context);
      if (data.request_id !== 14 || !Array.isArray(context.nodes) || !Array.isArray(context.paths) || context.paths.some((path) => typeof path !== "string") || !Array.isArray(context.scopes) || context.scopes.some((scope) => typeof scope !== "string") || typeof context.truncated !== "boolean" || typeof result.index !== "object" || result.index === null) {
        throw new ControlPlaneError("workflowd returned a malformed code index response");
      }
      return result;
    } finally {
      socket.destroy();
    }
  }
  async promoteCandidate(projectKey, workflowId, candidateId, projectDirectory) {
    await this.health();
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: {
          candidate_id: candidateId,
          project_directory: projectDirectory,
          project_key: projectKey,
          request_id: 15,
          workflow_id: workflowId
        },
        type: "promote_candidate"
      }));
      const message = asRecord(await readJson(socket, decoder, CANDIDATE_OPERATION_TIMEOUT_MILLIS));
      if (message.type === "error") {
        const data2 = asRecord(message.data);
        throw new ControlPlaneError(typeof data2.message === "string" ? data2.message : "workflowd rejected candidate delivery");
      }
      if (message.type !== "candidate_promoted") {
        throw new ControlPlaneError("workflowd returned an unexpected candidate delivery response");
      }
      const data = asRecord(message.data);
      if (data.request_id !== 15 || data.workflow_id !== workflowId || !Array.isArray(data.changed_paths) || data.changed_paths.some((path) => typeof path !== "string") || typeof data.workflow_state !== "string") {
        throw new ControlPlaneError("workflowd returned a malformed candidate delivery response");
      }
      return {
        changedPaths: data.changed_paths,
        workflowState: data.workflow_state
      };
    } finally {
      socket.destroy();
    }
  }
  async memory(projectKey, operation) {
    await this.health();
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: { operation, project_key: projectKey, request_id: 4 },
        type: "memory"
      }));
      const message = asRecord(await readJson(socket, decoder));
      if (message.type === "error") {
        const data2 = asRecord(message.data);
        throw new ControlPlaneError(typeof data2.message === "string" ? data2.message : "workflowd rejected the memory request");
      }
      if (message.type !== "memory") {
        throw new ControlPlaneError("workflowd returned an unexpected memory response");
      }
      const data = asRecord(message.data);
      if (data.request_id !== 4 || !("result" in data)) {
        throw new ControlPlaneError("workflowd returned a malformed memory response");
      }
      return data.result;
    } finally {
      socket.destroy();
    }
  }
  async startWorkflow(request) {
    await this.health();
    if (!request.originalRequest || !request.projectKey) {
      throw new ControlPlaneError("workflow start requires an original request and project key");
    }
    const attachmentHashes = [...request.attachmentHashes ?? []];
    if (attachmentHashes.some((hash) => !/^[0-9a-f]{64}$/u.test(hash))) {
      throw new ControlPlaneError("workflow attachment digest is invalid");
    }
    const workflowId = request.workflowId ?? randomUUID();
    const envelope = {
      payload: {
        data: {
          amendments: [],
          attachment_hashes: attachmentHashes,
          original_text: request.originalRequest
        },
        type: "request"
      },
      version: 1
    };
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: {
          affected_paths: [...request.affectedPaths ?? []],
          critical_downgrade_approval: request.criticalDowngradeApproval ?? null,
          envelope,
          project_key: request.projectKey,
          request_id: 5,
          routing_preference: request.preference ?? "auto",
          workflow_id: workflowId
        },
        type: "request"
      }));
      const message = asRecord(await readJson(socket, decoder));
      if (message.type !== "response") {
        throw new ControlPlaneError("workflowd returned an unexpected workflow response");
      }
      const data = asRecord(message.data);
      if (data.status === "rejected") {
        throw new ControlPlaneError(typeof data.message === "string" ? data.message : "workflowd rejected the workflow");
      }
      if (data.status !== "accepted" || data.request_id !== 5 || data.workflow_id !== workflowId || typeof data.request_digest !== "string" || !/^[0-9a-f]{64}$/u.test(data.request_digest) || data.mode !== "quick" && data.mode !== "full") {
        throw new ControlPlaneError("workflowd returned a malformed workflow receipt");
      }
      return {
        mode: data.mode,
        requestDigest: data.request_digest,
        workflowId
      };
    } finally {
      socket.destroy();
    }
  }
  async submitArchitecture(projectKey, workflowId, plan) {
    await this.health();
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: {
          affected_paths: [],
          critical_downgrade_approval: null,
          envelope: { payload: { data: plan, type: "architecture" }, version: 1 },
          project_key: projectKey,
          request_id: 6,
          routing_preference: "auto",
          workflow_id: workflowId
        },
        type: "request"
      }));
      const message = asRecord(await readJson(socket, decoder));
      if (message.type !== "response") {
        throw new ControlPlaneError("workflowd returned an unexpected architecture response");
      }
      const data = asRecord(message.data);
      if (data.status === "rejected") {
        throw new ControlPlaneError(typeof data.message === "string" ? data.message : "workflowd rejected the architecture");
      }
      if (data.status !== "accepted" || data.request_id !== 6 || data.workflow_id !== workflowId || data.request_digest !== plan.request_digest || data.mode !== "full" && data.mode !== "quick") {
        throw new ControlPlaneError("workflowd returned a malformed architecture receipt");
      }
    } finally {
      socket.destroy();
    }
  }
  async prepareWorktree(projectKey, projectDirectory, workflowId) {
    await this.health();
    if (!projectKey || !projectDirectory || !workflowId) {
      throw new ControlPlaneError("worktree preparation requires project and workflow identity");
    }
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: {
          project_directory: projectDirectory,
          project_key: projectKey,
          request_id: 7,
          workflow_id: workflowId
        },
        type: "worktree"
      }));
      const message = asRecord(await readJson(socket, decoder, CANDIDATE_OPERATION_TIMEOUT_MILLIS));
      if (message.type === "error") {
        const data2 = asRecord(message.data);
        throw new ControlPlaneError(typeof data2.message === "string" ? data2.message : "workflowd rejected the worktree");
      }
      if (message.type !== "worktree") {
        throw new ControlPlaneError("workflowd returned an unexpected worktree response");
      }
      const data = asRecord(message.data);
      if (data.request_id !== 7 || data.workflow_id !== workflowId || typeof data.path !== "string" || !data.path || typeof data.base_revision !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(data.base_revision)) {
        throw new ControlPlaneError("workflowd returned a malformed worktree response");
      }
      return { baseRevision: data.base_revision, path: data.path };
    } finally {
      socket.destroy();
    }
  }
  async freezeCandidate(projectKey, workflowId, baseRevision, planId, evidenceIds, candidateId = randomUUID()) {
    await this.health();
    if (!projectKey || !workflowId || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseRevision)) {
      throw new ControlPlaneError("candidate freeze identity is invalid");
    }
    if (evidenceIds.some((id) => !UUID.test(id)) || !UUID.test(candidateId) || !UUID.test(planId)) {
      throw new ControlPlaneError("candidate or evidence identifier is invalid");
    }
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({
        data: {
          base_revision: baseRevision,
          candidate_id: candidateId,
          evidence_ids: [...evidenceIds],
          plan_id: planId,
          project_key: projectKey,
          request_id: 8,
          workflow_id: workflowId
        },
        type: "freeze_candidate"
      }));
      const message = asRecord(await readJson(socket, decoder, CANDIDATE_OPERATION_TIMEOUT_MILLIS));
      if (message.type === "error") {
        const data2 = asRecord(message.data);
        throw new ControlPlaneError(typeof data2.message === "string" ? data2.message : "workflowd rejected the candidate");
      }
      if (message.type !== "candidate_frozen") {
        throw new ControlPlaneError("workflowd returned an unexpected candidate response");
      }
      const data = asRecord(message.data);
      if (data.request_id !== 8 || data.workflow_id !== workflowId || data.candidate_id !== candidateId || typeof data.candidate_digest !== "string" || !SHA256.test(data.candidate_digest)) {
        throw new ControlPlaneError("workflowd returned a malformed candidate receipt");
      }
      const manifest = parseCandidateManifest(data.manifest);
      if (manifest.candidate_id !== candidateId) {
        throw new ControlPlaneError("workflowd candidate manifest identity mismatch");
      }
      return {
        candidateDigest: data.candidate_digest,
        candidateId,
        manifest
      };
    } finally {
      socket.destroy();
    }
  }
  async planVerification(projectKey, workflowId, planId = randomUUID()) {
    await this.health();
    if (!projectKey || !UUID.test(workflowId) || !UUID.test(planId)) {
      throw new ControlPlaneError("verification plan identity is invalid");
    }
    const data = await this.#exchange(9, "plan_verification", "verification_planned", {
      plan_id: planId,
      project_key: projectKey,
      workflow_id: workflowId
    });
    if (data.plan_id !== planId || data.workflow_id !== workflowId || !Array.isArray(data.evidence_ids) || data.evidence_ids.some((id) => typeof id !== "string" || !UUID.test(id))) {
      throw new ControlPlaneError("workflowd returned a malformed verification plan");
    }
    return { evidenceIds: data.evidence_ids, planId };
  }
  async verifyCandidate(projectKey, workflowId, candidateId, planId, attestations = []) {
    await this.health();
    if (![workflowId, candidateId, planId].every((id) => UUID.test(id)) || !projectKey) {
      throw new ControlPlaneError("verification identity is invalid");
    }
    if (attestations.length > 32 || attestations.some((attestation) => !SHA256.test(attestation.candidate_digest) || !SHA256.test(attestation.receipt_digest) || !attestation.receipt_json || Buffer.byteLength(attestation.receipt_json) > 2 * 1024 * 1024 || !attestation.session_id || attestation.session_id.length > 256)) {
      throw new ControlPlaneError("managed browser attestation is invalid");
    }
    const data = await this.#exchange(10, "verify_candidate", "verification_completed", {
      attestations,
      candidate_id: candidateId,
      plan_id: planId,
      project_key: projectKey,
      workflow_id: workflowId
    }, VERIFICATION_RESPONSE_TIMEOUT_MILLIS);
    if (data.candidate_id !== candidateId || data.workflow_id !== workflowId || typeof data.mandatory_passed !== "boolean" || typeof data.workflow_state !== "string" || !Array.isArray(data.evidence)) {
      throw new ControlPlaneError("workflowd returned a malformed verification receipt");
    }
    return {
      evidence: data.evidence.map((value) => {
        const evidence = asRecord(value);
        if (typeof evidence.output !== "string") {
          throw new ControlPlaneError("workflowd returned malformed evidence output");
        }
        return { output: evidence.output, record: parseEvidenceRecord(evidence.record) };
      }),
      mandatoryPassed: data.mandatory_passed,
      workflowState: data.workflow_state
    };
  }
  async submitReview(projectKey, workflowId, candidateId, verdict) {
    await this.health();
    if (![workflowId, candidateId].every((id) => UUID.test(id)) || !projectKey) {
      throw new ControlPlaneError("review identity is invalid");
    }
    const data = await this.#exchange(11, "submit_review", "review_recorded", {
      candidate_id: candidateId,
      project_key: projectKey,
      verdict,
      workflow_id: workflowId
    });
    if (data.candidate_id !== candidateId || data.workflow_id !== workflowId || typeof data.reviews_ready !== "boolean") {
      throw new ControlPlaneError("workflowd returned a malformed review receipt");
    }
    return { reviewsReady: data.reviews_ready };
  }
  async submitArbitration(projectKey, workflowId, candidateId, verdict) {
    await this.health();
    if (![workflowId, candidateId].every((id) => UUID.test(id)) || !projectKey) {
      throw new ControlPlaneError("arbitration identity is invalid");
    }
    const data = await this.#exchange(12, "submit_arbitration", "arbitration_recorded", {
      candidate_id: candidateId,
      project_key: projectKey,
      verdict,
      workflow_id: workflowId
    });
    if (data.decision !== "approved" && data.decision !== "rejected" || typeof data.receipt_digest !== "string" || !SHA256.test(data.receipt_digest) || typeof data.workflow_state !== "string" || data.workflow_id !== workflowId) {
      throw new ControlPlaneError("workflowd returned a malformed arbitration result");
    }
    const receipt = parseArbitrationReceipt(data.receipt);
    if (receipt.workflow_id !== workflowId || receipt.candidate_id !== candidateId) {
      throw new ControlPlaneError("workflowd arbitration receipt identity mismatch");
    }
    return {
      decision: data.decision,
      receipt,
      receiptDigest: data.receipt_digest,
      workflowState: data.workflow_state
    };
  }
  async reportExecution(projectKey, workflowId, outcome) {
    await this.health();
    if (!projectKey || !UUID.test(workflowId)) {
      throw new ControlPlaneError("execution report identity is invalid");
    }
    const data = await this.#exchange(13, "report_execution", "execution_reported", {
      outcome,
      project_key: projectKey,
      report_id: randomUUID(),
      workflow_id: workflowId
    });
    if (data.workflow_id !== workflowId || typeof data.workflow_state !== "string") {
      throw new ControlPlaneError("workflowd returned a malformed execution report");
    }
    return data.workflow_state;
  }
  async#query(secret) {
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({ data: { request_id: 1 }, type: "health" }));
      const healthMessage = asRecord(await readJson(socket, decoder));
      if (healthMessage.type !== "health") {
        throw new ControlPlaneError("workflowd returned an unexpected health response");
      }
      const data = asRecord(healthMessage.data);
      if (data.request_id !== 1)
        throw new ControlPlaneError("workflowd health response ID mismatch");
      const report = parseHealth(data.report);
      if (report.protocol_version !== this.#expectedProtocolVersion) {
        throw new ControlPlaneError(`workflowd protocol ${report.protocol_version} is incompatible with plugin protocol ${this.#expectedProtocolVersion}`);
      }
      if (report.product_version !== this.#expectedProductVersion) {
        if (compareVersions(report.product_version, this.#expectedProductVersion) > 0) {
          throw new NewerDaemonError(`workflowd ${report.product_version} is running for this data directory and is newer than this plugin (${this.#expectedProductVersion}); update the plugin rather than stopping it`);
        }
        throw new ControlPlaneError(`workflowd ${report.product_version} is incompatible with plugin ${this.#expectedProductVersion}`);
      }
      return report;
    } finally {
      socket.destroy();
    }
  }
  async#exchange(requestId, requestType, responseType, data, timeoutMillis = 1e4) {
    const secret = await readSecret(this.#secretPath);
    if (secret === undefined)
      throw new ControlPlaneError("workflowd credential disappeared");
    const { decoder, socket } = await this.#connect(secret);
    try {
      socket.write(encodeFrame({ data: { ...data, request_id: requestId }, type: requestType }));
      const message = asRecord(await readJson(socket, decoder, timeoutMillis));
      if (message.type === "error") {
        const error = asRecord(message.data);
        throw new ControlPlaneError(typeof error.message === "string" ? error.message : "workflowd rejected the request");
      }
      if (message.type !== responseType) {
        throw new ControlPlaneError("workflowd returned an unexpected response");
      }
      const response = asRecord(message.data);
      if (response.request_id !== requestId) {
        throw new ControlPlaneError("workflowd response ID mismatch");
      }
      return response;
    } finally {
      socket.destroy();
    }
  }
  async#connect(secret) {
    const endpoint = this.#endpoint || namedPipePath(endpointId(secret));
    const socket = await connectSocket(endpoint);
    const decoder = new FrameDecoder;
    try {
      const challengeMessage = asRecord(await readJson(socket, decoder));
      if (challengeMessage.type !== "challenge") {
        throw new ControlPlaneError("workflowd did not send an authentication challenge");
      }
      const challenge = parseChallenge(challengeMessage.data);
      socket.write(encodeFrame({
        data: { mac: calculateMac(secret, challenge), nonce: challenge.nonce },
        type: "authenticate"
      }));
      return { decoder, socket };
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }
}
function resolveDataDirectory(platform, environment) {
  const combine = platform === "win32" ? win32.join : posix.join;
  if (platform === "win32") {
    return combine(requiredEnvironment(environment, "LOCALAPPDATA"), "ZCode Cycle");
  }
  if (platform === "darwin") {
    return combine(requiredEnvironment(environment, "HOME"), "Library", "Application Support", "ZCode Cycle");
  }
  const base = environment.XDG_DATA_HOME || combine(requiredEnvironment(environment, "HOME"), ".local", "share");
  return combine(base, "zcode-cycle");
}
function requiredEnvironment(environment, name) {
  const value = environment[name];
  if (!value)
    throw new ControlPlaneError(`required environment variable ${name} is missing`);
  return value;
}
function nativePackageName(platform, architecture) {
  const target = `${platform}-${architecture}`;
  if (!["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"].includes(target)) {
    throw new ControlPlaneError(`unsupported native platform ${target}; supported targets are darwin-arm64, darwin-x64, linux-x64 and win32-x64`);
  }
  return `@zcode-cycle/native-${target}`;
}
async function prepareNativeBinary(options) {
  const source = packagedBinaryPath(options.platform, options.architecture, options.environment);
  const sourceInfo = await lstat(source).catch((cause) => {
    throw new ControlPlaneError(`workflowd binary is unavailable: ${source}`, { cause });
  });
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size <= 0 || sourceInfo.size > MAX_NATIVE_BINARY_BYTES) {
    throw new ControlPlaneError(`workflowd binary is not a regular file: ${source}`);
  }
  const sourceDigest = await fileDigest(source);
  await verifyNativeManifest(options, source, sourceDigest, sourceInfo.size);
  const executable = options.platform === "win32" ? "workflowd.exe" : "workflowd";
  const targetDirectory = join(options.dataDirectory, "runtime", "native", `${options.platform}-${options.architecture}`, sourceDigest);
  const target = join(targetDirectory, executable);
  await mkdir(targetDirectory, { mode: 448, recursive: true });
  const targetDirectoryInfo = await lstat(targetDirectory);
  if (!targetDirectoryInfo.isDirectory() || targetDirectoryInfo.isSymbolicLink()) {
    throw new ControlPlaneError(`workflowd runtime directory is unsafe: ${targetDirectory}`);
  }
  await chmod(targetDirectory, 448);
  try {
    const targetInfo = await lstat(target);
    if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) {
      throw new ControlPlaneError(`materialized workflowd is not a regular file: ${target}`);
    }
    const existingDigest = await fileDigest(target);
    if (existingDigest !== sourceDigest) {
      throw new ControlPlaneError(`materialized workflowd digest mismatch: ${target}`);
    }
    await chmod(target, 448);
    await access(target, constants.X_OK);
    return target;
  } catch (error) {
    if (error instanceof ControlPlaneError || asNodeError(error).code !== "ENOENT")
      throw error;
  }
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    await chmod(temporary, 448);
    const copiedDigest = await fileDigest(temporary);
    if (copiedDigest !== sourceDigest) {
      throw new ControlPlaneError("workflowd changed while it was materialized");
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => {
      return;
    });
  }
  if (await fileDigest(target) !== sourceDigest) {
    throw new ControlPlaneError(`materialized workflowd digest mismatch: ${target}`);
  }
  await access(target, constants.X_OK).catch((cause) => {
    throw new ControlPlaneError(`materialized workflowd is not executable: ${target}`, { cause });
  });
  return target;
}
async function verifyNativeManifest(options, source, sourceDigest, sourceSize) {
  const pluginRoot = options.environment.ZCODE_PLUGIN_ROOT || options.environment.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot)
    return;
  const manifestPath = join(pluginRoot, "bin", "native-manifest.json");
  const manifestInfo = await lstat(manifestPath).catch((cause) => {
    throw new ControlPlaneError(`native manifest is unavailable: ${manifestPath}`, { cause });
  });
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size <= 0 || manifestInfo.size > MAX_NATIVE_MANIFEST_BYTES) {
    throw new ControlPlaneError(`native manifest is not a regular bounded file: ${manifestPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (cause) {
    throw new ControlPlaneError(`native manifest is invalid: ${manifestPath}`, { cause });
  }
  let target;
  try {
    const targets = asRecord(manifest.targets);
    target = asRecord(targets[`${options.platform}-${options.architecture}`]);
  } catch (cause) {
    throw new ControlPlaneError(`native manifest has no valid target: ${manifestPath}`, { cause });
  }
  const declaredPath = typeof target.path === "string" ? resolve(pluginRoot, target.path) : "";
  if (manifest.schema_version !== 1 || manifest.product_version !== productVersion() || declaredPath !== resolve(source) || target.sha256 !== sourceDigest || target.size !== sourceSize) {
    throw new ControlPlaneError(`workflowd does not match its native manifest: ${source}`);
  }
}
function packagedBinaryPath(platform, architecture, environment) {
  const pluginRoot = environment.ZCODE_PLUGIN_ROOT || environment.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot !== undefined && pluginRoot !== "") {
    const executable = platform === "win32" ? "workflowd.exe" : "workflowd";
    const scoped = join(pluginRoot, "bin", `${platform}-${architecture}`, executable);
    if (existsSync(scoped))
      return scoped;
    const sidecar = join(pluginRoot, "bin", executable);
    if (existsSync(sidecar))
      return sidecar;
  }
  const packageName = nativePackageName(platform, architecture);
  try {
    return require2.resolve(packageName);
  } catch (cause) {
    throw new ControlPlaneError(`required native package ${packageName} is not installed; reinstall zcode-cycle for this platform`, { cause });
  }
}
async function fileDigest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk);
  return hash.digest("hex");
}
async function readSecret(path) {
  try {
    const secret = await readFile(path);
    if (secret.length !== 32)
      throw new ControlPlaneError("workflowd credential has an invalid length");
    return secret;
  } catch (error) {
    if (asNodeError(error).code === "ENOENT")
      return;
    throw error;
  }
}
function endpointId(secret) {
  return createHash("sha256").update(secret).digest("hex").slice(0, 32);
}
function namedPipePath(identifier) {
  return `\\\\.\\pipe\\zcode-cycle-${identifier}`;
}
function connectSocket(endpoint) {
  return new Promise((resolve2, reject) => {
    const socket = createConnection(endpoint);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new ControlPlaneError("local IPC connection timed out"));
    }, 1000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve2(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
function encodeFrame(value) {
  const payload = Buffer.from(JSON.stringify(value));
  if (payload.length === 0 || payload.length > MAX_FRAME_BYTES) {
    throw new ControlPlaneError("local IPC frame size is invalid");
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

class FrameDecoder {
  #buffer = Buffer.alloc(0);
  feed(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32BE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) {
        throw new ControlPlaneError("workflowd sent an invalid IPC frame size");
      }
      if (this.#buffer.length < 4 + length)
        break;
      const payload = this.#buffer.subarray(4, 4 + length);
      this.#buffer = this.#buffer.subarray(4 + length);
      messages.push(JSON.parse(payload.toString("utf8")));
    }
    if (this.#buffer.length > MAX_FRAME_BYTES + 4) {
      throw new ControlPlaneError("workflowd exceeded the IPC buffer limit");
    }
    return messages;
  }
}
function readJson(socket, decoder, timeoutMillis = 1e4) {
  return new Promise((resolve2, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onData = (chunk) => {
      try {
        const [message] = decoder.feed(chunk);
        if (message !== undefined) {
          cleanup();
          resolve2(message);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new ControlPlaneError("workflowd disconnected before responding"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new ControlPlaneError("workflowd response timed out"));
    }, timeoutMillis);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}
function parseChallenge(value) {
  const challenge = asRecord(value);
  if (!Number.isSafeInteger(challenge.expires_at_unix_millis) || !Array.isArray(challenge.nonce) || challenge.nonce.length !== 32 || challenge.nonce.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new ControlPlaneError("workflowd sent a malformed authentication challenge");
  }
  return {
    expires_at_unix_millis: challenge.expires_at_unix_millis,
    nonce: challenge.nonce
  };
}
function calculateMac(secret, challenge) {
  const expiry = Buffer.allocUnsafe(8);
  expiry.writeBigInt64BE(BigInt(challenge.expires_at_unix_millis));
  return Array.from(createHmac("sha256", secret).update(AUTH_DOMAIN).update(Buffer.from(challenge.nonce)).update(expiry).digest());
}
function parseHealth(value) {
  const report = asRecord(value);
  if (typeof report.product_version !== "string" || !Number.isInteger(report.protocol_version) || !Number.isInteger(report.schema_version) || report.schema_mode !== "read_write" && report.schema_mode !== "safe_read_only") {
    throw new ControlPlaneError("workflowd returned a malformed health report");
  }
  return report;
}
function asRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ControlPlaneError("workflowd returned a malformed message");
  }
  return value;
}
function asNodeError(value) {
  return value;
}
var SHA256 = /^[0-9a-f]{64}$/u;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function parseCandidateManifest(value) {
  const manifest = asRecord(value);
  const digestFields = [
    manifest.configuration_digest,
    manifest.dependency_state_digest,
    manifest.diff_digest,
    manifest.environment_digest
  ];
  if (typeof manifest.candidate_id !== "string" || !UUID.test(manifest.candidate_id) || manifest.base_revision !== null && typeof manifest.base_revision !== "string" || digestFields.some((digest) => typeof digest !== "string" || !SHA256.test(digest)) || !Array.isArray(manifest.evidence_ids) || manifest.evidence_ids.some((id) => typeof id !== "string" || !UUID.test(id)) || !Array.isArray(manifest.files)) {
    throw new ControlPlaneError("workflowd returned a malformed candidate manifest");
  }
  const files = manifest.files.map((value2) => {
    const file = asRecord(value2);
    if (typeof file.path !== "string" || !file.path || file.digest !== null && (typeof file.digest !== "string" || !SHA256.test(file.digest)) || !["added", "deleted", "generated", "modified"].includes(String(file.kind))) {
      throw new ControlPlaneError("workflowd returned a malformed candidate file");
    }
    return file;
  });
  return { ...manifest, files };
}
function parseEvidenceRecord(value) {
  const record = asRecord(value);
  if (typeof record.id !== "string" || !UUID.test(record.id) || typeof record.candidate_digest !== "string" || !SHA256.test(record.candidate_digest) || typeof record.output_digest !== "string" || !SHA256.test(record.output_digest) || typeof record.invocation !== "string" || typeof record.tool !== "string" || typeof record.tool_version !== "string" || typeof record.started_at !== "string" || typeof record.finished_at !== "string" || !["failed", "passed", "skipped"].includes(String(record.status)) || ![
    "browser",
    "build",
    "command",
    "database",
    "inspection",
    "lint",
    "package",
    "security",
    "test"
  ].includes(String(record.kind))) {
    throw new ControlPlaneError("workflowd returned a malformed evidence record");
  }
  return record;
}
function parseArbitrationReceipt(value) {
  const receipt = asRecord(value);
  const requiredDigests = [
    receipt.arbiter_verdict_digest,
    receipt.candidate_digest,
    receipt.request_digest
  ];
  const optionalDigests = [receipt.functional_review_digest, receipt.security_review_digest];
  if (typeof receipt.id !== "string" || !UUID.test(receipt.id) || typeof receipt.workflow_id !== "string" || !UUID.test(receipt.workflow_id) || typeof receipt.candidate_id !== "string" || !UUID.test(receipt.candidate_id) || typeof receipt.finalized_at !== "string" || requiredDigests.some((digest) => typeof digest !== "string" || !SHA256.test(digest)) || optionalDigests.some((digest) => digest !== null && (typeof digest !== "string" || !SHA256.test(digest))) || !Array.isArray(receipt.evidence_ids) || receipt.evidence_ids.some((id) => typeof id !== "string" || !UUID.test(id))) {
    throw new ControlPlaneError("workflowd returned a malformed arbitration receipt");
  }
  return receipt;
}

// src/cli.ts
var usage = "usage: cli.js audit < observation-json-on-stdin | cli.js health";
var plane = new LocalControlPlane({
  ...process.env.ZCODE_CYCLE_BINARY ? { binaryPath: process.env.ZCODE_CYCLE_BINARY } : {},
  ...process.env.ZCODE_CYCLE_DATA_DIR ? { dataDirectory: process.env.ZCODE_CYCLE_DATA_DIR } : {},
  stopOwnedProcessOnDispose: false
});
function readStdin() {
  return new Promise((resolve2) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => data += chunk);
    process.stdin.on("end", () => resolve2(data));
  });
}
async function run() {
  const [command] = process.argv.slice(2);
  if (command === "health") {
    process.stdout.write(`${JSON.stringify(await plane.health())}
`);
    return;
  }
  if (command === "audit") {
    const observation = JSON.parse(await readStdin());
    const receipt = await plane.audit(observation);
    process.stdout.write(`${JSON.stringify(receipt)}
`);
    return;
  }
  throw new Error(usage);
}
run().then(() => plane.dispose()).then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
  process.exit(1);
});
