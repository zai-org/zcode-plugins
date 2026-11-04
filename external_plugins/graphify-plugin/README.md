# Graphify — ZCode Knowledge-Graph Plugin

[![CI](https://github.com/movtigroup/Graphify-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/movtigroup/Graphify-plugin/actions/workflows/ci.yml)
[![Release](https://github.com/movtigroup/Graphify-plugin/actions/workflows/release.yml/badge.svg)](https://github.com/movtigroup/Graphify-plugin/actions/workflows/release.yml)

**EN** — Graphify turns a project directory into a **queryable knowledge graph**: it scans code,
docs and config files, extracts files, symbols, imports and doc references, and produces three
artifacts under `<target>/.graphify/`:

| Artifact | Purpose |
|---|---|
| `graph.json` | nodes (`code`, `doc`, `config`, `symbol`) + edges (`imports`, `contains`, `links`, `mentions`) — queryable with 9 commands |
| `graph.html` | self-contained interactive graph (no CDN, works offline) |
| `graph-report.md` | hubs, orphans (dead-code candidates), external deps, broken doc links |

**FA** — گرافیفای یک پوشهٔ پروژه را به **گراف دانش قابل کوئری** تبدیل می‌کند: کدها، مستندات و
فایل‌های کانفیگ را اسکن می‌کند و سه خروجی می‌سازد؛ بعد ایجنت به‌جای خواندن مکرر فایل‌ها از خود
گراف کوئری می‌گیرد (قلب سیستم، شعاع تأثیر تغییر، کد بی‌استفاده، لینک‌های خراب مستندات).

---

## Install (نصب)

### 1) As a ZCode plugin from this repo (recommended)

1. Open **Plugin Marketplace → Add → Add Plugin Marketplace**
2. Paste: `https://github.com/movtigroup/Graphify-plugin`
3. Install **Graphify** from the list and select the `graphify` skill in the composer picker.

### 2) Manual — copy the skill

```bash
# clone and copy the skill into your user skills directory
git clone https://github.com/movtigroup/Graphify-plugin.git
mkdir -p ~/.agents/skills
cp -r Graphify-plugin/skills/graphify ~/.agents/skills/graphify
```

### 3) Dev marketplace (local folder)

Clone the repo and add its **directory** as a marketplace:
**Plugin Marketplace → Add → Add Plugin Marketplace** → paste the cloned folder path.

---

## Usage (استفاده)

Ask your agent naturally — Persian or English:

```
graphify روی پوشهٔ X اجرا کن و بگو قلب سیستم کجاست
who imports utils.py? تغییرش چه چیزی را می‌شکند؟
این کدبیس رو graphify کن و فایل‌های مرده رو پیدا کن
```

Behind the scenes the agent runs `build_graph.py` once, reads `graph-report.md`, and answers
structural questions via `query_graph.py` (info / hubs / orphans / search / node / neighbors /
imports / imported-by / external). Full command reference in
[`skills/graphify/SKILL.md`](skills/graphify/SKILL.md).

## Requirements (نیازمندی‌ها)

- ZCode (or Claude Code) with plugin/skill support
- Python 3.8+ on PATH (`py -3` on Windows fallback). The scripts are **stdlib-only** — nothing to install.

## Side effects (اثرات جانبی)

- Runs only the two bundled Python scripts (`build_graph.py`, `query_graph.py`) — stdlib-only, **no
  network access**, no third-party code or assets.
- Sole file writes: creates `.graphify/` inside the scanned project (graph.json, graph.html,
  graph-report.md). Output paths are containment-checked (`realpath` + `commonpath`) and cannot
  escape the output directory.
- No credentials, no machine-specific paths, no prebuilt binaries.

## Development (توسعه)

```bash
python tests/validate.py   # manifest + skill structure checks
python tests/smoke_test.py # end-to-end: build + query on the sample fixture
```

CI runs both on **Ubuntu and Windows** for every push/PR; tagged releases (`v*`) are packaged as
zip and published on GitHub Releases automatically.

## Status (وضعیت)

- ✅ Plugin structure per ZCode manifest spec (`.zcode-plugin/plugin.json` + marketplace entry)
- ✅ CI on two OSes + tagged release pipeline
- ✅ Stdlib-only, no network access, writes only `<target>/.graphify/` (containment-checked)
- 🚀 Submitted to the official ZCode plugin marketplace

## License

MIT © Movti Group
