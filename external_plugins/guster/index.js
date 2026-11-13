import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoots = {
  guster: fileURLToPath(new URL("./skills/guster/", import.meta.url)),
  "guster-hub": fileURLToPath(new URL("./skills/guster-hub/", import.meta.url)),
};

function parseFrontmatter(source, skillPath) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw new Error(`guster: missing YAML frontmatter in ${skillPath}`);
  const header = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#") || /^\s/.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    header[key] = value;
  }
  return { header, body: source.slice(match[0].length).trimStart() };
}

function loadSkill(skillName) {
  const skillRoot = skillRoots[skillName];
  const skillPath = join(skillRoot, "SKILL.md");
  const source = readFileSync(skillPath, "utf8");
  const { header, body } = parseFrontmatter(source, skillPath);
  if (typeof header.name !== "string" || typeof header.description !== "string") {
    throw new Error(`guster: invalid skill metadata in ${skillPath}`);
  }
  return {
    name: header.name,
    description: header.description,
    content: body,
    source: "bundled",
    path: skillPath,
    resourceBase: { kind: "directory", path: skillRoot },
    invocation: { modelInvocable: true, userInvocable: true },
  };
}

const skills = Object.keys(skillRoots).map((skillName) => loadSkill(skillName));

export const name = "guster";
export const inject = ["skills", "agents"];

export function apply(ctx) {
  for (const skill of skills) ctx.skills.register(skill);

  const agentRegistrations = new Map();
  const registerForAgent = (agent) => {
    if (agentRegistrations.has(agent)) return;
    const injection = agent.ctx.inject(["skills"], (agentCtx) => {
      for (const skill of skills) agentCtx.skills.register(skill);
    });
    agentRegistrations.set(agent, () => injection.dispose());
  };

  for (const agent of ctx.agents.list()) registerForAgent(agent);

  ctx.on("agent/created", ({ agent }) => registerForAgent(agent));
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
    "guster agent registrations",
  );
}
