// PostToolUse audit: records completed tool calls from registered role
// sessions to the project ledger. Fire-and-forget; never blocks the session.

const { createHash } = require("node:crypto")
const { readFile } = require("node:fs/promises")
const { join, posix, resolve, win32 } = require("node:path")
const { spawn } = require("node:child_process")

const LEDGER_ROLE = {
  architect: "architect",
  executor: "executor",
  functional_reviewer: "functional_reviewer",
  security_reviewer: "security_architecture_reviewer",
  arbiter: "arbiter",
}

const ALL_ROLES = new Set(Object.keys(LEDGER_ROLE))
const MAX_HOOK_INPUT_BYTES = 1024 * 1024

function dataDirectory() {
  if (process.env.ZCODE_CYCLE_DATA_DIR) return process.env.ZCODE_CYCLE_DATA_DIR
  const combine = process.platform === "win32" ? win32.join : posix.join
  if (process.platform === "win32") {
    return combine(process.env.LOCALAPPDATA, "ZCode Cycle")
  }
  if (process.platform === "darwin") {
    return combine(process.env.HOME, "Library", "Application Support", "ZCode Cycle")
  }
  return combine(process.env.XDG_DATA_HOME || combine(process.env.HOME, ".local", "share"), "zcode-cycle")
}

function readStdin() {
  return new Promise((resolve) => {
    let data = ""
    let settled = false
    process.stdin.setEncoding("utf8")
    const settle = (value) => {
      if (settled) return
      settled = true
      process.stdin.off("data", onData)
      process.stdin.off("end", onEnd)
      process.stdin.destroy()
      resolve(value)
    }
    const onData = (chunk) => {
      data += chunk
      const newline = data.indexOf("\n")
      if (newline >= 0) {
        settle(data.slice(0, newline).replace(/\r$/u, ""))
      } else if (Buffer.byteLength(data) > MAX_HOOK_INPUT_BYTES) {
        settle(data)
      }
    }
    const onEnd = () => settle(data)
    process.stdin.on("data", onData)
    process.stdin.on("end", onEnd)
  })
}

async function main() {
  const raw = await readStdin()
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    return
  }
  const sessionId = input.sessionId ?? input.session_id
  if (typeof sessionId !== "string") return

  let registry
  try {
    registry = JSON.parse(
      await readFile(join(dataDirectory(), "runtime", "role-sessions.json"), "utf8"),
    )
  } catch {
    return
  }
  const candidateRegistration = registry[sessionId]
  const directRegistration =
    typeof candidateRegistration === "object" &&
    candidateRegistration !== null &&
    ALL_ROLES.has(candidateRegistration.role)
      ? candidateRegistration
      : undefined
  const hostRole = roleFromAgent(input)
  const registration =
    directRegistration ?? (hostRole === null ? undefined : registrationForHostRole(registry, hostRole))
  if (registration === undefined) return
  if (!process.env.ZCODE_PLUGIN_ROOT) return

  const observation = {
    actor_id: `role:${registration.role}`,
    candidate_id: null,
    data: {
      invocation_digest: createHash("sha256").update(raw).digest("hex"),
      tool: String(input.toolName ?? input.tool_name ?? "unknown"),
      type: "tool",
    },
    evidence_ids: [],
    files: [],
    metadata: { phase: "completed" },
    model: null,
    project_key: registration.project_key,
    role: LEDGER_ROLE[registration.role] ?? null,
    session_id: sessionId,
    task_id: null,
    timestamp_unix_millis: Date.now(),
    workflow_id: registration.workflow_id,
  }
  const child = spawn(process.execPath, ["mcp/dist/cli.js", "audit"], {
    cwd: process.env.ZCODE_PLUGIN_ROOT,
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
  })
  child.stdin.write(JSON.stringify(observation))
  child.stdin.end()
  child.unref()
}

function roleFromAgent(input) {
  for (const value of [
    input.agent_type,
    input.agentType,
    input.subagent_type,
    input.agent?.type,
    input.context?.agent_type,
  ]) {
    if (typeof value !== "string") continue
    const prefix = value.startsWith("zcode-cycle:")
      ? "zcode-cycle:"
      : value.startsWith("cycle:")
        ? "cycle:"
        : null
    if (prefix === null) continue
    const role = value.slice(prefix.length).replaceAll("-", "_")
    if (ALL_ROLES.has(role)) return role
  }
  return null
}

function registrationForHostRole(registry, role) {
  const projectDirectory = process.env.ZCODE_PROJECT_DIR
  if (!projectDirectory) return undefined
  const candidates = Object.values(registry).filter(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      item.role === role &&
      sameProject(item.project_directory, projectDirectory),
  )
  return candidates.length === 1 ? candidates[0] : undefined
}

function sameProject(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || !left || !right) return false
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

main().catch(() => process.exit(0))
