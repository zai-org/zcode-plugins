# Command guide

This wrapper targets the command surface reported by
`terraphim-agent memory --help`. Inspect subcommand help before use.

| Operation | Effect |
|---|---|
| `memory scope --project <PATH> --check` | Read and check project boundaries |
| `memory retrieve <QUERY> --role <ROLE>` | Read KG-ranked role memory |
| `memory list` / `memory show <ID>` | Read stored items |
| `memory provenance --memory-id <ID>` | Read session provenance |
| `memory apply --prompt <TEXT>` | Preview hook injection |
| `memory capture --provenance-tag <TAG>` | Write an item to the evolution store |
| `memory distill ...` | Compile and export learned material |
| `memory validate ...` | Invoke the judge pipeline for scoring |
| `memory retire --lesson-id <ID> --reason <TEXT>` | Propose a governed retirement |
| `memory export --output <PATH>` | Write an external artefact |

Retrieval has no lexical fallback. An empty result is not evidence that no
related memory exists.
