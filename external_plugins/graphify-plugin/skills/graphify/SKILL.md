---
name: graphify
description: >
  Build a queryable knowledge graph of a codebase — code, docs and config files — and answer
  structural questions from the graph instead of re-reading the whole repo. Produces graph.json
  (queryable), graph.html (interactive), graph-report.md (summary). Use whenever the user says
  "graphify", asks for a knowledge graph, project map, architecture or dependency overview,
  asks "who imports X", "where is X used", "how is this repo structured", or in Persian:
  گراف دانش، نقشه پروژه، ساختار پروژه، گراف وابستگی. Trigger even when the user just wants to
  understand a codebase before changing it.
---

# Graphify — codebase knowledge graph (گراف دانش کدبیس)

Scan a project directory, build a knowledge graph of what is in it and how things connect, then
answer structural questions from that graph instead of loading file after file into context.

> 🇮🇷 این اسکیل یک پوشهٔ پروژه را اسکن می‌کند، گراف دانشی از محتوا و ارتباط‌ها می‌سازد و بعد سؤال‌های ساختاری را از خود گراف جواب می‌دهد — نه با خواندن تک‌تک فایل‌ها.

## Artifacts — everything lands in `<target>/.graphify/`

| File | Purpose |
|---|---|
| `graph.json` | nodes (`code`, `doc`, `config`, `symbol`) + edges (`imports`, `contains`, `links`, `mentions`) |
| `graph.html` | self-contained interactive graph — give this path to the user to open in a browser |
| `graph-report.md` | summary: hubs, orphans, external deps, missing links — **read this first** |

> 🇮🇷 سه خروجی: JSON قابل کوئری، HTML تعاملی برای مرورگر، و گزارش مارک‌داون برای شروع.

## Workflow

1. If the target root is ambiguous, ask the user; otherwise default to the current working directory.
2. Build the graph (replace `<skill_dir>` with this skill's base directory, and `<target>` with the project root):
   ```bash
   python "<skill_dir>/scripts/build_graph.py" "<target>"
   ```
   On Windows, if `python` is not found use `py -3`. The script is stdlib-only — nothing to install.
3. Read `<target>/.graphify/graph-report.md` — it is short and answers most overview questions on its own.
4. For anything more specific, query the graph with `query_graph.py` (below) **instead of reading many
   source files**. That is the whole point: a graph lookup is far cheaper than re-reading the repo.
5. Give the user the path to `graph.html` and summarize what you found.

> 🇮🇷 مراحل: بساز → گزارش را بخوان → برای سؤال‌های دقیق‌تر از گراف کوئری بگیر → مسیر HTML را به کاربر بده.

## Querying

```bash
python "<skill_dir>/scripts/query_graph.py" "<target>/.graphify/graph.json" <command>
```

| Command | Answers |
|---|---|
| `info` | size, node/edge counts, top external dependencies |
| `hubs [N]` | most-connected files — the core of the system |
| `orphans` | code files nothing imports — dead-code candidates |
| `search <term>` | find nodes by name or path |
| `node <ref>` | full detail + direct edges of one node |
| `neighbors <ref> [--kind K] [--dir in/out]` | first-degree graph around a node |
| `imports <ref>` | what this file imports (project-internal only) |
| `imported-by <ref>` | what depends on this file — the blast radius of changing it |
| `external [N]` | top third-party packages |

`<ref>` accepts a full node id (`src/app.py`), a bare file name (`app.py`), or a symbol id
(`src/app.py::main`). If several nodes match, the script lists them — pick the right one and re-run.
Add `--json` to any command for raw JSON output.

> 🇮🇷 دستورهای کلیدی: `hubs` قلب سیستم را نشان می‌دهد، `imported-by` شعاع تأثیر تغییرها، `orphans` کد بی‌استفاده.

## Reading the graph

- Edge kinds: `imports` (file→file), `contains` (file→symbol), `links` (doc→file via markdown link),
  `mentions` (doc references a path in backticks).
- Symbol nodes are `file.py::name`. Treat them as cheap pointers: answer "where is X defined/used"
  from the graph; open the real file only when the user needs the implementation itself.

> 🇮🇷 انواع یال: `imports` واردکردن فایل، `contains` داشتن نماد، `links` لینک مارک‌داون، `mentions` اشارهٔ متنی به مسیر.

## Limits (so you don't over-promise)

- Static and heuristic: regex/AST over text. Dynamic imports, reflection and re-exports may be missed.
  A missing import edge is *not* a bug report.
- Scope is code + text docs + configs. Images, PDFs, binaries and notebooks are skipped.
- Very large repos: the HTML renders the 600 most-connected nodes (the JSON always has everything).
- The graph is a snapshot. If the user just made big edits, rebuild before answering.

> 🇮🇷 محدودیت‌ها: تحلیل ایستا و تقریبی است؛ فقط کد، متن و کانفیگ؛ در مخزن‌های خیلی بزرگ HTML تا ۶۰۰ گرهٔ پرارتفاع را نشان می‌دهد؛ بعد از تغییرهای بزرگ گراف را دوباره بساز.
