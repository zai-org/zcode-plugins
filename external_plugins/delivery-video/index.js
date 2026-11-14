import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const skillRoot = fileURLToPath(new URL("./skills/delivery-video/", import.meta.url));
const skillPath = join(skillRoot, "SKILL.md");

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
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (frontmatter === null) {
    throw new Error(`delivery-video: missing YAML frontmatter in ${skillPath}`);
  }
  const header = parseYaml(frontmatter[1]);
  if (
    header === null ||
    typeof header !== "object" ||
    typeof header.name !== "string" ||
    typeof header.description !== "string"
  ) {
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
    content: source.slice(frontmatter[0].length).trimStart(),
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
