// End-to-end check of the renderer patch against a real ZCode archive. Nothing is written to the archive.
//
// The renderer chunk is read straight from app.asar, and the Markdown parser and KaTeX are loaded from
// the copies that ship inside the same archive, so the check uses ZCode's own code and library versions.
// Each message is run through ZCode's preprocessing functions in the stock state and in the patched
// state, and the math the parser finds must match what the case expects.
//
// Usage: node tests/verify-patch.mjs [<path to app.asar>]
// Without a path, the archive is located the same way patch-renderer.mjs does.

import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { PASS_ORIGINAL, PASS_PATCHED, plan, withEdits, locateAsar, openAsar, findChunks, readAt } = await import(
  pathToFileURL(join(here, "..", "scripts", "patch-renderer.mjs")).href
);

const file = locateAsar(process.argv[2]);
if (!file) {
  console.log("ZCode's app.asar was not found. Pass its path.");
  process.exit(2);
}

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

// Copies the packages the check needs, and what they depend on, out of the archive's node_modules.
function extractDeps(archive, outDir, wanted) {
  const at = (p) => p.split("/").reduce((node, part) => (node && node.files ? node.files[part] : undefined), archive.header);
  const read = (node) => Buffer.from(readAt(archive.fd, archive.dataBase + Number(node.offset), node.size), "latin1");
  const seen = new Set();
  const queue = [...wanted];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const dir = `node_modules/${name}`;
    const manifest = at(`${dir}/package.json`);
    if (!manifest) throw new Error(`the archive does not contain ${dir}`);
    const json = JSON.parse(read(manifest).toString("utf8"));
    const copy = (node, rel) => {
      for (const [childName, child] of Object.entries(node.files)) {
        const childRel = `${rel}/${childName}`;
        if (child.files) copy(child, childRel);
        else if (!child.unpacked) {
          mkdirSync(dirname(join(outDir, childRel)), { recursive: true });
          writeFileSync(join(outDir, childRel), read(child));
        }
      }
    };
    copy(at(dir), dir);
    queue.push(...Object.keys({ ...json.peerDependencies, ...json.dependencies }));
  }
}

const archive = openAsar(file, false);
const work = mkdtempSync(join(tmpdir(), "math-render-fix-verify-"));
try {
  const hits = findChunks(archive);
  console.log(`asar:  ${file}`);
  check("the renderer chunk is recognized exactly once", hits.length === 1, `${hits.length} chunks match`);
  if (hits.length === 1) {
    const { rel, entry, thePlan } = hits[0];
    console.log(`chunk: ${rel} (${thePlan.state})`);
    const source = readAt(archive.fd, archive.dataBase + Number(entry.offset), entry.size);

    // The patch as the script would write it, and back.
    let stockRegion;
    let patchedRegion;
    const head = source.match(new RegExp(PASS_ORIGINAL.source)) ?? source.match(new RegExp(PASS_PATCHED.source));
    check("the preprocessing pass is found", Boolean(head));
    if (head) {
      // Take the pass together with the declarations it uses and the two wrappers stacked on it.
      const declAnchor = source.indexOf("=/(?:^|\\s)language-([^\\s]+)/");
      const start = source.lastIndexOf(",", declAnchor) + 1;
      const endOfFunction = (at) => {
        const open = source.indexOf("{", at);
        let depth = 0;
        for (let i = open; i < source.length; i++) {
          if (source[i] === "{") depth++;
          else if (source[i] === "}" && --depth === 0) return i + 1;
        }
        return -1;
      };
      let end = endOfFunction(head.index);
      for (let k = 0; k < 2 && end > 0; k++) {
        const next = source.indexOf("function ", end);
        end = next > 0 ? endOfFunction(next) : -1;
      }
      if (declAnchor > 0 && start > 0 && end > 0 && end > head.index) {
        const region = "var " + source.slice(start, end);
        const names = [...region.matchAll(/function ([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]);
        const load = (code) =>
          // Read byte-wise, evaluated as the UTF-8 the browser sees.
          new Function(`${Buffer.from(code, "latin1").toString("utf8")}\nreturn { ${names.join(", ")} };`)();

        const now = plan(region);
        stockRegion = now.state === "patched" ? withEdits(region, now.toOriginal) : region;
        patchedRegion = now.state === "patched" ? region : withEdits(region, now.toPatched);
        const stockPlan = plan(stockRegion);
        const patchedPlan = plan(patchedRegion);

        check("stock state is recognized", stockPlan.state === "original", stockPlan.state);
        check("patched state is recognized", patchedPlan.state === "patched", patchedPlan.state);
        check("every replacement keeps its length", [...stockPlan.toPatched, ...patchedPlan.toOriginal].every((e) => e.to));
        check("restore reproduces the stock bytes", withEdits(patchedRegion, patchedPlan.toOriginal) === stockRegion);
        check(
          "a half-applied patch is recognized",
          plan(withEdits(stockRegion, [stockPlan.toPatched[0]])).state === "partly patched" &&
            plan(withEdits(stockRegion, [stockPlan.toPatched[1]])).state === "partly patched"
        );

        const stock = load(stockRegion);
        const patched = load(patchedRegion);
        const wrapper = names.at(-1);

        extractDeps(archive, work, ["mdast-util-from-markdown", "micromark-extension-math", "mdast-util-math", "katex"]);
        const req = createRequire(join(work, "package.json"));
        const loadLib = async (name) => import(pathToFileURL(req.resolve(name)).href);
        const { fromMarkdown } = await loadLib("mdast-util-from-markdown");
        const { math } = await loadLib("micromark-extension-math");
        const { mathFromMarkdown } = await loadLib("mdast-util-math");
        const katex = req("katex");
        const katexVersion = JSON.parse(req("fs").readFileSync(req.resolve("katex/package.json"), "utf8")).version;

        const kindsOf = (text) => {
          const tree = fromMarkdown(text, { extensions: [math({ singleDollarTextMath: true })], mdastExtensions: [mathFromMarkdown()] });
          const found = [];
          const walk = (node) => {
            if (node.type === "math" || node.type === "inlineMath") found.push(node);
            (node.children ?? []).forEach(walk);
          };
          walk(tree);
          return found.map((node) => {
            try {
              katex.renderToString(node.value, { displayMode: node.type === "math", throwOnError: true });
            } catch (error) {
              return `error(${error.message})`;
            }
            return node.type === "math" ? "display" : "inline";
          });
        };

        const none = [];
        const cases = [
          { name: "\\(P_1\\) and \\(P_{\\mathrm{total}}\\) inline, Chinese around", stock: none, patched: ["inline", "inline"],
            text: "总功率由两部分组成：\\(P_1\\) 是输入功率，\\(P_{\\mathrm{total}}\\) 是总功率。" },
          { name: "\\[ ... \\] display block in a message without any $", stock: none, patched: ["display", "inline"],
            text: "推导如下：\n\n\\[\nS=4\\lambda\\frac{P_2}{P_{\\text{total}}}\n\\]\n\n其中 \\(\\lambda = 0.5\\)。" },
          { name: "\\[ ... \\] on one line inside a paragraph", stock: none, patched: ["inline"],
            text: "所以 \\[ S=4\\lambda\\frac{P_2}{P_{\\text{total}}} \\] 成立。" },
          { name: "\\( in a table cell and a list item", stock: none, patched: ["inline", "inline"],
            text: "| 符号 | 含义 |\n|---|---|\n| \\(\\alpha_1\\) | 增益 |\n\n- 第一项 \\(a_1 + b_1\\)\n- 第二项普通文本" },
          { name: "\\( next to $ and $$ in one message", stock: ["inline", "inline"], patched: ["inline", "inline", "inline"],
            text: "设 $$x=1$$，且 \\(y = 2\\)，价格 $5，而 $z^2$ 也成立。" },
          { name: "$$...$$ inline (the form the hooks ask for)", stock: ["inline", "inline"], patched: ["inline", "inline"],
            text: "总功率 $$P_{\\mathrm{total}}$$ 满足 $$\\lambda = 0.5$$。" },
          { name: "$$ on its own lines", stock: ["display"], patched: ["display"],
            text: "推导如下：\n\n$$\nS=4\\lambda\\frac{P_2}{P_{\\text{total}}}\n$$\n\n完毕。" },
          { name: "single dollars that look like math", stock: ["inline", "inline"], patched: ["inline", "inline"],
            text: "值是 $P_{\\mathrm{total}}$ 和 $x^2$。" },
          { name: "single dollars with plain content stay literal", stock: ["inline", "inline"], patched: ["inline", "inline"],
            text: "值是 $ab$ 和 $f(x)$ 以及 $2x$ 和 $vout$。" },
          { name: "dollar amounts are not math", stock: none, patched: none, text: "A costs $5 and B costs $10." },
          { name: "\\( inside a code fence or a code span is left alone", stock: none, patched: none,
            text: "Run this:\n\n```sh\nfind . \\( -name \"*.c\" -o -name \"*.h\" \\)\necho \"\\[x\\]\"\n```\n\nIn LaTeX use `\\(x\\)` or `\\[x\\]`." },
          { name: "shell idiom in plain prose is the known limitation", stock: none, patched: ["inline"],
            text: "To search by name use find . \\( -name foo -o -name bar \\)." },
          { name: "no math and no backslash", stock: none, patched: none, text: "# Title\n\nSome plain text and 100% of it.\n" },
          { name: "a backslash but no math", stock: none, patched: none, text: "配置在 C:\\Users\\test 下，没有公式。\n" },
        ];

        console.log(`\nparser and KaTeX from the archive (katex ${katexVersion}); ${cases.length} messages:`);
        for (const c of cases) {
          const before = kindsOf(stock[wrapper](c.text));
          const after = kindsOf(patched[wrapper](c.text));
          const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
          check(c.name, same(before, c.stock) && same(after, c.patched), `stock ${JSON.stringify(before)} (want ${JSON.stringify(c.stock)}), patched ${JSON.stringify(after)} (want ${JSON.stringify(c.patched)})`);
        }

        // The whole chunk must still parse after the patch. node --check on a copy of the patched chunk.
        const probe = join(work, "chunk-probe.mjs");
        writeFileSync(probe, Buffer.from(withEdits(source, plan(source).state === "patched" ? [] : plan(source).toPatched), "latin1"));
        const syntax = spawnSync(process.execPath, ["--check", probe], { encoding: "utf8" });
        check("the patched chunk parses", syntax.status === 0, (syntax.stderr || "").trim().slice(0, 400));
      } else {
        check("the preprocessing functions can be located in the chunk", false, "this ZCode build arranges the code differently");
      }
    }
  }
} finally {
  closeSync(archive.fd);
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
