# minimal service

## Problem

There is no tiny service to exercise a deployment loop against.

## Acceptance

- [ ] `GET /health.json` returns the running commit
- [ ] The service starts without third-party dependencies

## Non-goals

Authentication, persistence and multi-service routing.
