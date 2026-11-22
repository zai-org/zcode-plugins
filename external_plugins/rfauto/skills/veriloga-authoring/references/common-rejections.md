# Common rejections: what the parser refuses, and the fix

> Source of truth: `src/rfauto/core/veriloga_parser.py`. Two failure
> families, and they must never be conflated:
>
> 1. **Fatal** (`VerilogAParseError`): lexical/deep-structural violations —
>    the whole parse aborts. Through the service layer
>    (`parse_veriloga_file`) these come back as an error envelope
>    (`ok=False`, `errors` list).
> 2. **Fail-soft** (warnings): the parse completes (`ok=True`) but every
>    deviation is recorded in `warnings` (each with `line`, `name`, `note`).
>    A clean artifact has **zero** warnings; warnings are findings, not
>    noise to be ignored (rfauto rule #122 spirit: report as-is, never
>    launder).
>
> Contract blocks below: ```va-rejected must raise `VerilogAParseError`;
> ```va-warned must parse with at least one warning (or a `None` RHS tree).
> Both are pinned by `tests/unit/test_veriloga_authoring_skill.py`.

## 1. Fatal rejections

| message fragment | cause | fix |
|---|---|---|
| `无法识别的字符` | a character outside the lexer's set — typical culprit: sized/bit literals like `8'b0` (`'` is not lexable), stray `\` not starting an escaped identifier | write plain decimal/scientific numbers (`0`, `1.5`, `1e-3`); Verilog-A behavioral models have no use for bit vectors |
| `块注释未闭合` | `/*` without a matching `*/` | close the comment; prefer `//` line comments in authored artifacts |
| `字符串未闭合` | `"` without a closing `"` on the same scan (escapes `\` count) | close the string |
| `空文件（无任何内容）` | whitespace-only input | the file must contain at least one module |
| `孤立反斜杠` | `\` with no name after it | escaped identifiers need `\name ` (name then whitespace) |
| `括号嵌套深度超过上限` | `()[]{}` nesting beyond 512 | not a real-model shape; restructure |
| `模块 {name} 未闭合` — **not fatal**, see warnings | — | — |

Examples (both raise `VerilogAParseError`):

```va-rejected
// bit-vector literal: `'` is not a lexable character in this subset
module bad_bit_literal (a);
  electrical a;
  analog V(a) <+ 8'b0;
endmodule
```

```va-rejected
// block comment never closed — the whole file is refused
module bad_comment (a);
  electrical a;
  /* this comment has no end
  analog V(a) <+ 0.0;
endmodule
```

## 2. Fail-soft warnings (parse completes; artifact is not clean)

Warning names (closed set emitted by the kernel):

| warning `name` | trigger | fix |
|---|---|---|
| `expr_normalize_failed` | contribution RHS uses an operator outside the precedence closed set (`& | ^ ~ << >>`, ternary misuse), a `$`-system token, or a malformed expression (dangling operator, mismatched brackets) | rewrite the RHS inside the accepted operator set (see `accepted-grammar.md` §6); keep bitwise/bit-fiddling logic out of analog contributions |
| `unterminated_module` | `endmodule` missing (or `case`/named-block corruption ate it) | close the module; remove `case`/named blocks |
| `stray_end` | extra `end` with no open `begin` | balance the blocks |
| `unterminated_block` | `begin` without `end`, or `discipline`/`analog function` block never closed | close the block |
| `truncated_analog` | analog block hits EOF | complete the analog block |
| `unknown_net_type` | net declared with a type outside `electrical/wire/wand/wor/tri/reg` (includes module-level `integer`/`real`) | use `electrical` for nodes; move variable declarations inside the analog block |
| `skipped_module_stmt` / `skipped_top_level` | construct outside the structural subset (`generate`, `specify`, stray tokens) | remove it or move it; it is not parsed |
| `skipped_header_token` | unexpected token in the module header port table (e.g. `[3:0]` ranges in ANSI headers) | keep the header to direction + optional type + name |
| `malformed_range` / `unterminated_range` | `from` constraint not a `[a:b]`-family interval or not closed | use one of `[a:b]` `[a:b)` `(a:b]` `(a:b)` |
| `malformed_event` | `@` without `(...)` or mismatched event brackets | write `@(name)` or `@(name(args))` |
| `analog_function_skipped` | `analog function` declaration | move the function's role into inline expressions (function bodies are not parsed) |
| `unterminated_attr` | `(* ... *)` never closed | close the attribute |

Examples (all parse `ok=True` but carry warnings — none is clean):

```va-warned
// '&' is not in the expression closed set -> RHS tree lost
module bad_bitwise (a, b);
  electrical a, b;
  analog V(b) <+ V(a) & V(a);
endmodule
```

```va-warned
// $-system tokens cannot appear inside a contribution RHS
module bad_systask (a, b);
  electrical a, b;
  analog V(b) <+ $realtime;
endmodule
```

```va-warned
// missing endmodule: parse completes, warning recorded, artifact not clean
module bad_unclosed (a);
  electrical a;
  analog V(a) <+ 0.0;
```

```va-warned
// module-level `integer` is read as an unknown net type
module bad_module_integer (a);
  electrical a;
  integer cnt;
  analog V(a) <+ 0.0;
endmodule
```

```va-warned
// case corrupts statement attribution AND miscounts module closure
module bad_case (a, b);
  electrical a, b;
  parameter integer m = 0;
  analog begin
    case (m)
      0: V(b) <+ V(a);
      default: V(b) <+ 0.0;
    endcase
  end
endmodule
```

## 3. Silent traps (zero warnings — check the output, not just ok)

These do not warn, which makes them the dangerous half:

- `#(...)` header parameters: consumed and discarded — the parameter never
  reaches the `params` table. Fix: declare parameters in the module body.
- Header-listed port with no direction anywhere: silently absent from the
  `ports` table. Fix: write the direction (header or body).
- Named blocks `begin : name`: the label leaks into the next statement's
  contribution LHS text (`: blk V(b)`) with zero warnings. Fix: anonymous
  `begin/end`.
- Net ranges (`electrical [3:0] bus;`): consumed but not recorded. Fix:
  avoid array nets in artifacts meant for structured consumption.

## 4. Escalation rule

If a form you need is rejected or warned and no fix above restores a clean
parse, the form is **outside the accepted subset** — do not widen the skill's
claims and do not edit the kernel from this seat. Record the case (file +
warning/error text) and route it to the kernel owner. The kernel is
read-only ground truth for this skill (`veriloga_parser.py`, Q-X80).
