import { fileURLToPath } from "node:url";
import { apply as applySkillFilesystem } from "@deepseek-ai/dsh-skill-filesystem";

const skillsRoot = fileURLToPath(new URL("./skills/", import.meta.url));

export const name = "dsh-openspec-baton";
export const inject = ["skills"];

export function apply(ctx) {
  applySkillFilesystem(ctx, {
    providerName: name,
    includeDefaultRoots: false,
    bundledSkillDir: skillsRoot,
    watch: false,
  });
}
