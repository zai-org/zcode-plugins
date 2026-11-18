# Start Here

This hub is the data plane. The Guster plugin discovers it, checks its structure and scores its health.

## What goes where

- `general/` — reusable principles, methods and tool notes that apply across projects.
- `projects/` — durable business and architecture knowledge for one project.
- more subzones (e.g. `reference/`) may exist; every first-level directory here is discovered automatically.
- the hub's project register lives outside this knowledge root in `register/projects.yaml`.

Keep one topic per file. Add every knowledge file to [the knowledge index](../README.md).

Structured knowledge files opt in via a `schema: knowledge/v1` header; every field is shown in the all-commented skeleton `knowledge-v1-skeleton.txt` in this directory.
