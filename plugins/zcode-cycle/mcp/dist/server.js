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

// src/architecture-plan.ts
var MAX_ITEMS = 256;
var MAX_TEXT_BYTES = 4096;
var KEY = /^[A-Za-z0-9._-]{1,64}$/u;
var SHA2562 = /^[0-9a-f]{64}$/u;
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
var text = { type: "string", minLength: 1, maxLength: MAX_TEXT_BYTES };
var textList = { type: "array", items: text, maxItems: MAX_ITEMS };
var architecturePlanSchema = {
  type: "object",
  properties: {
    assumptions: textList,
    integration_checks: { ...textList, minItems: 1 },
    request_digest: { type: "string", pattern: "^[0-9a-f]{64}$" },
    requirements: {
      type: "array",
      minItems: 1,
      maxItems: MAX_ITEMS,
      items: {
        type: "object",
        properties: {
          acceptance_criteria: { ...textList, minItems: 1 },
          id: { type: "string", pattern: "^[A-Za-z0-9._-]{1,64}$" },
          statement: text
        },
        required: ["acceptance_criteria", "id", "statement"],
        additionalProperties: false
      }
    },
    risks: textList,
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: MAX_ITEMS,
      items: {
        type: "object",
        properties: {
          acceptance_criteria: { ...textList, minItems: 1 },
          dependencies: {
            type: "array",
            items: { type: "string", pattern: UUID2.source },
            maxItems: MAX_ITEMS
          },
          id: { type: "string", pattern: UUID2.source },
          objective: text,
          requirement_ids: {
            type: "array",
            minItems: 1,
            maxItems: MAX_ITEMS,
            items: { type: "string", pattern: KEY.source }
          },
          title: text,
          verification_commands: { ...textList, minItems: 1 },
          write_scopes: { ...textList, minItems: 1 }
        },
        required: [
          "acceptance_criteria",
          "dependencies",
          "id",
          "objective",
          "requirement_ids",
          "title",
          "verification_commands",
          "write_scopes"
        ],
        additionalProperties: false
      }
    }
  },
  required: [
    "assumptions",
    "integration_checks",
    "request_digest",
    "requirements",
    "risks",
    "tasks"
  ],
  additionalProperties: false
};
function validateArchitecturePlan(value) {
  const plan = record(value, "architecture plan");
  exactKeys(plan, ["assumptions", "integration_checks", "request_digest", "requirements", "risks", "tasks"], "architecture plan");
  if (typeof plan.request_digest !== "string" || !SHA2562.test(plan.request_digest)) {
    throw new Error("architecture plan request_digest must be the exact 64-character digest from cycle_start");
  }
  const assumptions = strings(plan.assumptions, "assumptions", false);
  const integrationChecks = strings(plan.integration_checks, "integration_checks", true);
  const risks = strings(plan.risks, "risks", false);
  const requirementValues = boundedArray(plan.requirements, "requirements", true);
  const requirementIds = new Set;
  const requirements = requirementValues.map((value2, index) => {
    const item = record(value2, `requirements[${index}]`);
    exactKeys(item, ["acceptance_criteria", "id", "statement"], `requirements[${index}]`);
    if (typeof item.id !== "string" || !KEY.test(item.id) || requirementIds.has(item.id)) {
      throw new Error(`requirements[${index}].id must be unique and contain only A-Z, a-z, 0-9, dot, underscore or hyphen`);
    }
    requirementIds.add(item.id);
    return {
      acceptance_criteria: strings(item.acceptance_criteria, `requirements[${index}].acceptance_criteria`, true),
      id: item.id,
      statement: requiredText(item.statement, `requirements[${index}].statement`)
    };
  });
  const taskValues = boundedArray(plan.tasks, "tasks", true);
  const taskIds = new Set;
  const tasks = taskValues.map((value2, index) => {
    const item = record(value2, `tasks[${index}]`);
    exactKeys(item, [
      "acceptance_criteria",
      "dependencies",
      "id",
      "objective",
      "requirement_ids",
      "title",
      "verification_commands",
      "write_scopes"
    ], `tasks[${index}]`);
    if (typeof item.id !== "string" || !UUID2.test(item.id) || taskIds.has(item.id)) {
      throw new Error(`tasks[${index}].id must be a unique UUID`);
    }
    taskIds.add(item.id);
    const requirementIdsForTask = strings(item.requirement_ids, `tasks[${index}].requirement_ids`, true);
    if (new Set(requirementIdsForTask).size !== requirementIdsForTask.length) {
      throw new Error(`tasks[${index}].requirement_ids contains a duplicate`);
    }
    for (const id of requirementIdsForTask) {
      if (!requirementIds.has(id))
        throw new Error(`tasks[${index}] references unknown requirement ${id}`);
    }
    const writeScopes = strings(item.write_scopes, `tasks[${index}].write_scopes`, true);
    for (const scope of writeScopes) {
      if (!safeRelative(scope))
        throw new Error(`tasks[${index}].write_scopes contains an unsafe path: ${scope}`);
    }
    return {
      acceptance_criteria: strings(item.acceptance_criteria, `tasks[${index}].acceptance_criteria`, true),
      dependencies: strings(item.dependencies, `tasks[${index}].dependencies`, false),
      id: item.id,
      objective: requiredText(item.objective, `tasks[${index}].objective`),
      requirement_ids: requirementIdsForTask,
      title: requiredText(item.title, `tasks[${index}].title`),
      verification_commands: strings(item.verification_commands, `tasks[${index}].verification_commands`, true),
      write_scopes: writeScopes
    };
  });
  for (const [index, task] of tasks.entries()) {
    if (new Set(task.dependencies).size !== task.dependencies.length) {
      throw new Error(`tasks[${index}].dependencies contains a duplicate`);
    }
    for (const dependency of task.dependencies) {
      if (!UUID2.test(dependency) || !taskIds.has(dependency) || dependency === task.id) {
        throw new Error(`tasks[${index}] has an invalid dependency ${dependency}`);
      }
    }
  }
  assertAcyclic(tasks);
  const covered = new Set(tasks.flatMap((task) => [...task.requirement_ids]));
  for (const id of requirementIds) {
    if (!covered.has(id))
      throw new Error(`architecture requirement ${id} is not covered by a task`);
  }
  return {
    assumptions,
    integration_checks: integrationChecks,
    request_digest: plan.request_digest,
    requirements,
    risks,
    tasks
  };
}
function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}
function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
}
function boundedArray(value, label, required) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || required && value.length === 0) {
    throw new Error(`${label} must be ${required ? "a non-empty" : "an"} array with at most ${MAX_ITEMS} items`);
  }
  return value;
}
function strings(value, label, required) {
  return boundedArray(value, label, required).map((item, index) => requiredText(item, `${label}[${index}]`));
}
function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > MAX_TEXT_BYTES || value.includes("\x00")) {
    throw new Error(`${label} must be non-empty text of at most ${MAX_TEXT_BYTES} bytes`);
  }
  return value;
}
function safeRelative(value) {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/u.test(value))
    return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}
function assertAcyclic(tasks) {
  const dependencies = new Map(tasks.map((task) => [task.id, task.dependencies]));
  const visiting = new Set;
  const visited = new Set;
  const visit = (id) => {
    if (visiting.has(id))
      throw new Error("architecture task dependencies contain a cycle");
    if (visited.has(id))
      return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? [])
      visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks)
    visit(task.id);
}

// src/project-key.ts
import { resolve as resolve2 } from "node:path";
function canonicalProjectKey(directory) {
  const absolute = resolve2(directory ?? process.env.ZCODE_PROJECT_DIR ?? process.cwd());
  return process.platform === "win32" ? absolute.replace(/^([a-z]):/u, (_match, letter) => `${letter.toUpperCase()}:`) : absolute;
}

// src/role-profiles.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { lstat as lstat2, mkdir as mkdir2, readFile as readFile2, rename as rename2, rm as rm2, writeFile } from "node:fs/promises";
import { dirname, join as join2, resolve as resolve3 } from "node:path";
var MAX_PROFILE_BYTES = 256 * 1024;
var MODEL_REF = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:/-]+$/u;
var CUSTOM_MODEL_REF = /^custom:(?:[A-Za-z0-9._+\/-]|%[0-9A-Fa-f]{2})+:(?:[A-Za-z0-9._:+\/-]|%[0-9A-Fa-f]{2})+$/u;
var INHERIT_MODEL = "inherit";
var INHERIT_THOUGHT_LEVEL = "high";
var BUILTIN_ZAI_MODEL_CAPABILITIES = new Map([
  ["custom:builtin:zai-coding-plan:GLM-5.3", new Set(["low", "high", "max"])],
  ["custom:builtin:zai-coding-plan:GLM-5.3-Flash", new Set(["low", "high", "max"])],
  ["custom:builtin:zai-coding-plan:GLM-5-Turbo", new Set(["enabled", "off"])]
]);
var ROLE_PROFILES = [
  { file: "architect.md", role: "architect" },
  { file: "executor.md", role: "executor" },
  { file: "functional-reviewer.md", role: "functional-reviewer" },
  { file: "security-reviewer.md", role: "security-reviewer" },
  { file: "arbiter.md", role: "arbiter" }
];
async function readPins(path) {
  if (!path)
    return {};
  try {
    const parsed = JSON.parse(await readBoundedRegularFile(path, "role-model pin record"));
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (isMissing(error))
      return {};
    throw error;
  }
}
async function writePins(path, pins) {
  if (!path)
    return;
  await mkdir2(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID2()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(pins, null, 2)}
`, {
    encoding: "utf8",
    mode: 384
  });
  await rename2(temporary, path);
}
async function manageRoleProfiles(options) {
  const projectRoot = resolve3(options.projectRoot);
  const pluginRoot = resolve3(options.pluginRoot);
  await requireSafeDirectory(projectRoot, "project root");
  await requireSafeDirectory(pluginRoot, "plugin root");
  await requireSafeDirectory(join2(pluginRoot, "agents"), "plugin role-profile directory");
  const templates = new Map;
  for (const profile of ROLE_PROFILES) {
    const source = join2(pluginRoot, "agents", profile.file);
    const content = await readBoundedRegularFile(source, "role-profile template");
    assertCanonicalTemplate(content, profile.role);
    templates.set(profile.role, content);
  }
  const mutating = options.operation !== "status";
  let changed = false;
  const targetDirectory = await roleProfileDirectory(projectRoot, mutating);
  const records = await Promise.all(ROLE_PROFILES.map((profile) => inspectProfile(targetDirectory, profile.role, profile.file, templates.get(profile.role))));
  switch (options.operation) {
    case "status":
      return report(projectRoot, records, false, (await readPins(options.pinStorePath))[projectRoot] ?? {});
    case "install":
      requireConfirmation(options.confirmation, "INSTALL_ZCODE_CYCLE_ROLE_PROFILES");
      rejectStates(records, new Set(["managed-drift", "conflict"]), "install");
      for (const record2 of records) {
        if (record2.state === "missing") {
          await writeAtomic(record2.target, templates.get(record2.role), false);
          changed = true;
        }
      }
      break;
    case "repair": {
      requireConfirmation(options.confirmation, "REPAIR_ZCODE_CYCLE_ROLE_PROFILES");
      rejectStates(records, new Set(["conflict"]), "repair");
      const pins2 = (await readPins(options.pinStorePath))[projectRoot] ?? {};
      for (const record2 of records) {
        const pinned = pins2[record2.role];
        const lostPin = pinned !== undefined && (record2.model ?? INHERIT_MODEL) !== pinned.model;
        if (record2.state !== "current" || lostPin) {
          const template = templates.get(record2.role);
          const settings = pinned ?? (record2.state === "managed-drift" && record2.content ? extractManagedSettings(record2.content, record2.role) : null);
          const repaired = settings ? template.replace(/^model:.*$/mu, `model: ${settings.model}`).replace(/^thoughtLevel:.*$/mu, `thoughtLevel: ${settings.thought_level}`) : template;
          await writeAtomic(record2.target, repaired, record2.state !== "missing");
          changed = true;
        }
      }
      break;
    }
    case "configure": {
      requireConfirmation(options.confirmation, "CONFIGURE_ZCODE_CYCLE_ROLE_PROFILE");
      rejectStates(records, new Set(["missing", "managed-drift", "conflict"]), "configure");
      const role = canonicalRole(options.role);
      const model = options.model ?? "inherit";
      if (!validModel(model)) {
        throw new Error("role-profile model must be inherit, provider/model or a ZCode custom:provider:model value");
      }
      if (!supportedModel(model)) {
        throw new Error("role-profile model is not supported by this Cycle release; use inherit or an exact supported ZCode built-in model");
      }
      const thoughtLevel = options.thoughtLevel ?? defaultThoughtLevel(model);
      if (!supportsThoughtLevel(model, thoughtLevel)) {
        throw new Error(`role-profile thought level ${thoughtLevel} is not supported by ${model}; allowed: ${supportedThoughtLevels(model).join(", ")}`);
      }
      const record2 = records.find((item) => item.role === role);
      const configured = record2.content.replace(/^model:.*$/mu, `model: ${model}`).replace(/^thoughtLevel:.*$/mu, `thoughtLevel: ${thoughtLevel}`);
      if (configured !== record2.content) {
        await writeAtomic(record2.target, configured, true);
        changed = true;
      }
      {
        const pins2 = await readPins(options.pinStorePath);
        const forProject = { ...pins2[projectRoot] ?? {} };
        if (model === INHERIT_MODEL) {
          delete forProject[role];
        } else {
          forProject[role] = {
            model,
            recorded_at: new Date().toISOString(),
            thought_level: thoughtLevel
          };
        }
        await writePins(options.pinStorePath, { ...pins2, [projectRoot]: forProject });
      }
      break;
    }
    case "remove":
      requireConfirmation(options.confirmation, "REMOVE_ZCODE_CYCLE_ROLE_PROFILES");
      rejectStates(records, new Set(["conflict"]), "remove");
      for (const record2 of records) {
        if (record2.state !== "missing") {
          await rm2(record2.target);
          changed = true;
        }
      }
      break;
    default:
      throw new Error(`unsupported role-profile operation: ${String(options.operation)}`);
  }
  const afterDirectory = await roleProfileDirectory(projectRoot, false);
  const after = await Promise.all(ROLE_PROFILES.map((profile) => inspectProfile(afterDirectory, profile.role, profile.file, templates.get(profile.role))));
  const pins = (await readPins(options.pinStorePath))[projectRoot] ?? {};
  const gitExcludeWarning = options.operation === "install" || options.operation === "repair" ? await excludeManagedProfilesFromGit(projectRoot) : null;
  return report(projectRoot, after, changed, pins, gitExcludeWarning);
}
function canonicalRole(value) {
  const role = ROLE_PROFILES.find((item) => item.role === value)?.role;
  if (!role)
    throw new Error("unknown Cycle role profile");
  return role;
}
function marker(role) {
  return `<!-- zcode-cycle-managed-role-profile: ${role} -->`;
}
function assertCanonicalTemplate(content, role) {
  if (!content.includes(marker(role)))
    throw new Error(`role-profile template lacks marker: ${role}`);
  if (!content.includes(`name: zcode-cycle:${role}`)) {
    throw new Error(`role-profile template has the wrong identity: ${role}`);
  }
  if (!/^model: inherit$/mu.test(content) || !/^thoughtLevel: high$/mu.test(content)) {
    throw new Error(`role-profile template has a non-canonical model configuration: ${role}`);
  }
}
async function roleProfileDirectory(projectRoot, create) {
  let current = projectRoot;
  for (const segment of [".zcode", "agents"]) {
    current = join2(current, segment);
    try {
      await requireSafeDirectory(current, "project role-profile directory");
    } catch (error) {
      if (!isMissing(error))
        throw error;
      if (!create)
        return null;
      await mkdir2(current);
      await requireSafeDirectory(current, "project role-profile directory");
    }
  }
  return current;
}
async function inspectProfile(directory, role, file, template) {
  const target = join2(directory ?? "", `zcode-cycle-${file}`);
  if (directory === null)
    return { file, role, state: "missing", target };
  let content;
  try {
    content = await readBoundedRegularFile(target, "installed role profile");
  } catch (error) {
    if (isMissing(error))
      return { file, role, state: "missing", target };
    throw error;
  }
  const configured = configuredProfile(content, template, role);
  return {
    content,
    digest: sha256(content),
    file,
    ...configured === null ? {} : configured,
    role,
    state: configured === null ? content.includes(marker(role)) ? "managed-drift" : "conflict" : "current",
    target
  };
}
function configuredProfile(content, template, role) {
  const settings = extractManagedSettings(content, role);
  if (!settings)
    return null;
  const normalized = content.replace(/^model:.*$/mu, "model: inherit").replace(/^thoughtLevel:.*$/mu, "thoughtLevel: high");
  return normalized === template ? settings : null;
}
function extractManagedSettings(content, role) {
  if (!content.includes(marker(role)))
    return null;
  const models = [...content.matchAll(/^model:\s*(\S+)\s*$/gmu)].map((match) => match[1]);
  const thoughtLevels = [...content.matchAll(/^thoughtLevel:\s*(\S+)\s*$/gmu)].map((match) => match[1]);
  if (models.length !== 1 || thoughtLevels.length !== 1)
    return null;
  const model = models[0];
  const thoughtLevel = thoughtLevels[0];
  if (!validModel(model) || !supportedModel(model) || !supportsThoughtLevel(model, thoughtLevel)) {
    return null;
  }
  return { model, thought_level: thoughtLevel };
}
async function excludeManagedProfilesFromGit(projectRoot) {
  const marker2 = ".zcode/";
  let gitDirectory;
  try {
    const dotGit = join2(projectRoot, ".git");
    const stats = await lstat2(dotGit);
    if (stats.isDirectory()) {
      gitDirectory = dotGit;
    } else {
      const pointer = (await readFile2(dotGit, "utf8")).trim();
      const target = pointer.startsWith("gitdir:") ? pointer.slice("gitdir:".length).trim() : "";
      if (target === "")
        return "the project's .git is neither a directory nor a gitdir pointer";
      const resolved = resolve3(projectRoot, target);
      const common = await readFile2(join2(resolved, "commondir"), "utf8").catch(() => null);
      gitDirectory = common === null ? resolved : resolve3(resolved, common.trim());
    }
  } catch {
    return "the project is not a git repository";
  }
  const entries = [
    { line: marker2, aliases: [marker2, ".zcode"], why: "role profiles are not project content." },
    {
      line: "/.zcodeignore",
      aliases: ["/.zcodeignore", ".zcodeignore"],
      why: "ZCode's own search-index file is not project content."
    }
  ];
  try {
    const excludePath = join2(gitDirectory, "info", "exclude");
    const existing = await readFile2(excludePath, "utf8").catch(() => "");
    const listed = new Set(existing.split(/\r?\n/u).map((line) => line.trim()));
    const missing = entries.filter((entry) => !entry.aliases.some((alias) => listed.has(alias)));
    if (missing.length === 0)
      return null;
    await mkdir2(dirname(excludePath), { recursive: true });
    const separator = existing === "" || existing.endsWith(`
`) ? "" : `
`;
    const added = missing.map((entry) => `# Managed by ZCode Cycle: ${entry.why}
${entry.line}
`).join("");
    await writeFile(excludePath, `${existing}${separator}${added}`, "utf8");
    return null;
  } catch (error) {
    return `could not update .git/info/exclude: ${error.message}`;
  }
}
function validModel(value) {
  return value === INHERIT_MODEL || MODEL_REF.test(value) || CUSTOM_MODEL_REF.test(value);
}
function supportedModel(value) {
  return validModel(value);
}
var KNOWN_THOUGHT_LEVELS = ["low", "high", "max", "enabled", "disabled", "off"];
function defaultThoughtLevel(model) {
  return BUILTIN_ZAI_MODEL_CAPABILITIES.get(model)?.has("off") === true ? "off" : INHERIT_THOUGHT_LEVEL;
}
function supportsThoughtLevel(model, thoughtLevel) {
  if (model === INHERIT_MODEL)
    return thoughtLevel === INHERIT_THOUGHT_LEVEL;
  const known = BUILTIN_ZAI_MODEL_CAPABILITIES.get(model);
  return known ? known.has(thoughtLevel) : KNOWN_THOUGHT_LEVELS.includes(thoughtLevel);
}
function supportedThoughtLevels(model) {
  if (model === INHERIT_MODEL)
    return [INHERIT_THOUGHT_LEVEL];
  return [...BUILTIN_ZAI_MODEL_CAPABILITIES.get(model) ?? KNOWN_THOUGHT_LEVELS];
}
function dispatchUnverified(model) {
  return model !== undefined && model !== INHERIT_MODEL;
}
function rejectStates(records, denied, action) {
  const blocked = records.filter((record2) => denied.has(record2.state));
  if (blocked.length > 0) {
    throw new Error(`role-profile ${action} refused: ${blocked.map((item) => `${item.role}=${item.state}`).join(", ")}`);
  }
}
function requireConfirmation(actual, expected) {
  if (actual !== expected)
    throw new Error(`role-profile operation requires confirmation ${expected}`);
}
async function requireSafeDirectory(path, label) {
  const info = await lstat2(path);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`${label} is unsafe: ${path}`);
}
async function readBoundedRegularFile(path, label) {
  const info = await lstat2(path);
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error(`${label} is unsafe: ${path}`);
  if (info.size > MAX_PROFILE_BYTES)
    throw new Error(`${label} exceeds the safety limit: ${path}`);
  return readFile2(path, "utf8");
}
async function writeAtomic(target, content, replace) {
  const directory = dirname(target);
  await requireSafeDirectory(directory, "project role-profile directory");
  const temporary = join2(directory, `.zcode-cycle-${randomUUID2()}.tmp`);
  const backup = join2(directory, `.zcode-cycle-${randomUUID2()}.bak`);
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 384 });
  try {
    if (!replace) {
      await rename2(temporary, target);
      return;
    }
    await rename2(target, backup);
    try {
      await rename2(temporary, target);
    } catch (error) {
      await rename2(backup, target).catch(() => {
        return;
      });
      throw error;
    }
    await rm2(backup);
  } finally {
    await rm2(temporary, { force: true });
    await rm2(backup, { force: true });
  }
}
function report(projectRoot, records, changed, pins, gitExcludeWarning) {
  const drift = records.flatMap((record2) => {
    const pinned = pins[record2.role];
    if (!pinned)
      return [];
    const resolved = record2.model ?? INHERIT_MODEL;
    if (resolved === pinned.model)
      return [];
    return [{ on_disk: resolved, pinned: pinned.model, role: record2.role }];
  });
  return {
    changed,
    profile_directory: join2(projectRoot, ".zcode", "agents"),
    profiles: records.map(({ digest, file, model, role, state, thought_level }) => ({
      ...digest ? { digest } : {},
      ...dispatchUnverified(model) ? { dispatch_unverified: true } : {},
      file: `zcode-cycle-${file}`,
      ...model ? { model } : {},
      ...pins[role] ? { model_requested: pins[role].model } : {},
      role,
      state,
      ...thought_level ? { thought_level } : {}
    })),
    ready: records.every((record2) => record2.state === "current") && drift.length === 0,
    requires_session_restart: changed,
    ...records.some((record2) => dispatchUnverified(record2.model)) ? {
      dispatch_unverified_warning: `${records.filter((record2) => dispatchUnverified(record2.model)).map((record2) => `${record2.role} on ${record2.model}`).join(", ")}. This plugin validates the shape of a model reference; only the host can ` + `resolve the provider, and it reports that at dispatch. Probe each pinned role before ` + `starting a governed cycle, so a provider-not-found costs seconds rather than a full ` + `architecture, execution and verification pass.`
    } : {},
    ...gitExcludeWarning ? {
      git_exclude_warning: `${gitExcludeWarning}. The managed role profiles under .zcode/ will therefore appear as ` + `uncommitted project changes, and a governed cycle cannot freeze a candidate while they do. ` + `Add .zcode/ to .git/info/exclude, or commit the profiles before starting a cycle.`
    } : {},
    ...drift.length > 0 ? {
      pin_drift: drift,
      warning: `${drift.length === 1 ? "a role profile no longer carries" : "role profiles no longer carry"} ` + `the model it was pinned to, so ${drift.length === 1 ? "that role" : "those roles"} will be ` + `dispatched on ${drift.map((item) => `${item.role} on ${item.on_disk} instead of ${item.pinned}`).join(", ")}. ` + `Run cycle_role_profiles repair to restore the pinned model before dispatching, or configure the ` + `role to inherit if the pin is no longer wanted.`
    } : {}
  };
}
function sha256(value) {
  return createHash2("sha256").update(value).digest("hex");
}
function isMissing(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// src/role-registry.ts
function isRoleRegistration(value) {
  return value !== undefined && value.kind !== "workflow_lock" && typeof value.role === "string";
}
function isWorkflowLock(value) {
  return value?.kind === "workflow_lock";
}
function orphanedRegistrationKeys(registry, workflowId) {
  const locked = new Set(Object.values(registry).filter(isWorkflowLock).map((lock) => lock.workflow_id));
  const keys = [];
  for (const [key, value] of Object.entries(registry)) {
    if (!isRoleRegistration(value))
      continue;
    const orphaned = workflowId === undefined ? value.workflow_id !== null && !locked.has(value.workflow_id) : value.workflow_id === workflowId;
    if (orphaned)
      keys.push(key);
  }
  return keys;
}

// src/server.ts
import { mkdir as mkdir3, readFile as readFile3, rename as rename3, rm as rm3, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2, join as join3 } from "node:path";
import { createInterface } from "node:readline";
var UUID3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
var READ_ONLY_ROLES = new Set([
  "architect",
  "functional_reviewer",
  "security_reviewer",
  "arbiter"
]);
var MUTATING_TOOLS = new Set(["Edit", "Write", "ApplyPatch", "MultiEdit"]);
var SERVER_INFO = { name: "zcode-cycle", version: productVersion() };
var PROTOCOL_VERSION = "2025-06-18";
var plane = new LocalControlPlane({
  ...process.env.ZCODE_CYCLE_BINARY ? { binaryPath: process.env.ZCODE_CYCLE_BINARY } : {},
  ...process.env.ZCODE_CYCLE_DATA_DIR ? { dataDirectory: process.env.ZCODE_CYCLE_DATA_DIR } : {},
  stopOwnedProcessOnDispose: false
});
var dataDirectory = process.env.ZCODE_CYCLE_DATA_DIR ?? resolveDataDirectory(process.platform, process.env);
var registryPath = join3(dataDirectory, "runtime", "role-sessions.json");
var allowedOrigins = process.env.ZCODE_CYCLE_BROWSER_ALLOWED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean);
var browserRuntimePromise;
function browserRuntime() {
  browserRuntimePromise ??= import(new URL("./browser-runtime.js", import.meta.url).href).then((module) => module.createBrowserRuntime({ allowedOrigins, dataDirectory }));
  return browserRuntimePromise;
}
async function readRegistry() {
  try {
    return JSON.parse(await readFile3(registryPath, "utf8"));
  } catch {
    return {};
  }
}
async function writeRegistry(registry) {
  await mkdir3(dirname2(registryPath), { recursive: true });
  const temporary = `${registryPath}.tmp`;
  await writeFile2(temporary, JSON.stringify(registry, null, 1), "utf8");
  await rm3(registryPath, { force: true });
  await rename3(temporary, registryPath);
}
function workflowLockKey(workflowId) {
  return `workflow:${workflowId}`;
}
async function lockWorkflow(projectKey, workflowId) {
  const registry = await readRegistry();
  registry[workflowLockKey(workflowId)] = {
    kind: "workflow_lock",
    project_directory: process.env.ZCODE_PROJECT_DIR ?? process.cwd(),
    project_key: projectKey,
    registered_at_unix_millis: Date.now(),
    workflow_id: workflowId
  };
  await writeRegistry(registry);
}
async function recordWorktree(workflowId, worktreePath) {
  const registry = await readRegistry();
  const lock = registry[workflowLockKey(workflowId)];
  if (!isWorkflowLock(lock))
    return;
  registry[workflowLockKey(workflowId)] = { ...lock, worktree_path: worktreePath };
  await writeRegistry(registry);
}
async function unlockWorkflow(workflowId) {
  const registry = await readRegistry();
  delete registry[workflowLockKey(workflowId)];
  for (const [key, value] of Object.entries(registry)) {
    if (isRoleRegistration(value) && value.workflow_id === workflowId)
      delete registry[key];
  }
  await writeRegistry(registry);
}
async function revokeOrphanedRoleRegistrations(workflowId) {
  const registry = await readRegistry();
  const keys = orphanedRegistrationKeys(registry, workflowId);
  for (const key of keys)
    delete registry[key];
  if (keys.length > 0)
    await writeRegistry(registry);
  return keys;
}
function terminalWorkflowState(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const record2 = value;
  const state = record2.state ?? record2.workflowState;
  return state === "completed" || state === "cancelled";
}
async function requireRoleSession(args, expectedRoles, projectKey, workflowId) {
  const sessionId = text2(args.role_session_id);
  const registration = (await readRegistry())[sessionId];
  if (!UUID3.test(sessionId) || !isRoleRegistration(registration) || !expectedRoles.has(registration.role) || registration.project_key !== projectKey || registration.workflow_id !== workflowId) {
    throw new Error(`role-bound submission requires an active ${[...expectedRoles].join(" or ")} role_session_id`);
  }
  return registration;
}
function text2(value) {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}
async function callTool(name, rawArgs) {
  const args = typeof rawArgs === "object" && rawArgs !== null ? rawArgs : {};
  const projectKey = canonicalProjectKey();
  switch (name) {
    case "cycle_health":
      return { ...await plane.health(), data_directory: dataDirectory };
    case "cycle_start": {
      const preference = args.preference === "quick" || args.preference === "full" || args.preference === "auto" ? args.preference : undefined;
      const started = await plane.startWorkflow({
        originalRequest: text2(args.original_request),
        ...preference !== undefined ? { preference } : {},
        projectKey,
        ...Array.isArray(args.affected_paths) ? { affectedPaths: args.affected_paths.map(String) } : {},
        ...Array.isArray(args.attachment_hashes) ? { attachmentHashes: args.attachment_hashes.map(String) } : {}
      });
      try {
        await lockWorkflow(projectKey, started.workflowId);
      } catch (error) {
        await plane.control(projectKey, "cancel", started.workflowId).catch(() => {
          return;
        });
        throw error;
      }
      return {
        ...started,
        next_phase: "architecture",
        orchestrator_locked: true
      };
    }
    case "cycle_control": {
      const workflowId = typeof args.workflow_id === "string" ? args.workflow_id : undefined;
      try {
        const result = await plane.control(projectKey, args.operation ?? "status", workflowId);
        if (workflowId !== undefined && terminalWorkflowState(result)) {
          await unlockWorkflow(workflowId);
        }
        return result;
      } finally {
        if (args.operation === "recovery")
          await revokeOrphanedRoleRegistrations(workflowId);
      }
    }
    case "cycle_audit": {
      const observation = args.observation;
      if (typeof observation !== "object" || observation === null) {
        throw new Error("cycle_audit requires an observation object");
      }
      return plane.audit(observation);
    }
    case "cycle_history":
      return plane.history(projectKey, args.operation ?? { type: "query", after_sequence: null, limit: 50 });
    case "cycle_memory":
      return plane.memory(projectKey, args.operation);
    case "cycle_goal":
      return plane.goal(projectKey, args.operation);
    case "cycle_admission":
      return plane.admission(projectKey, text2(args.workflow_id), text2(args.workspace), args.operation === "renew" || args.operation === "release" ? args.operation : "acquire");
    case "cycle_role_profiles": {
      const operation = args.operation === "install" || args.operation === "repair" || args.operation === "configure" || args.operation === "remove" ? args.operation : "status";
      const pluginRoot = process.env.ZCODE_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
      if (!pluginRoot)
        throw new Error("cycle_role_profiles requires ZCODE_PLUGIN_ROOT");
      return manageRoleProfiles({
        operation,
        pinStorePath: join3(dataDirectory, "runtime", "role-model-pins.json"),
        pluginRoot,
        projectRoot: process.env.ZCODE_PROJECT_DIR ?? process.cwd(),
        ...typeof args.confirmation === "string" ? { confirmation: args.confirmation } : {},
        ...typeof args.model === "string" ? { model: args.model } : {},
        ...typeof args.role === "string" ? { role: args.role } : {},
        ...typeof args.thought_level === "string" ? { thoughtLevel: args.thought_level } : {}
      });
    }
    case "cycle_role_register": {
      const sessionId = text2(args.session_id);
      const role = text2(args.role);
      if (!UUID3.test(sessionId) || ![...READ_ONLY_ROLES, "executor"].includes(role)) {
        throw new Error("cycle_role_register requires a UUID session_id and a known role");
      }
      const registry = await readRegistry();
      const workflowId = typeof args.workflow_id === "string" ? args.workflow_id : null;
      if (workflowId !== null) {
        const lock = registry[workflowLockKey(workflowId)];
        if (!isWorkflowLock(lock) || lock.project_key !== projectKey) {
          throw new Error("cycle_role_register requires an active workflow lock");
        }
      }
      registry[sessionId] = {
        kind: "role",
        project_directory: process.env.ZCODE_PROJECT_DIR ?? process.cwd(),
        project_key: projectKey,
        registered_at_unix_millis: Date.now(),
        role,
        workflow_id: workflowId
      };
      await writeRegistry(registry);
      return { registered: sessionId, role };
    }
    case "cycle_role_revoke": {
      const sessionId = text2(args.session_id);
      const registry = await readRegistry();
      const revoked = isRoleRegistration(registry[sessionId]) ? registry[sessionId] : null;
      if (revoked !== null)
        delete registry[sessionId];
      await writeRegistry(registry);
      return { revoked };
    }
    case "cycle_role_list": {
      const registry = await readRegistry();
      return Object.fromEntries(Object.entries(registry).filter(([, value]) => isRoleRegistration(value)));
    }
    case "cycle_code_index": {
      const projectDirectory = text2(args.project_directory);
      const workflowId = text2(args.workflow_id);
      if (!projectDirectory || !workflowId) {
        throw new Error("cycle_code_index requires project_directory and workflow_id");
      }
      return plane.codeIndex(projectKey, workflowId, projectDirectory);
    }
    case "cycle_submit_architecture": {
      const workflowId = text2(args.workflow_id);
      if (!workflowId) {
        throw new Error("cycle_submit_architecture requires workflow_id and a plan object");
      }
      const plan = validateArchitecturePlan(args.plan);
      await requireRoleSession(args, new Set(["architect"]), projectKey, workflowId);
      await plane.submitArchitecture(projectKey, workflowId, plan);
      return { accepted: true, workflow_id: workflowId };
    }
    case "cycle_prepare_worktree": {
      const workflowId = text2(args.workflow_id);
      const projectDirectory = text2(args.project_directory);
      if (!workflowId || !projectDirectory) {
        throw new Error("cycle_prepare_worktree requires workflow_id and project_directory");
      }
      const worktree = await plane.prepareWorktree(projectKey, projectDirectory, workflowId);
      await recordWorktree(workflowId, worktree.path);
      return worktree;
    }
    case "cycle_plan_verification": {
      const workflowId = text2(args.workflow_id);
      const planId = UUID3.test(String(args.plan_id ?? "")) ? String(args.plan_id) : undefined;
      if (!workflowId)
        throw new Error("cycle_plan_verification requires workflow_id");
      return plane.planVerification(projectKey, workflowId, planId);
    }
    case "cycle_freeze_candidate": {
      const workflowId = text2(args.workflow_id);
      const baseRevision = text2(args.base_revision);
      const planId = text2(args.plan_id);
      if (!workflowId || !baseRevision || !planId) {
        throw new Error("cycle_freeze_candidate requires workflow_id, base_revision and plan_id");
      }
      const evidenceIds = Array.isArray(args.evidence_ids) ? args.evidence_ids.map(String) : [];
      return plane.freezeCandidate(projectKey, workflowId, baseRevision, planId, evidenceIds);
    }
    case "cycle_verify_candidate": {
      const workflowId = text2(args.workflow_id);
      const candidateId = text2(args.candidate_id);
      const planId = text2(args.plan_id);
      if (!workflowId || !candidateId || !planId) {
        throw new Error("cycle_verify_candidate requires workflow_id, candidate_id and plan_id");
      }
      let attestations = Array.isArray(args.attestations) ? args.attestations : [];
      if (Array.isArray(args.browser_session_ids) && args.browser_session_ids.length > 0) {
        attestations = [...attestations, ...await (await browserRuntime()).attest(args)];
      }
      return plane.verifyCandidate(projectKey, workflowId, candidateId, planId, attestations);
    }
    case "cycle_browser": {
      const sessionId = text2(args.session_id);
      if (!sessionId || !text2(args.operation)) {
        throw new Error("cycle_browser requires session_id and operation");
      }
      const registration = (await readRegistry())[sessionId];
      return (await browserRuntime()).run({
        command: args,
        registration: isRoleRegistration(registration) ? registration : undefined,
        sessionId
      });
    }
    case "cycle_submit_review": {
      const workflowId = text2(args.workflow_id);
      const candidateId = text2(args.candidate_id);
      const verdict = args.verdict;
      if (!workflowId || !candidateId || typeof verdict !== "object" || verdict === null) {
        throw new Error("cycle_submit_review requires workflow_id, candidate_id and verdict");
      }
      await requireRoleSession(args, new Set(["functional_reviewer", "security_reviewer"]), projectKey, workflowId);
      return plane.submitReview(projectKey, workflowId, candidateId, verdict);
    }
    case "cycle_submit_arbitration": {
      const workflowId = text2(args.workflow_id);
      const candidateId = text2(args.candidate_id);
      const verdict = args.verdict;
      if (!workflowId || !candidateId || typeof verdict !== "object" || verdict === null) {
        throw new Error("cycle_submit_arbitration requires workflow_id, candidate_id and verdict");
      }
      await requireRoleSession(args, new Set(["arbiter"]), projectKey, workflowId);
      return plane.submitArbitration(projectKey, workflowId, candidateId, verdict);
    }
    case "cycle_report_execution": {
      const workflowId = text2(args.workflow_id);
      const outcome = args.outcome === "plan_defect" ? "plan_defect" : "blocked";
      if (!workflowId)
        throw new Error("cycle_report_execution requires workflow_id");
      const workflowState = await plane.reportExecution(projectKey, workflowId, outcome);
      return { outcome, workflow_id: workflowId, workflow_state: workflowState };
    }
    case "cycle_promote_candidate": {
      const workflowId = text2(args.workflow_id);
      const candidateId = text2(args.candidate_id);
      const projectDirectory = text2(args.project_directory);
      if (!workflowId || !candidateId || !projectDirectory) {
        throw new Error("cycle_promote_candidate requires workflow_id, candidate_id and project_directory");
      }
      const result = await plane.promoteCandidate(projectKey, workflowId, candidateId, projectDirectory);
      if (terminalWorkflowState(result))
        await unlockWorkflow(workflowId);
      return result;
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
var EVIDENCE_IDS = {
  type: "array",
  items: { type: "string", description: "evidence id, a UUID" }
};
var FINDING = {
  type: "object",
  properties: {
    severity: { enum: ["critical", "high", "medium", "low", "info"] },
    summary: { type: "string" },
    evidence_ids: EVIDENCE_IDS
  },
  required: ["severity", "summary", "evidence_ids"],
  additionalProperties: false
};
var REQUIREMENT_DECISION = {
  type: "object",
  properties: {
    requirement_id: { type: "string" },
    status: { enum: ["satisfied", "unsatisfied"] },
    evidence_ids: EVIDENCE_IDS
  },
  required: ["requirement_id", "status", "evidence_ids"],
  additionalProperties: false
};
var REPAIR_TARGET = {
  description: "null when the decision is an approval",
  enum: ["execution", "architecture", null]
};
var ARBITER_VERDICT = {
  type: "object",
  properties: {
    decision: { enum: ["approved", "rejected"] },
    candidate_digest: { type: "string", description: "sha256 of the frozen candidate" },
    requirements: { type: "array", items: REQUIREMENT_DECISION },
    findings: { type: "array", items: FINDING },
    repair_target: REPAIR_TARGET
  },
  required: ["decision", "candidate_digest", "requirements", "findings", "repair_target"],
  additionalProperties: false
};
var REVIEW_VERDICT = {
  type: "object",
  properties: {
    decision: { enum: ["approved", "rejected"] },
    candidate_digest: { type: "string", description: "sha256 of the frozen candidate" },
    requirements: { type: "array", items: REQUIREMENT_DECISION },
    findings: { type: "array", items: FINDING },
    repair_target: REPAIR_TARGET,
    role: { enum: ["functional_reviewer", "security_architecture_reviewer"] }
  },
  required: [
    "decision",
    "candidate_digest",
    "requirements",
    "findings",
    "repair_target",
    "role"
  ],
  additionalProperties: false
};
var AUDIT_OBSERVATION = {
  type: "object",
  properties: {
    actor_id: { type: "string" },
    candidate_id: { type: ["string", "null"] },
    data: {
      description: "one tagged variant: workflow{action} | tool{tool,invocation_digest} | permission{permission,decision} | git{revision,externally_attributed} | verification{gate,status}",
      type: "object"
    },
    evidence_ids: EVIDENCE_IDS,
    files: { type: "array", items: { type: "string" } },
    metadata: { type: "object", additionalProperties: { type: "string" } },
    model: { type: ["object", "null"] },
    project_key: { type: "string" },
    role: {
      enum: [
        "architect",
        "executor",
        "functional_reviewer",
        "security_architecture_reviewer",
        "arbiter",
        null
      ]
    },
    session_id: { type: ["string", "null"] },
    task_id: { type: ["string", "null"] },
    timestamp_unix_millis: { type: "integer" },
    workflow_id: { type: ["string", "null"] }
  },
  required: [
    "actor_id",
    "candidate_id",
    "data",
    "evidence_ids",
    "files",
    "metadata",
    "model",
    "project_key",
    "role",
    "session_id",
    "task_id",
    "timestamp_unix_millis",
    "workflow_id"
  ],
  additionalProperties: false
};
var TOOLS = {
  cycle_health: {
    description: "Check the Cycle control plane: spawns or attaches the local workflowd daemon and returns product/protocol/schema versions plus the authoritative data directory.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  cycle_start: {
    description: "Start a governed workflow for the exact original user request. Returns the workflow id, deterministic route and immutable request digest, and locks main-session mutation until terminal cleanup; dispatch registered roles for all implementation.",
    inputSchema: {
      type: "object",
      properties: {
        original_request: { type: "string" },
        project_key: { type: "string" },
        preference: { enum: ["auto", "quick", "full"] },
        affected_paths: { type: "array", items: { type: "string" } },
        attachment_hashes: { type: "array", items: { type: "string" } }
      },
      required: ["original_request", "project_key"],
      additionalProperties: false
    }
  },
  cycle_control: {
    description: "Control or inspect workflows: status, tasks, evidence, doctor, pause, resume, cancel, retry, recovery.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        operation: {
          enum: [
            "cancel",
            "doctor",
            "evidence",
            "pause",
            "recovery",
            "resume",
            "retry",
            "status",
            "tasks"
          ]
        },
        workflow_id: { type: "string" }
      },
      required: ["project_key", "operation"],
      additionalProperties: false
    }
  },
  cycle_audit: {
    description: "Append a tamper-evident audit observation to the project ledger (actor, role, session, digests, metadata).",
    inputSchema: {
      type: "object",
      properties: {
        observation: AUDIT_OBSERVATION
      },
      required: ["observation"],
      additionalProperties: false
    }
  },
  cycle_history: {
    description: "Query, export or verify the project audit ledger.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        operation: { type: "object" }
      },
      required: ["project_key"],
      additionalProperties: false
    }
  },
  cycle_memory: {
    description: "Search, explain or remove reusable project knowledge.",
    inputSchema: {
      type: "object",
      properties: { project_key: { type: "string" }, operation: { type: "object" } },
      required: ["project_key", "operation"],
      additionalProperties: false
    }
  },
  cycle_goal: {
    description: "Manage persistent goals: create, amend, focus, link and unlink workflows, save versioned plans, control lifecycle.",
    inputSchema: {
      type: "object",
      properties: { project_key: { type: "string" }, operation: { type: "object" } },
      required: ["project_key", "operation"],
      additionalProperties: false
    }
  },
  cycle_admission: {
    description: "Acquire, renew or release a workflow resource permit (bounded concurrent workflows per project).",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        workspace: { type: "string" },
        operation: { enum: ["acquire", "renew", "release"] }
      },
      required: ["project_key", "workflow_id", "workspace", "operation"],
      additionalProperties: false
    }
  },
  cycle_role_register: {
    description: "Register a dispatched role session (architect, executor, functional_reviewer, security_reviewer, arbiter) against an active workflow lock so the PreToolUse hook enforces its boundaries and audits its tool use.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", pattern: UUID3.source },
        role: {
          enum: [
            "architect",
            "executor",
            "functional_reviewer",
            "security_reviewer",
            "arbiter"
          ]
        },
        project_key: { type: "string" },
        workflow_id: { type: "string" }
      },
      required: ["session_id", "role", "project_key"],
      additionalProperties: false
    }
  },
  cycle_role_profiles: {
    description: "Inspect or explicitly install, repair, configure or remove the five managed Cycle role profiles under the current project's .zcode/agents directory. Mutations require the operation-specific confirmation token and a session restart.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { enum: ["status", "install", "repair", "configure", "remove"] },
        confirmation: { type: "string" },
        role: {
          enum: [
            "architect",
            "executor",
            "functional-reviewer",
            "security-reviewer",
            "arbiter"
          ]
        },
        model: { type: "string" },
        thought_level: { enum: ["low", "high", "max", "enabled", "disabled", "off"] }
      },
      required: ["operation"],
      additionalProperties: false
    }
  },
  cycle_role_revoke: {
    description: "Revoke a registered role session when its dispatch completes.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
      additionalProperties: false
    }
  },
  cycle_role_list: {
    description: "List registered role sessions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  cycle_browser: {
    description: "Control an isolated managed browser for QA evidence: open (loopback allowed by default; external origins require approve_origin after explicit user approval), snapshot, click, fill, press, upload, check, screenshot, logs, close. Interactive actions (click, fill, press, upload) require an executor-registered session. Close captures the evidence receipt bound to the session; pass browser_session_ids plus candidate_digest to cycle_verify_candidate for browser evidence gates.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        operation: {
          enum: [
            "open",
            "snapshot",
            "click",
            "fill",
            "press",
            "upload",
            "check",
            "screenshot",
            "logs",
            "close"
          ]
        },
        approve_origin: { type: "boolean" },
        url: { type: "string" },
        selector: { type: "string" },
        testId: { type: "string" },
        role: { type: "string" },
        name: { type: "string" },
        text: { type: "string" },
        value: { type: "string" },
        environmentVariable: { type: "string" },
        key: { type: "string" },
        path: { type: "string" },
        expectedText: { type: "string" },
        expectedUrl: { type: "string" },
        exact: { type: "boolean" },
        fullPage: { type: "boolean" }
      },
      required: ["session_id", "operation"],
      additionalProperties: false
    }
  },
  cycle_code_index: {
    description: "Request the incremental code intelligence index for a workflow: scoped symbol graph context for the architect, without rescanning unchanged files.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        project_directory: { type: "string" }
      },
      required: ["project_key", "workflow_id", "project_directory"],
      additionalProperties: false
    }
  },
  cycle_submit_architecture: {
    description: "Submit the architect's task graph with its active architect role_session_id. The bridge and daemon reject unbound roles, invalid graphs and out-of-order submissions.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        role_session_id: { type: "string" },
        plan: architecturePlanSchema
      },
      required: ["project_key", "workflow_id", "role_session_id", "plan"],
      additionalProperties: false
    }
  },
  cycle_prepare_worktree: {
    description: "After an accepted architecture, prepare the isolated git worktree and record its base revision. The main session is mutation-locked: dispatch a registered executor into the returned path and never edit project_directory.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        project_directory: { type: "string" }
      },
      required: ["project_key", "workflow_id", "project_directory"],
      additionalProperties: false
    }
  },
  cycle_plan_verification: {
    description: "Plan the verification gates for the pending candidate; returns the plan id and evidence ids.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        plan_id: { type: "string" }
      },
      required: ["project_key", "workflow_id"],
      additionalProperties: false
    }
  },
  cycle_freeze_candidate: {
    description: "Freeze the exact candidate from the worktree: manifest with per-file digests, diff and environment digests. Verification always runs against the frozen candidate.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        base_revision: { type: "string" },
        plan_id: { type: "string" },
        evidence_ids: { type: "array", items: { type: "string" } }
      },
      required: ["project_key", "workflow_id", "base_revision", "plan_id"],
      additionalProperties: false
    }
  },
  cycle_verify_candidate: {
    description: "Run the mandatory verification gates against the frozen candidate. Returns per-gate evidence records and the mandatory pass verdict; failures drive the repair loop. Pass browser_session_ids and the frozen candidate_digest to include managed-browser attestations as browser evidence gates.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        candidate_id: { type: "string" },
        plan_id: { type: "string" },
        attestations: { type: "array", items: { type: "object" } },
        browser_session_ids: { type: "array", items: { type: "string" } },
        candidate_digest: { type: "string" }
      },
      required: ["project_key", "workflow_id", "candidate_id", "plan_id"],
      additionalProperties: false
    }
  },
  cycle_submit_review: {
    description: "Submit an independent review verdict with the active functional or security reviewer role_session_id.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        candidate_id: { type: "string" },
        role_session_id: { type: "string" },
        verdict: REVIEW_VERDICT
      },
      required: ["project_key", "workflow_id", "candidate_id", "role_session_id", "verdict"],
      additionalProperties: false
    }
  },
  cycle_submit_arbitration: {
    description: "Submit the arbiter's final verdict with its active arbiter role_session_id. Only valid after verification (and reviews in full mode).",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        candidate_id: { type: "string" },
        role_session_id: { type: "string" },
        verdict: ARBITER_VERDICT
      },
      required: ["project_key", "workflow_id", "candidate_id", "role_session_id", "verdict"],
      additionalProperties: false
    }
  },
  cycle_report_execution: {
    description: "Report an execution outcome the orchestrator cannot resolve: blocked, or plan_defect to restart planning.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        outcome: { enum: ["blocked", "plan_defect"] }
      },
      required: ["project_key", "workflow_id", "outcome"],
      additionalProperties: false
    }
  },
  cycle_promote_candidate: {
    description: "Promote the approved candidate from the worktree to the project directory and deliver it.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string" },
        workflow_id: { type: "string" },
        candidate_id: { type: "string" },
        project_directory: { type: "string" }
      },
      required: ["project_key", "workflow_id", "candidate_id", "project_directory"],
      additionalProperties: false
    }
  }
};
function writeMessage(value) {
  process.stdout.write(`${JSON.stringify(value)}
`);
}
function reply(id, result) {
  writeMessage({ id, jsonrpc: "2.0", result });
}
function replyError(id, code, message) {
  writeMessage({ error: { code, message }, id, jsonrpc: "2.0" });
}
async function handle(request) {
  const { id, method } = request;
  switch (method) {
    case "initialize":
      reply(id, {
        capabilities: { tools: { listChanged: false } },
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO
      });
      return;
    case "notifications/initialized":
      return;
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, {
        tools: Object.entries(TOOLS).map(([name, tool]) => ({
          description: tool.description,
          inputSchema: tool.inputSchema,
          name
        }))
      });
      return;
    case "tools/call": {
      const params = request.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      if (!(name in TOOLS)) {
        replyError(id, -32602, `unknown tool: ${name}`);
        return;
      }
      try {
        const result = await callTool(name, params.arguments);
        reply(id, {
          content: [{ text: JSON.stringify(result, null, 1), type: "text" }],
          isError: false
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply(id, {
          content: [{ text: message, type: "text" }],
          isError: true
        });
      }
      return;
    }
    default:
      if (id !== undefined)
        replyError(id, -32601, `method not found: ${method}`);
  }
}
async function main() {
  const stdin = createInterface({ input: process.stdin });
  stdin.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed)
      return;
    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      return;
    }
    handle(request).catch(() => {
      if (request.id !== undefined) {
        replyError(request.id, -32603, "internal error");
      }
    });
  });
  process.stdin.on("close", () => {
    const disposeBrowser = browserRuntimePromise?.then((runtime) => runtime.dispose());
    Promise.allSettled([
      plane.dispose(),
      ...disposeBrowser === undefined ? [] : [disposeBrowser]
    ]).finally(() => process.exit(0));
  });
}
main();
