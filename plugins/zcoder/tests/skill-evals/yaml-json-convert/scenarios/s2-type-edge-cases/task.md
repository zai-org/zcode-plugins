---
output_ext: json
---

Task: convert a YAML configuration document to JSON, following the SKILL GUIDANCE below exactly.

SKILL GUIDANCE:
{{SKILL_GUIDANCE}}

YAML DOCUMENT:
service:
  name: "billing-api"
  port: 8080
  version: "3.1"
  price: "$1,200"
  notes: ""
  owner:
  maintainers:
    - "alice"
    - ""
  window:
    start: 2026-01-15
    end: 2026-02-20
  rates:
    standard: 0.2
    "priority:1": 0.5
  flags:
    - on
    - off

Respond with the complete JSON document between these markers, and nothing else:
OUTPUT_BEGIN
OUTPUT_END
