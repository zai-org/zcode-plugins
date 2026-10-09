# Command guide

This wrapper targets the command surface reported by
`terraphim-agent learn --help`. Inspect subcommand help before use.

| Operation | Effect |
|---|---|
| `learn list --recent <N>` | Read recent project learnings |
| `learn query <PATTERN>` | Read matching project learnings |
| `learn query <PATTERN> --global` | Read global learnings |
| `learn capture --error <ERROR> --exit-code <CODE> <COMMAND>` | Write a failure learning |
| `learn correct <ID> --correction <TEXT>` | Write a correction to one learning |
| `learn correction ...` | Write an explicit workflow correction; inspect help first |
| `learn procedure ...` | Manage or replay procedures; replay can execute commands |
| `learn install-hook ...` | Change an agent configuration |
| `learn export-kg ...` | Write exported knowledge-graph files |

Redact credentials and personal or customer data before any persistent write.
