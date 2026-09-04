---
output_ext: json
---

Task: convert a YAML configuration document to JSON, following the SKILL GUIDANCE below exactly.

SKILL GUIDANCE:
{{SKILL_GUIDANCE}}

YAML DOCUMENT:
app:
  name: "skill-forge"
  debug: false
  replicas: 3
  ratio: 0.25
  version: "2.0"
  tags:
    - alpha
    - "beta-2"
  timeout: null
  host: ~
  empty: {}
  release:
    date: 2026-09-03
    channels: [stable, nightly]

Respond with the complete JSON document between these markers, and nothing else:
OUTPUT_BEGIN
OUTPUT_END
