---
name: lbo-model
description: Build or complete LBO (Leveraged Buyout) models in Excel for private equity transactions, deal materials, or investment committee presentations. Works from a user-provided template when one exists, or builds the standard structure (Sources & Uses, Operating Model, Debt Schedule, Returns) from scratch. Fills in formulas, validates calculations, and ensures professional formatting standards.
---

**先载入 `xlsx-author` 技能，再动手建表。** 出处载体（Class A 的 `Source:` 批注 /
Class B 的 `来源` 表加 `来源编号` 列）、四色含义、「填机构不填接口名」、URL 的两种诚实
写法、交付时的 `::zcode-file-citation`，都在那份 SKILL.md 里。只照路径调它的
`recalc.py` 不等于读过它——2026-08-24 那批里有一份工作簿正是这样，五项全漏。

## TEMPLATE HANDLING

Before starting any LBO model:
1. **If a template file is attached/provided**: Use that template's structure exactly - copy it and populate with the user's data. Even if the template seems complex or has more features than needed, copy it and adapt it to the user's requirements. Never decide to "build from scratch" when a template is provided.
2. **If no template is attached**: Ask the user: *"Do you have a specific LBO template you'd like me to use? If not, I'll build the standard structure: Transaction Assumptions, Sources & Uses, Operating Model, Debt Schedule, Returns Analysis, and Sensitivity Tables."*
3. **If building from scratch (standard structure)**: Create one workbook with these sections, in dependency order:
   - **Transaction Assumptions** — entry EV/EBITDA multiple, purchase price, financing structure (tranche sizes, rates), fees, exit year, exit multiple. All blue inputs, each carrying a `Source:` cell comment; an input you judged rather than retrieved is labelled `[测算]` in that comment and also written into the model's assumptions block with its rationale. Never an unexplained hardcode.
   - **Sources & Uses** — two balancing tables; sponsor equity is typically the plug on the Sources side.
   - **Operating Model** — revenue build, margins, EBITDA → unlevered FCF available for debt paydown, projected over the hold period.
   - **Debt Schedule** — one block per tranche: beginning balance, mandatory amortization, cash sweep (respecting the priority waterfall), interest on **beginning** balance, ending balance.
   - **Returns Analysis** — exit EV, debt at exit, exit equity, sponsor cash flows, IRR and MOIC.
   - **Sensitivity Tables** — IRR/MOIC grids (entry multiple × exit multiple, leverage × exit multiple), odd dimensions, base case in the center cell.

---

## CRITICAL INSTRUCTIONS FOR CLAUDE - READ FIRST

### Environment

Build the workbook with Python/openpyxl following the `xlsx-author` skill conventions. Write formula strings (`ws["D20"] = "=B5*B6"`), then run the recalc script (`../xlsx-author/scripts/recalc.py`, relative to this skill's directory) before delivery.

### Core Principles
* **Every calculation must be an Excel formula** - NEVER compute values in Python and hardcode results into cells. When using openpyxl, write `cell.value = "=B5*B6"` (formula string), NOT `cell.value = 1250` (computed result). The model must be dynamic and update when inputs change.
* **Use the template structure** - Follow the user's provided template when one exists, or the standard structure defined in TEMPLATE HANDLING above. Do not invent a different layout mid-build.
* **Use proper cell references** - All formulas should reference the appropriate cells. Never type numbers that should come from other cells.
* **Maintain sign convention consistency** - Follow whatever sign convention the template uses (some use negative for outflows, some use positive). Be consistent throughout.
* **Work section by section, verify with user at each step** - Complete one section fully, show the user what was built, run the section's verification checks, and get confirmation BEFORE moving to the next section. Do NOT build the entire model end-to-end and then present it — later sections depend on earlier ones, so catching a mistake in Sources & Uses after the returns are already built means rework everywhere.

### Formula Color Conventions

Four colours, not three — the fourth (purple) is the one models most often drop, and audits check for it.

* **Blue (`#0000FF`)**: Hardcoded inputs - typed numbers that don't reference other cells
* **Black (`#000000`)**: Formulas with calculations - any formula using operators or functions (`=B4*B5`, `=SUM()`, `=-MAX(0,B4)`)
* **Purple (`#800080`)**: Links to cells on the **same tab** - direct references with no calculation (`=B9`, `=B45`)
* **Green (`#008000`)**: Links to cells on **different tabs** - cross-sheet references (`=Assumptions!B5`, `='Operating Model'!C10`)

### Cell Comments — this skill's citation vehicle (`cell_comments`)

An LBO model is a workbook, not prose, so its sourcing lives in cell comments rather than a Sources section.

* **Every hardcoded input cell** (every blue cell) carries:
  `Source: <System or Document>, <Date>, <Reference>, <URL if applicable>`
  e.g. `Source: FY2024 10-K, 2025-02-01, p.62 long-term debt note, https://…`
* Add the comment **as the cell is created**, not at the end.
* **A calculated cell carries a formula instead of a source comment.** The formula is its own provenance — so a source comment sitting on a calculated cell means a hardcode is hiding in it. Find it and replace it with the formula.
* Purple and green link cells need no comment either: the reference says where the number came from.
* An input you assumed rather than retrieved is `[测算]` in the comment **and** an entry in the assumptions block. An input you cannot source is not written — if a cell must hold something, write `n.d.`

### Fill Color Palette — Professional Blues & Greys (Default unless user/template specifies otherwise)
* **Keep it minimal** — only use blues and greys for cell fills. Do NOT introduce greens, yellows, reds, or multiple accents. A professional LBO model uses restraint.
* **Default fill palette:**
  * **Section headers** (Sources & Uses, Operating Model, etc.): Dark blue `#1F4E79` with white bold text
  * **Column headers** (Year 1, Year 2, etc.): Light blue `#D9E1F2` with black bold text
  * **Input cells**: Light grey `#F2F2F2` (or just white) — the blue *font* is the signal, fill is secondary
  * **Formula/calculated cells**: White, no fill
  * **Key outputs** (IRR, MOIC, Exit Equity): Medium blue `#BDD7EE` with black bold text
* **That's the whole palette.** 3 blues + 1 grey + white. If the template uses its own colors, follow the template instead.
* Note: The blue/black/purple/green **font** colors above are for distinguishing inputs vs formulas vs links. Those are separate from the **fill** palette here — both work together.

### Number Formatting Standards
* **Currency**: `$#,##0;($#,##0);"-"` or `$#,##0.0` depending on template
* **Percentages**: `0.0%` (one decimal)
* **Multiples**: `0.0"x"` (one decimal)
* **MOIC/Detailed Ratios**: `0.00"x"` (two decimals for precision)
* **All numeric cells**: Right-aligned

---

### Clarify Requirements First

Before filling any formulas:

* **Examine the template structure** - Identify all sections, understand the timeline (which columns are which periods), note any existing formulas
* **Ask the user if anything is unclear** - If the template structure, calculation methods, or requirements are ambiguous, ask before proceeding
* **Confirm key assumptions** - Any key inputs, calculation preferences, or specific requirements
* **ONLY AFTER understanding the template**, proceed to fill in formulas

---

## TEMPLATE ANALYSIS PHASE - DO THIS FIRST

Before filling any formulas, examine the template thoroughly:

1. **Map the structure** - Identify where each section lives and how they relate to each other. Note which sections feed into others.

2. **Understand the timeline** - Which columns represent which periods? Is there a "Closing" or "Pro Forma" column? Where does the projection period start?

3. **Identify input vs formula cells** - Templates often use color coding, borders, or shading to indicate which cells need inputs vs formulas. Respect these conventions.

4. **Read existing labels carefully** - The row labels tell you exactly what calculation is expected. Don't assume - read what the template is asking for.

5. **Check for existing formulas** - Some templates come partially filled. Don't overwrite working formulas unless specifically asked.

6. **Note template-specific conventions** - Sign conventions, subtotal structures, how sections are organized, whether there are separate tabs for different components, etc.

---

## FILLING FORMULAS - GENERAL APPROACH

For each cell that needs a formula, follow this hierarchy:

### Step 1: Check the Template
* Does the cell already have a formula? If yes, verify it's correct and move on.
* Is there a comment or note indicating the expected calculation?
* Does the row/column label make the calculation obvious?
* Do neighboring cells show a pattern you should follow?

### Step 2: Check the User's Instructions
* Did the user specify a particular calculation method?
* Are there stated assumptions that affect this formula?
* Any special requirements mentioned?

### Step 3: Apply Standard Practice
* If neither template nor user specifies, use standard LBO modeling conventions
* Document any assumptions you make
* If genuinely uncertain, ask the user

---

## COMMON PROBLEM AREAS

The following calculation patterns frequently cause issues across LBO models. Pay special attention when you encounter these:

### Balancing Sections
* When two sections must equal (e.g., Sources = Uses), one item is typically the "plug" (balancing figure)
* Identify which item is the plug and calculate it as the difference

### Tax Calculations
* Tax formulas should only reference the relevant income line and tax rate
* Should NOT reference unrelated sections (e.g., debt schedules)
* Consider whether losses create tax shields or are simply ignored

### Interest and Circular References
* Interest calculations can create circularity if they reference balances affected by cash flows
* Use **Beginning Balance** (not average or ending) to break circular references
* Pattern: Interest → Cash Flow → Paydown → Ending Balance (if interest uses ending balance, this circles back)

### Debt Paydown / Cash Sweeps
* When multiple debt tranches exist, there's usually a priority order
* Cash sweep should respect the priority waterfall
* Balances cannot go negative - use MAX or MIN functions appropriately

### Returns Calculations (IRR/MOIC)
* Cash flows must have correct signs: Investment = negative, Proceeds = positive
* If using XIRR, need corresponding dates
* If using IRR, cash flows should be in consecutive periods
* MOIC = Total Proceeds / Total Investment

### Sensitivity Tables
* **Use ODD dimensions** (5×5 or 7×7) — never 4×4 or 6×6. Odd dimensions guarantee a true center cell.
* **Center cell = base case.** Build the row and column axis values symmetrically around the model's actual assumptions (e.g., if base entry multiple = 10.0x, axis = `[8.0x, 9.0x, 10.0x, 11.0x, 12.0x]`). The center cell's IRR/MOIC MUST then equal the model's actual IRR/MOIC output — this is the proof the table is wired correctly.
* **Highlight the center cell** — medium-blue fill (`#BDD7EE`) + bold font so the base case is visually anchored.
* Excel's DATA TABLE function may not work with openpyxl — instead write explicit formulas that reference row/column headers
* Each cell should show a DIFFERENT value — if all same, formulas aren't varying correctly
* Use mixed references (e.g., `$A5` for row input, `B$4` for column input)

---

## VERIFICATION CHECKLIST - RUN AFTER COMPLETION

### Run Formula Validation
```bash
python3 ../xlsx-author/scripts/recalc.py model.xlsx 30
```
(Path is relative to this skill's directory; the script ships with the plugin's `xlsx-author` skill.) It recalculates a **temp copy**, so your workbook — and the cell comments carrying its sources — is not overwritten. Must return `"status": "success"` with zero errors.

Exit codes are meaningful: `0` clean, `2` errors found, `3` recalc unavailable (LibreOffice missing — static lint only, **NOT a pass**), `1` hard failure. On exit `3`, run `xlsx-author`'s substitute checks (reference check, independent recompute, identity checks) and record in the coverage block that the formulas were never evaluated.

### Section Balancing
- [ ] Any sections that must balance (Sources/Uses, Assets/Liabilities) balance exactly
- [ ] Plug items are calculated correctly as the balancing figure
- [ ] Amounts that should match across sections are consistent

### Income/Operating Projections
- [ ] Revenue/top-line builds correctly from drivers or growth rates
- [ ] All cost and expense items calculated appropriately
- [ ] Subtotals and totals sum correctly
- [ ] Margins and ratios are reasonable
- [ ] Links to assumptions are correct

### Balance Sheet (if applicable)
- [ ] Assets = Liabilities + Equity (must balance)
- [ ] All items link to appropriate schedules or roll-forwards
- [ ] Beginning balances = prior period ending balances
- [ ] Check row included and shows zero

### Cash Flow (if applicable)
- [ ] Starts with correct income figure
- [ ] Non-cash items added/subtracted appropriately
- [ ] Working capital changes have correct signs
- [ ] Ending Cash = Beginning Cash + Net Cash Flow
- [ ] Cash balances are consistent across statements

### Supporting Schedules
- [ ] Roll-forward schedules balance (Beginning + Changes = Ending)
- [ ] Schedules link correctly to main statements
- [ ] Calculated items use appropriate drivers
- [ ] All periods are calculated consistently

### Debt/Financing Schedules (if applicable)
- [ ] Beginning balances tie to sources or prior period
- [ ] Interest calculated on appropriate balance (typically beginning)
- [ ] Paydowns respect cash availability and priority
- [ ] Ending balances cannot be negative
- [ ] Totals sum tranches correctly

### Returns/Output Analysis
- [ ] Exit/terminal values calculated correctly
- [ ] All relevant adjustments included
- [ ] Cash flow signs are correct (negative for investment, positive for proceeds)
- [ ] IRR/MOIC formulas reference complete ranges
- [ ] Results are reasonable for the scenario

### Sensitivity Tables (if applicable)
- [ ] Grid dimensions are ODD (5×5 or 7×7) — there is a true center cell
- [ ] Row and column axis values are symmetric around the base case (`[base-2Δ, base-Δ, base, base+Δ, base+2Δ]`)
- [ ] Center cell output equals the model's actual IRR/MOIC — confirms the table is wired correctly
- [ ] Center cell is highlighted (medium-blue fill `#BDD7EE`, bold font)
- [ ] Row and column headers contain appropriate input values
- [ ] Each data cell contains a formula (not hardcoded)
- [ ] Each data cell shows a DIFFERENT value
- [ ] Values move in expected directions (higher exit multiple → higher IRR, etc.)

### Formatting
- [ ] Hardcoded inputs are blue (`#0000FF`)
- [ ] Calculated formulas are black (`#000000`)
- [ ] Same-tab links are purple (`#800080`)
- [ ] Cross-tab links are green (`#008000`)
- [ ] Every blue cell has a `Source: <System or Document>, <Date>, <Reference>, <URL if applicable>` comment
- [ ] No calculated cell carries a source comment (if one does, a hardcode is hiding in it)
- [ ] All numbers are right-aligned
- [ ] Appropriate number formats applied throughout
- [ ] No cells show error values (#REF!, #DIV/0!, #VALUE!, #NAME?)

### Logical Sanity Checks
- [ ] Numbers are reasonable order of magnitude
- [ ] Trends make sense (growth, decline, stabilization as expected)
- [ ] No obviously wrong values (negative where should be positive, impossible percentages, etc.)
- [ ] Key outputs are within reasonable ranges for the type of analysis

---

## COMMON ERRORS TO AVOID

| Error | What Goes Wrong | How to Fix |
|-------|-----------------|------------|
| Hardcoding calculated values | Model doesn't update when inputs change | Always use formulas that reference source cells |
| Wrong cell references after copying | Formulas point to wrong cells | Verify all links, use appropriate $ anchoring |
| Circular reference errors | Model can't calculate | Use beginning balances for interest-type calcs, break the circle |
| Sections don't balance | Totals that should match don't | Ensure one item is the plug (calculated as difference) |
| Negative balances where impossible | Paying/using more than available | Use MAX(0, ...) or MIN functions appropriately |
| IRR/return errors | Wrong signs or incomplete ranges | Check cash flow signs and ensure formula covers all periods |
| Sensitivity table shows same value | Formula not varying with inputs | Check cell references - need mixed references ($A5, B$4) |
| Roll-forwards don't tie | Beginning ≠ prior ending | Verify links between periods |
| Inconsistent sign conventions | Additions become subtractions or vice versa | Follow template's convention consistently throughout |

---

## WORKING WITH THE USER — SECTION-BY-SECTION CHECKPOINTS

* **If the user's requirements conflict with the template**, say which you followed and why — then build.
* **After completing each major section**, show the work in the running message and keep going:
  - **After Sources & Uses** → the balanced table, with the plug identified
  - **After Operating Model / Projections** → the projected P&L with its growth rates and margins
  - **After Debt Schedule** → beginning/ending balances, interest, and the waterfall logic
  - **After Returns (IRR/MOIC)** → the cash-flow series and outputs, signs and ranges checked
  - **After Sensitivity Tables** → evidence that each cell varies and the base case lands on the model's own output
* **If errors are found during your own verification**, fix them before moving to the next section

- **Do not wait for a reply between stages.** The review gate is at the end,
  between the finished workbook and its use — not between the request and the
  build (the human-review guardrail). Judged inputs go into the
  assumptions block flagged `待确认` with the alternative considered, so the
  reviewer overturns them in one cell.
- The early-error worry is already handled by the formulas-over-hardcodes rule
  above: a model that flexes makes a wrong assumption a one-cell edit rather
  than a downstream rebuild. Structure solves it; asking does not.
- **Ask only when the subject itself is missing** — the template structure is
  genuinely unreadable, an entity resolves to several, a required statement is
  absent from the file. A value you could reasonably pick is never a reason to
  stop; a missing input blocks its own line, not the deliverable.
* **Show your work** - explain key formulas or assumptions when helpful
* **Never present a completed model without having checked in at each section** — it's faster to catch a wrong cell reference at the source than to trace it backwards from a broken IRR

---

## DELIVERING THE MODEL — COVERAGE BLOCK

The workbook's sources live in its cell comments. The message that hands it over
carries the honesty about what those cells rest on. Close every delivery with
this block, verbatim heading, even when everything passed:

```
## 覆盖范围与局限
Retrieved: <timestamp>

- Historicals: <which financials/periods were retrieved and from where — e.g.
  FY2022–FY2024 revenue, EBITDA and debt balances from the FY2024 10-K; entry
  multiple from the announced transaction terms>
- Analyst assumptions (not retrieved data): <the inputs you judged rather than
  sourced — exit multiple, hold period, margin path, sweep percentage, tranche
  pricing where not documented. Each is also `[测算]` in its cell comment and in
  the assumptions block>
- Formula evaluation: <one of> recalc.py evaluated all N formulas via
  LibreOffice, zero errors (exit 0) / recalc.py could NOT evaluate the formulas
  (exit 3, LibreOffice unavailable) — only a static lint plus the openpyxl
  reference/recompute/identity checks ran; the model is NOT verified and the
  user should confirm the numbers on open
- Not covered: <sources that failed or were out of scope, and what they would
  have covered>
```

`recalc_unavailable` is not a pass — `xlsx-author`'s honesty protocol says so
explicitly. A model delivered without formula evaluation states that here, in
plain words, and is never described as "verified" or "audited".

---

**This skill produces investment banking-quality LBO models by filling templates with correct formulas, proper formatting, and validated calculations. The skill adapts to any template structure while ensuring financial accuracy and professional presentation standards.**
