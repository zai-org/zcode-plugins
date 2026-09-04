---
name: yaml-json-convert
description: Convert YAML to JSON exactly, preserving scalar types — quoted values like "2.0" stay strings, true/false become JSON booleans, null/~ become null, unquoted dates become strings. Use whenever converting YAML configs to JSON, transforming any YAML document into JSON, or fixing a YAML→JSON conversion that changed value types — even for a single small document.
---

# YAML → JSON Conversion

Converting YAML to JSON — mandatory conventions:

1. **QUOTED SCALARS STAY QUOTED — this is the #1 error in this conversion.**
   A YAML value in quotation marks is a string even when it looks numeric,
   because the author deliberately quoted it to force string type. It must
   still be quoted in the JSON output:
   - YAML `version: "2.0"` → JSON `"version": "2.0"` (string — CORRECT)
   - YAML `version: "2.0"` → JSON `"version": 2.0` (number — WRONG: this
     silently drops the quotes and changes the value's type)
   The temptation is to "clean up" `2.0` into a number because it looks like
   one. Resist it: quotes are type information, not decoration.
2. Unquoted true/false become JSON true/false (lowercase — never True/False,
   never strings).
3. null and ~ become JSON null (never the string "null").
4. Unquoted scalars: integers stay integers, decimals stay numbers (3 stays 3,
   0.25 stays 0.25).
5. Unquoted dates (YYYY-MM-DD) become JSON strings, kept verbatim.
6. Flow lists [a, b] and block lists both become JSON arrays. Empty maps/lists
   become {} and [].
7. Emit a single JSON object: no comments, no trailing commas, no prose, no
   code fences.

**Self-check before answering:** walk every scalar in your JSON and ask "was
this value quoted in the YAML?" — if yes, it must be a JSON string in double
quotes. Fix any that are not before emitting.
