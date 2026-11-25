# API To SDK

Turn an **OpenAPI 3.0 / 3.1** spec (YAML or JSON) into a **typed TypeScript SDK package**, then prove it works: it is compiled with TypeScript in strict mode, and every operation is called against a mock server built from the spec.

## What it does

- **Reads the spec**: local `$ref`s (schemas, parameters, request bodies, responses), path-level parameters, `allOf` / `oneOf` / `anyOf`, `const`, enums, 3.0 `nullable` and 3.1 type arrays, `additionalProperties`, security schemes. It warns about external or broken `$ref`s, undeclared path parameters, missing or duplicate operationIds and OAuth flows.
- **Generates** `sdk/<api>/`:
  - `src/types.ts`: one type per schema, with descriptions as JSDoc.
  - `src/client.ts`: a client class with one method per operation (`api.getBike({ bikeId: 7 })`). It has typed arguments and responses, and also provides:
    - Path, query (arrays repeated) and header parameters; JSON, multipart (`FormData`, `Blob`), form and raw bodies.
    - Bearer token (string or function), API key (header, query or cookie) and basic auth, chosen per operation from `security`.
    - `timeoutMs`, `AbortSignal`, custom `fetch` and per-request headers.
    - `ApiError` with status and parsed body; typed error bodies are exported as `<Op>ErrorBody`.
  - No runtime dependencies (works in Node 20+, Deno, Bun and browsers). Pre-built `dist/` (JS + `.d.ts`), `package.json` and `tsconfig.json`.
  - `README.md` with an operation table, and `examples/all-operations.ts`, which calls every operation with the spec's example values (spec examples that don't match their schema are reported).
  - `mock/server.mjs`: a dependency-free mock answering from the spec's examples (or values synthesised from schemas). It checks requests against the spec (400 with reasons), supports `Prefer: code=404` to return documented errors, and allows CORS.
- **Verifies**:
  - Strict TypeScript compile.
  - Calling every operation against the mock. Each call checks method, path parameters, query, headers, credentials and JSON body against what was passed; that the response was parsed; and that a documented error status throws `ApiError` with the parsed body.

## Usage

Ask the agent in ZCode Desktop:

- "Generate a TypeScript SDK from openapi.yaml"
- "Make a client for this API spec and test it"
- "Re-verify the SDK after I changed the spec"

Or use the panel: choose the spec, **Read spec**, optionally set the folder, package name and class name, then **Generate & verify**.

## Tools

| Tool | Purpose |
|---|---|
| `sdk_inspect` | List operations, schemas, auth and spec problems (writes nothing) |
| `sdk_generate` | Write the SDK package, compile it and call every operation against the mock |
| `sdk_test` | Re-run the compile and mock calls (for example after editing generated code) |

## Scope (v0.1)

- TypeScript only; publishing to npm is up to you (`npm publish` in the folder).
- OpenAPI 2 (Swagger) must be converted to 3 first. External `$ref` files are not followed.
- OAuth2 / OpenID flows are not generated; pass an access token with `token`. Cookie parameters, `deepObject` query style, XML bodies and callbacks/webhooks are not supported.
- The mock is for development and tests, not a full contract tester. Its checks cover types, required fields, enums, `const`, formats, ranges and `oneOf` / `anyOf` / `allOf`.

## Privacy, network and files

- Runs locally with no network access and no API keys. Verification talks only to a mock on 127.0.0.1; the real API is never called.
- Reads the spec. Writes the SDK folder and `.api-to-sdk/sdks.json`.

## License

MIT. Bundles [yaml](https://github.com/eemeli/yaml) (ISC) and [TypeScript](https://github.com/microsoft/TypeScript) (Apache-2.0) for compiling.
