# Third-party notices

The runtime uses the following npm packages. Versions are pinned by
`package-lock.json` and their licenses remain with the respective projects:

| Package | Version | License | Source |
| --- | --- | --- | --- |
| `@langfuse/otel` | 5.11.1 | MIT | <https://github.com/langfuse/langfuse-js/tree/main/packages/otel> |
| `@langfuse/tracing` | 5.11.1 | MIT | <https://github.com/langfuse/langfuse-js/tree/main/packages/tracing> |
| `@langfuse/core` | 5.11.1 | MIT | <https://github.com/langfuse/langfuse-js/tree/main/core> |
| `@opentelemetry/api` | 1.9.1 | Apache-2.0 | <https://github.com/open-telemetry/opentelemetry-js/tree/main/api> |
| `@opentelemetry/core` | 2.11.0 | Apache-2.0 | <https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-core> |
| `@opentelemetry/sdk-trace-base` | 2.11.0 | Apache-2.0 | <https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/sdk-trace-base> |
| `@opentelemetry/sdk-trace-node` | 2.11.0 | Apache-2.0 | <https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/sdk-trace-node> |
| `@opentelemetry/exporter-trace-otlp-http` | 0.222.0 | Apache-2.0 | <https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/exporter-trace-otlp-http> |
| `@opentelemetry/otlp-transformer` | 0.222.0 | Apache-2.0 | <https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/otlp-transformer> |
| `@opentelemetry/otlp-exporter-base` | 0.222.0 | Apache-2.0 | <https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/otlp-exporter-base> |

The plugin sends telemetry to a user-configured Langfuse service over HTTPS.
That service is external to this repository and is governed by the service
operator's terms and privacy policy. No credentials are bundled or published.
