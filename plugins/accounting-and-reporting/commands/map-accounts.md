---
description: Map one chart of accounts to another with balance conservation proved, and 1:N / N:1 / nature mismatches surfaced for confirmation rather than resolved silently
argument-hint: "[源账套/科目表] → [目标账套/科目表] [用途, e.g. 合并/迁移/口径调整] [报告期]"
---

Load the `account-mapping` skill and build the mapping for: $ARGUMENTS

Prove balance conservation on the sheet — in total **and** by account nature. A mapping that ties in total while moving balances across natures passes the obvious check and breaks the statements downstream, with nothing to indicate why.

A 1:N split with no basis in the file stays unmapped and is reported as unmapped; allocating it on a plausible ratio produces a mapping that is right at the total and wrong at every line. N:1 relations, nature mismatches, and accounts with no counterpart all go to the open-items list for a person to confirm — surface them, do not resolve them. Keep deliberate reclassifications as their own rows with reasons, never as quiet mappings, and show every deviation from the prior period's mapping.

Name every 口径 change (总额/净额、含税/不含税、科目组成、抵销范围、期间定义) with its amount where computable. The mapping is not to be used for statement preparation until the open items are confirmed.
