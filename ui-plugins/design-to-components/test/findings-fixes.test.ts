import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixImports, flatName } from "../src/server.ts";
import { mkclient } from "./_mkclient.ts";

describe("DRYRUN: nested component paths are flattened", () => {
  it("maps the common nested layouts to src/<file> and rejects the rest", () => {
    expect(flatName("src/components/Button/Button.tsx")).toBe("Button.tsx");
    expect(flatName("src/Button/Button.css")).toBe("Button.css");
    expect(flatName("components/Card.tsx")).toBe("Card.tsx");
    expect(flatName("./src/Tag.tsx")).toBe("Tag.tsx");
    expect(flatName("Tag.tsx")).toBe("Tag.tsx");
    expect(flatName("src/components/Button/index.ts")).toBeNull();
    expect(flatName("src/a/b/Button.tsx")).toBeNull();
    expect(flatName("../evil.ts")).toBeNull();
    expect(flatName("src/Button.js")).toBeNull();
  });
  it("fixes relative imports after flattening", () => {
    expect(fixImports('import { tokens } from "../../../tokens";\nimport "./Button.css";\nimport { Icon } from "../Icon/Icon";'))
      .toBe('import { tokens } from "../tokens";\nimport "./Button.css";\nimport { Icon } from "./Icon";');
  });
  it("dc_write accepts src/components/Tag/Tag.tsx end to end", async () => {
    const { root, call, text } = await mkclient("dc-nested-");
    expect((await call("dc_new", { name: "中文 Kit" })).isError).toBeFalsy();
    const tsx = 'import "./Tag.css";\nexport function Tag({ label }: { label: string }) { return <span className="tag">{label}</span>; }\nexport const examples = [{ name: "Default", render: () => <Tag label="标签" /> }];\n';
    const r = await call("dc_write", { files: { "src/components/Tag/Tag.tsx": tsx, "src/components/Tag/Tag.css": ".tag { color: var(--color-text, #111); }\n" } });
    expect(r.isError, text(r)).toBeFalsy();
    expect(text(r)).toContain("src/components/Tag/Tag.tsx → src/Tag.tsx");
    const dir = (r.structuredContent?.kit?.dir as string) ?? "ui-kit/kit";
    expect(existsSync(join(root, "ui-kit")) ).toBe(true);
    expect((r.structuredContent.issues ?? []).filter((i: any) => i.severity === "error")).toEqual([]);
    void dir;
  });
});

describe("TEST-FINDINGS #6: dc_new with dir pointing at a file", () => {
  it("returns not_a_folder instead of EEXIST", async () => {
    const { root, call, text } = await mkclient("dc-file-");
    writeFileSync(join(root, "设计.pdf"), "x");
    for (const dir of ["设计.pdf", "设计.pdf/sub"]) {
      const r = await call("dc_new", { name: `Kit ${dir.length}`, dir });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("not_a_folder");
      expect(text(r)).not.toMatch(/EEXIST|ENOTDIR|internal_error/);
    }
  });
});
