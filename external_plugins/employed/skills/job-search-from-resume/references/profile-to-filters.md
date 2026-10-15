# Mapping a profile to filters

| Resume signal | Filter |
|---|---|
| Student, graduating this or next year | `role_type=new_grad` or `internship`, `grad_year=<year>` |
| 0 to 2 years of experience | `role_type=junior`, `yoe_max=2` |
| 3 to 6 years | `role_type=mid`, `yoe_min=2`, `yoe_max=7` |
| 7+ years, or "led a team" | `role_type=senior` or `lead_exec` |
| Backend, frontend, ML, data, devops, security | `category` prefix under `engineering/...` (check `api_meta` for the exact tree) |
| Finance, law, life sciences, marketing, design | `domain=finance`, `law_policy`, `life_sciences`, `marketing`, `design_media` |
| Named stack (Kubernetes, Rust, PyTorch) | `tech=kubernetes,rust,pytorch`; do not require every tech, use the strongest two |
| "Open to relocate" or a named country | `location_scope=<country bucket>`; add `city` only if the user named one |
| "Remote only" | `work_mode=remote` and `location_scope=remote` |
| Needs sponsorship | `visa=likely` (broad) and `visa=stated` (strict); present them separately |

Start with fewer filters, check `count_jobs`, then add one at a time. A count of 0 usually means a wrong id, not an empty market.
