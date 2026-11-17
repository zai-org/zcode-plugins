# Accepted grammar: the structural subset rfauto's Verilog-A parser accepts

> Source of truth: `src/rfauto/core/veriloga_parser.py` (read-only kernel,
> Q-X80). This document distills the subset from the kernel source; every
> rule carries an evidence pointer (function/constant name in that file).
> All ```va blocks in this package are machine-pinned by
> `tests/unit/test_veriloga_authoring_skill.py` (clean parse: zero warnings,
> all contribution RHS prefix trees non-None).
>
> Scope: the kernel parses **structure** and normalizes **expression shape**.
> It never evaluates, never interprets analog solver semantics, never expands
> `generate`, never enters `analog function` bodies or `discipline` bodies
> (both are name-registered and skipped). Numbers are carried as the literal
> strings from the source text, never computed.

## 1. Lexical layer (`tokenize_veriloga`)

| form | accepted | evidence / note |
|---|---|---|
| line comment | `// ...` to end of line | consumed, produces no token |
| block comment | `/* ... */` | unclosed → **fatal** `VerilogAParseError`（"块注释未闭合"，带行号） |
| string literal | `"..."` with `\` escape | unclosed → **fatal** |
| identifier | `[A-Za-z_][A-Za-z0-9_$]*` | `$` allowed inside names |
| escaped identifier | `\name` up to whitespace | lone `\` without a name → **fatal** |
| number | `50` `1_000` `1.5` `.5` `1e-3` `1.5E+2` | `_` digit separator accepted; recovered as int/float **only** for pure literals (`parse_number_literal`), otherwise kept as raw text |
| sized/bit literals | `8'b0`, `'h1F`, ... | **rejected**: `'` is not a recognized character (fatal "无法识别的字符") |
| compiler directive | `` `define X`` etc. | backtick + rest of line consumed as one `dir` token; never interpreted |
| system token | `$realtime` `$temperature` ... | lexed as `sys`; **rejected inside expressions** (see §6) |
| attribute | `(* ... *)` | two standalone tokens; content preserved verbatim into an `attributes` list |
| 2-char operators | `<+` `**` `<=` `>=` `==` `!=` `&&` `||` | maximal munch (longest match first) |
| other punctuation | `()[]{}:;,.=+-*/%<>?!@#&|^~` | single-char fallback |
| anything else | — | **fatal** "无法识别的字符" (zero-progress guard) |
| nesting | `()[]{}` depth ≤ 512 (`MAX_NEST_DEPTH`) | deeper → **fatal** (pathological-input guard) |

## 2. Module structure (`parse_module`, `_parse_header_ports`, `_parse_direction_decl`)

Two port styles are unified; a clean file picks one per module:

```va
module ansi_style (input a, output b, inout electrical c);
  electrical a, b, c;
  analog begin
    V(b) <+ V(a);
  end
endmodule
```

```va
module classic_style (a, b);
  input a;
  output b;
  electrical a, b;
  analog V(b) <+ V(a);
endmodule
```

- Directions: the closed word list `input` / `output` / `inout` (`DIRECTIONS`).
- ANSI header may interleave direction words and net-type words
  (`electrical`, `wire`, ...) before each port name; body declarations
  (`input a;`) backfill header-listed names (`_PendingPort` merge).
- A name that appears in the header but never gets a direction anywhere does
  **not** appear in the parsed `ports` table (by design: no half-guessed
  ports) — always write the direction.
- `endmodule` missing → fail-soft warning `unterminated_module` (parse still
  returns `ok=True` with the warning); a clean artifact has zero warnings.
- Multiple `module`s per file are kept in `module_order` (insertion order).

## 3. Nets (`_parse_net_decl`, `KNOWN_NET_TYPES`)

```va
module net_types (p, n, w);
  electrical p, n;
  wire w;
  analog V(p) <+ V(n);
endmodule
```

- Known types: `electrical`, `wire`, `wand`, `wor`, `tri`, `reg`.
  `electrical` is the analog node type — use it for analog ports/nodes.
- Unknown type identifiers: tolerated **with warning** `unknown_net_type`
  when they look like `IDENT name[, name]* ;` (`_looks_like_net_decl`).
- Module-level `integer cnt;` / `real x;` therefore land as "nets" with the
  type recorded verbatim plus a warning. Declare loop counters/variables
  inside the analog block instead (they become ordinary statements there).
- Net ranges (`electrical [3:0] bus;`) are consumed but **not recorded**
  (known limitation, documented in the kernel docstring) — avoid relying on
  array nets in artifacts meant for structured consumption.

## 4. Parameters (`_parse_param_decl`, `_parse_range`, `PARAM_TYPES`)

```va
module param_forms (p, n);
  electrical p, n;
  parameter real r = 1.0 from [0:inf);
  parameter integer n_mode = 0;
  parameter string label = "unnamed";
  localparam real half = 0.5;
  analog V(p, n) <+ r * I(p, n);
endmodule
```

- Types: `real` / `integer` / `string` (`PARAM_TYPES`; omitted type is
  recorded as `None` — write the type explicitly).
- Default: any expression is kept as `default_raw`; a **pure numeric
  literal** additionally recovers a numeric `default` (from the source text,
  never computed).
- Range: optional `from <interval>` with four bracket forms — `[a:b]`,
  `[a:b)`, `(a:b]`, `(a:b)` — stored structurally (`low`, `high`,
  `low_inclusive`, `high_inclusive`, `raw`); bounds stay raw text (`inf`
  stays the string `"inf"`). Malformed ranges warn (`malformed_range` /
  `unterminated_range`).
- Trailing clauses after the range (`exclude ...` families) are preserved in
  `extra_raw`.
- `localparam` takes the same path as `parameter`.
- **Header parameters are silently dropped**: `module m #(parameter real r =
  1.0) (p, n);` — the `#(...)` group is captured and discarded
  (`parse_module`), zero warnings, parameter absent from the table. Declare
  parameters in the body.

## 5. Analog block (`_parse_analog`, `_parse_analog_stmt`, `STMT_CATEGORIES`)

Both entry forms parse:

```va
module analog_forms (p, n);
  electrical p, n;
  analog begin
    V(p, n) <+ V(p) - V(n);
  end
endmodule
```

```va
module analog_single (p, n);
  electrical p, n;
  analog V(p, n) <+ V(p) - V(n);
endmodule
```

Statement classification (closed set `STMT_CATEGORIES`, all keys always
present in `stmt_counts`):

| category | trigger | example |
|---|---|---|
| `contribution` | contains `<+` | `V(out) <+ gain * V(in);` |
| `if` / `else` / `for` / `while` | keyword | `if (sel > 0) ... else ...` |
| `event` | `@(...)` | `@(initial_step)` — name + raw args recorded, host statement still classified |
| `function_call` | `IDENT(...)` spanning the whole statement | `absform(V(in));` (statement-level call) |
| `assignment` | contains `=` (no `<+`) | `acc = acc + V(in);` |
| `block` | each `begin ... end` pair | nesting is counted, `MAX_BLOCK_DEPTH` 256 guard (deeper → **fatal**) |
| `other` | everything else | `integer i;` inside analog |

Control structures:

```va
module control_forms (in, out);
  electrical in, out;
  parameter real g = 1.0;
  parameter integer mode = 0;
  analog begin
    @(initial_step)
      acc = 0.0;
    for (i = 0; i < 3; i = i + 1)
      acc = acc + V(in);
    if (mode > 0)
      V(out) <+ g * V(in);
    else
      V(out) <+ V(in);
  end
endmodule
```

- `for (...)` headers are captured whole (the `;` inside the header does not
  split statements).
- `begin`/`end` pairing is counted; imbalance is fail-soft
  (`stray_end` / `unterminated_block` warnings) — write balanced blocks.
- Variables (`integer i;`, `real acc;`) may be declared as statements inside
  the analog block; they classify as `other` without warnings. There is no
  dedicated declaration record — keep declarations minimal.

## 6. Expressions (`expr_to_prefix`, `PRECEDENCE`)

Contribution RHS (and only the RHS) is normalized to a **prefix tree**.
Shapes (all verified in the package contract test):

| infix | prefix tree |
|---|---|
| `a + b * c` | `["+", "a", ["*", "b", "c"]]` |
| `V(out)` / `f(a, b)` | `["V", "out"]` / `["f", "a", "b"]` (access and call share the call shape) |
| `a[i]` / `p[m:n]` | `["[]", "a", "i"]` / `["[]", "p", "m", "n"]` |
| `c ? a : b` | `["?:", "c", "a", "b"]` (nested: right-assoc, inner goes under the else branch) |
| `-x`, `!x` | `["-", "x"]` / `["!", "x"]` (unary distinguished from binary by arity) |
| `(a + b) * c` | `["*", ["+", "a", "b"], "c"]` (parenthesized groups produce no node — grouping lives in the tree shape) |
| single operand | the operand string itself, e.g. `0.0` stays `"0.0"` |

- **Numbers are never evaluated**: `1e-3`, `1_000`, `0.5` remain the literal
  strings from the source.
- Precedence (loosest → tightest): `||` < `&&` < `==` < `> < >= <=` < `+ -` <
  `* / %` < `**`; unary `- !` bind tightest; ternary `?:` is loosest of all.
- **Associativity: every binary operator is left-associative, including
  `**`** (Verilog-A LRM differs from SystemVerilog here; the only
  right-associative form is `?:`). `2 ** 3 ** 2` → `["**", ["**", "2", "3"],
  "2"]`.
- Closed set enforcement: `& | ^ ~ << >>` (and any other operator outside the
  table) raise `ExpressionNormError` — fail-closed, no guessing. In a
  contribution RHS this becomes warning `expr_normalize_failed` with the raw
  text preserved and tree `None`. `<<` lexes as two `<` tokens, so its error
  surfaces as "表达式期待操作数".
- `$`-system tokens and `dir` tokens inside an expression are likewise
  rejected (`expr_to_prefix` accepts only num/id/str/punct kinds).
- Structural failures in the normalizer: empty expression, dangling operator
  (`a +` → "二元 '+' 操作数不足"), mismatched/unexpected brackets, comma
  outside a call argument list, `:` without a matching `?` (outside an index
  range).

## 7. Tolerated but discouraged (fail-soft, or silently unhelpful)

| form | what actually happens | why avoid |
|---|---|---|
| `analog function name ... endfunction` | name registered, body skipped, warning `analog_function_skipped` | body semantics are outside the subset; the model's behavior becomes invisible to the parse |
| `discipline ... enddiscipline` / `nature ... endnature` | name registered (`disciplines` list), body skipped | fine in principle, but body content is not parsed — prefer plain `electrical` in authored artifacts |
| `case (x) ... endcase` inside analog | **corrupts attribution**: labels merge into the next contribution LHS (probe: `lhs: 'case(m) 0 : V(b)'`) and block/module closure miscounts (`unterminated_module` warning) | use `if/else` chains |
| named blocks `begin : name` ... `end` | `: name` leaks into the next statement's LHS (probe: `lhs: ': blk V(b)'`, zero warnings) | use anonymous `begin/end` |
| `generate` / other module-level constructs | warning `skipped_module_stmt` / `skipped_top_level`, statement skipped | not part of the structural subset |
| module-level `integer`/`real` declarations | recorded as nets with warning `unknown_net_type` | declare inside analog instead |
| attributes inside analog statements | attribute tokens end up inside the captured statement text | place `(* ... *)` before `module` |
| `#(...)` header parameters | consumed and discarded, zero warnings (silent data loss) | declare parameters in the body |

## 8. Clean-parse bar (the quality gate for authored .va)

A .va artifact written against this skill is "clean" when
`parse_veriloga(text)` returns:

1. zero `warnings`;
2. every entry of every module's `analog.contributions` has a non-None
   `rhs_prefix_tree`;
3. every port appears in `ports` with a direction (nothing silently omitted);
4. every parameter appears in `params` with its `type` and (intended)
   `range`.

The write → parse → fix loop that enforces this bar is in
`workflow.md`; the machine pin is
`tests/unit/test_veriloga_authoring_skill.py`.
