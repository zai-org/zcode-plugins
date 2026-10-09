# Command guide

This wrapper targets the command surface reported by `terraphim-grep --help`.
Treat the installed help as authoritative when a later release differs.

| Need | Flag |
|---|---|
| Keep the run offline | `--search-only` (alias: `--no-rlm`) |
| Limit the search roots | `--paths <PATHS>...` |
| Select content | `--haystack code`, `docs`, or `all` |
| Add surrounding lines | `-C <COUNT>` |
| Limit returned matches | `-n <COUNT>` |
| Produce machine-readable output | `--json` |
| Use an existing thesaurus | `--thesaurus <PATH>` |
| Use an existing role | `--role <NAME>` |

`--answer` and `--force-rlm` can enable configured model synthesis. They are
outside the default offline workflow.
