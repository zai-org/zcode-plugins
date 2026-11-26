# Web

Frontend landing zone. Galadon deliberately does not pick a framework for you.

- Keep the API contract in `spec/spec.md`, not in component code.
- The backend serves `GET /health.json`; proxy it during development.
- Unit tests live next to the code; end-to-end tests go in `../e2e/`.
- Build output goes to `../out/`, which is gitignored.
