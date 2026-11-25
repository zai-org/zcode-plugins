# Exam Builder

Build exam papers from your own question bank: check the bank, draw papers by type, chapter and difficulty, make A/B sets that don't share questions, and export print-ready PDFs with separate answer keys.

## Features

- **Question bank**:
  - Markdown: `# Chapter`, then each question starts with `## 单选 | 易 | 5分 | id: F-01` (types: 单选/多选/判断/填空/解答 or single/multi/tf/fill/short; difficulty 易/中/难, easy/medium/hard or 1–5). The stem follows, then options `A. …`, `答案：…`, `解析：…`.
  - Excel/CSV: one question per row with columns ID, Type, Chapter, Difficulty, Score, Question, A–D, Answer, Explanation, Image (Chinese headers such as 题型/章节/难度/题干/答案/解析 also work).
  - LaTeX in `$…$` and `$$…$$`; images as `![](img/figure.png)` relative to the bank file.
- **Checks**: missing answers, answers that aren't among the options, choice questions without options, missing image files, LaTeX errors, unpaired `$`, unknown types, and duplicates (same id or same stem). Each problem is shown with file and line; flagged questions are left out of papers until fixed.
- **Building**:
  - Per type: how many questions and the points each. Points default to the question's own score, then single 5, multi 6, true/false 2, fill-in 5, problem 12.
  - Optional chapters and easy:medium:hard ratio. If a level runs short, nearby levels fill in and you're told.
  - 1–10 sets (A, B, …) that never share a question. The same seed and bank always give the same papers.
  - Swap any single question for an unused one of the same type and difficulty.
- **Export** (to `exams/<title>/`):
  - Paper PDF: A4 with a header (title, set, time, total), a name/class/score line, and section heads like 「一、单项选择题（本题共 6 小题，每小题 5 分，共 30 分）」. Formulas are vector paths (MathJax), and images are embedded. Options sit 4, 2 or 1 per row depending on length. Problems get answer space, questions aren't split across pages when they fit, and pages are numbered.
  - Answer-key PDF with answers and explanations.
  - HTML versions of both, self-contained with inline SVG formulas and embedded images.
  - `paper.json` listing the question ids per set.
- **Panel**: pick banks; see counts by chapter × type and the problem list; set the rules; preview each set as paper or key; hover a question to swap it; export.

## Usage

Ask the agent in ZCode Desktop:

- "Build a mid-term paper from my question bank: 8 single-choice, 3 fill-in, 2 problems, easy:medium:hard 5:3:2"
- "Make an A and a B paper with no overlapping questions"
- "Check my question bank for missing answers and broken formulas"

## Tools

| Tool | Purpose |
|---|---|
| `exam_bank` | Load and check question banks; counts by chapter, type and difficulty |
| `exam_build` | Draw one or more sets by the rules |
| `exam_swap` | Replace one question in a set |
| `exam_export` | Write paper and answer-key PDFs, HTML and paper.json |

## Scope (v0.1)

- No Word (.docx) banks or Word equation objects, and no online exams or grading.
- Chinese headings by default when the bank is Chinese, English otherwise. A4 only.
- Images must be PNG or JPEG for the PDF; the HTML also takes GIF, SVG and WebP.

## Privacy, network and files

- Runs locally: no network access, no API keys. Bank files are never modified.
- Writes `.exam-builder/project.json` (banks, rules, chosen questions) and `exams/<title>/`. No hooks.
- PDF text uses a system font with Chinese glyphs (PingFang / Songti / Noto CJK …), subset-embedded.

## Build and test (developers)

- Source: `ui-plugins/exam-builder/`.
- Build: `pnpm install --frozen-lockfile && pnpm build`, then add `dist/local-marketplace` as a local source.
- Tests: `pnpm --filter @penova/plugin-exam-builder test`. `EXAM_SAMPLES` points to the fictional sample banks. `test:e2e` needs Chrome.

## Third-party components and licenses

MIT licensed (author: Penova). Bundled: MathJax (mathjax-full, Apache-2.0), pdf-lib (MIT), fontkit (MIT), exceljs (MIT), MCP SDK and ext-apps (MIT), zod (MIT); the full list is in `dist/THIRD_PARTY_NOTICES.txt`. The exceljs streaming reader (unzipper) is not used and is replaced with an empty module.
