# Third-party notices

The runtime uses the following npm packages. Versions are pinned by
`package-lock.json` and their licenses remain with the respective projects:

| Package | Version | License | Source |
| --- | --- | --- | --- |
| `langfuse` | 3.38.20 | MIT | <https://github.com/langfuse/langfuse-js/tree/main/langfuse> |
| `langfuse-core` | 3.38.20 | MIT | <https://github.com/langfuse/langfuse-js/tree/main/langfuse-core> |
| `mustache` | 4.2.0 | MIT | <https://github.com/janl/mustache.js> |

The plugin sends telemetry to a user-configured Langfuse service over HTTPS.
That service is external to this repository and is governed by the service
operator's terms and privacy policy. No credentials are bundled or published.
