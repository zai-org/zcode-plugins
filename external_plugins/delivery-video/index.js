import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = fileURLToPath(new URL("./skills/delivery-video/", import.meta.url));
const skillPath = join(skillRoot, "SKILL.md");

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

// Our frontmatter subset — flat scalars plus one nested metadata block — parses by hand, keeping the plugin dependency-free.
function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (match === null) {
    throw new Error(`delivery-video: missing YAML frontmatter in ${skillPath}`);
  }
  const header = {};
  let nested = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    const value = unquote(line.slice(colon + 1).trim());
    if (/^\s/.test(rawLine)) {
      if (nested !== null) nested[key] = value;
      continue;
    }
    nested = value === "" ? {} : null;
    header[key] = value === "" ? nested : value;
  }
  return { header, body: source.slice(match[0].length).trimStart() };
}

function readFlag(value, field) {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "yes", "on", "1"].includes(normalized)) return true;
    if (["false", "no", "off", "0"].includes(normalized)) return false;
  }
  throw new Error(`delivery-video: ${field} must be a boolean`);
}

function loadSkill() {
  const source = readFileSync(skillPath, "utf8");
  const { header, body } = parseFrontmatter(source);
  if (typeof header.name !== "string" || typeof header.description !== "string") {
    throw new Error(`delivery-video: invalid skill metadata in ${skillPath}`);
  }
  return {
    name: header.name,
    description: header.description,
    ...(typeof header.whenToUse === "string" ? { whenToUse: header.whenToUse } : {}),
    ...(header.metadata && typeof header.metadata === "object" ? { metadata: header.metadata } : {}),
    invocation: {
      modelInvocable: !readFlag(header["disable-model-invocation"], "disable-model-invocation"),
      userInvocable: !readFlag(header["user-invocable"], "user-invocable"),
    },
    source: "bundled",
    path: skillPath,
    content: body,
    resourceBase: { kind: "directory", path: skillRoot },
  };
}

const skill = loadSkill();

export const name = "delivery-video";
export const inject = ["skills", "agents"];

export function apply(ctx) {
  ctx.skills.register(skill);

  const agentRegistrations = new Map();
  const registerForAgent = (agent) => {
    if (agentRegistrations.has(agent)) return;
    // DSH preset filesystem skills shadow host registrations, so mirror into the nearest Agent layer.
    const injection = agent.ctx.inject(["skills"], (agentCtx) => {
      agentCtx.skills.register(skill);
    });
    agentRegistrations.set(agent, () => injection.dispose());
  };

  for (const agent of ctx.agents.list()) {
    registerForAgent(agent);
  }

  ctx.on("agent/created", ({ agent }) => {
    registerForAgent(agent);
  });

  ctx.on("agent/disposed", ({ agent }) => {
    agentRegistrations.get(agent)?.();
    agentRegistrations.delete(agent);
  });

  ctx.effect(
    () => () => {
      const disposals = [...agentRegistrations.values()].map((dispose) => dispose());
      agentRegistrations.clear();
      return Promise.all(disposals);
    },
    "delivery-video agent registrations",
  );
}
