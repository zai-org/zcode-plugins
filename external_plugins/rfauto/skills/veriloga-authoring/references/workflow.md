# Workflow: write → parse → fix (the read/write loop with the kernel)

> The kernel (`src/rfauto/core/veriloga_parser.py`) reads; this skill
> writes. The loop below is the only accepted way to finish a .va artifact
> under this skill: **an artifact that has not passed the parse self-check
> at the clean bar is not done** — regardless of how plausible the text
> looks.

## 0. Invocation paths

- Primary (always works, offline): the service entry —
  `rfauto.service.veriloga_service.parse_veriloga_file(path)` returns the
  standard JSON envelope:
  - success: `{"ok": True, "path", "modules", "module_order",
    "disciplines", "attributes", "warnings", "stats"}` — note `warnings`
    rides along inside the ok envelope (fail-soft family);
  - failure: error envelope (`ok=False`, `errors` list) for unreadable
    files, fatal lexical errors, and files with no `module` declaration.
- Lower-level (core): `rfauto.core.veriloga_parser.parse_veriloga(text)`
  returns the raw document dict (raises `VerilogAParseError` /
  `ExpressionNormError` is absorbed into warnings per the kernel's
  fail-soft rules).
- Consumers for review: `veriloga_module_summary(doc, name)`,
  `veriloga_param_table(doc)`, `veriloga_contribution_pairs(doc)`.
- CLI note: a `rfauto veriloga parse/report` leaf exists as an orphan typer
  domain pending main-app wiring — do not rely on the CLI leaf; use the
  service path above.

## 1. The loop

1. **Write** the module per the golden rules (SKILL.md) and the grammar
   subset (`accepted-grammar.md`). Avoid every row of the discouraged table.
2. **Self-check**:

```python
from rfauto.service.veriloga_service import parse_veriloga_file

result = parse_veriloga_file("my_model.va")
assert result["ok"], result["errors"]
assert result["warnings"] == [], result["warnings"]
assert all(c["rhs_prefix_tree"] is not None
           for m in result["modules"].values()
           for c in m["analog"]["contributions"])
```

3. **Fix**: map each warning/error through `common-rejections.md` (message
   fragment → cause → fix), edit the .va, and re-run step 2. One defect at
   a time if the file is large; the warning's `line` field points at the
   offending text.
4. **Review the structure, not just ok**: ports all have directions,
   parameters all typed with intended ranges, contributions' LHS strings are
   exactly the intended `V(...)`/`I(...)` access forms (silent traps in
   `common-rejections.md` §3 produce zero warnings).
5. Stop only at the **clean bar**: `ok=True`, zero warnings, all
   contribution trees non-None, ports/params complete as intended.

## 2. Worked example

Draft v1 — plausible-looking, two real defects planted (a bitwise `&`
mistaken for multiplication, and a missing `endmodule`):

```va-warned
// v1 — NOT clean: bitwise '&' in RHS + missing endmodule
module gain_stage (in, out);
  electrical in, out;
  parameter real g = 1.0 from (0:inf);
  parameter integer bypass = 0;
  analog begin
    if (bypass > 0)
      V(out) <+ V(in);
    else
      V(out) <+ g & V(in);
  end
```

Self-check reports (paraphrased from the envelope):

- `warnings[0].name == "expr_normalize_failed"` — the `&` operator is not in
  the precedence closed set, so the second contribution's RHS kept its raw
  text but lost the tree (`rhs_prefix_tree is None`).
- `warnings[1].name == "unterminated_module"` — EOF before `endmodule`.

Fixes: `g & V(in)` → `g * V(in)`; append `endmodule`. Re-check → v2:

```va
// v2 — clean: ok=True, zero warnings, all RHS trees non-None
module gain_stage (in, out);
  electrical in, out;
  parameter real g = 1.0 from (0:inf);
  parameter integer bypass = 0;
  analog begin
    if (bypass > 0)
      V(out) <+ V(in);
    else
      V(out) <+ g * V(in);
  end
endmodule
```

Readback worth eyeballing after the fix (all zero-warning here, and the LHS
strings prove no label leakage):

- `module_order == ["gain_stage"]`; ports `[{"dir": "input", "name": "in"},
  {"dir": "output", "name": "out"}]`;
- `params[0]["range"]["raw"] == "(0:inf)"` (open-open interval preserved);
- contribution LHS `V(out)`; tree `["*", "g", ["V", "in"]]` — the parameter
  reference stays a bare identifier (no evaluation anywhere; rule 7).

## 3. Package contract (drift pin)

`tests/unit/test_veriloga_authoring_skill.py` re-parses every ```va block in
this package every run:

- ```va → clean bar (zero warnings, all trees non-None, at least one module);
- ```va-rejected → must raise `VerilogAParseError`;
- ```va-warned → must parse with at least one warning or a None tree.

If you edit these documents, run:

```
python -m pytest tests/unit/test_veriloga_authoring_skill.py -q
```

A red here means the documents and the kernel disagree — fix the document
(or record that the kernel changed, for the kernel owner to arbitrate). The
kernel is never edited from the writing side.

## 4. Honest boundaries

- This skill covers **grammar and workflow only**. It contains no physical
  values: every numeric literal in its examples is a structural placeholder,
  and real parameter values must come from deterministic kernels or user
  specifications (rfauto rule 7).
- rfauto's Verilog-A face is structural parsing; there is no .va simulator,
  compiler, or netlister in the repo. Questions about simulation semantics
  are out of scope.
- The accepted subset is the kernel's structural subset — not the full
  Verilog-AMS LRM. When in doubt, the parser is the arbiter: write it, run
  the self-check, and let the result (including a refusal) stand as-is.
