# Token Stats

[简体中文](README_CN.md)

Token Stats displays the current conversation's generation speed and measured output Token total beside the ZCode composer.

## Use

1. Install and enable **Token Stats**. Open a local conversation in ZCode Desktop and let the model reply.
2. Hover over the metrics in the composer toolbar to see the model, speed, last output, time to first Token, output total, and context input. Click to open a details snapshot in the side panel.
3. Run `/show-token-stats` or ask the Agent to call `show_token_stats` to insert a snapshot in the message flow.

## Metrics

The toolbar updates as ZCode reports streaming speed estimates. It switches to measured speed when the host reports final metrics. The output total covers up to the last 20 measured model requests in that conversation. Context input appears when the host supplies measured input usage. Values depend on the model provider and the data exposed by ZCode.

## Requirements and data

| Area | Behavior |
| --- | --- |
| Client | ZCode Desktop with extension API 1.4. Local workspaces. |
| Model or API | Uses the metrics for the conversation's existing provider. Separate provider credentials and model calls by the extension are unnecessary. Invoking the slash command asks the conversation's Agent to use a read-only tool. |
| Network | The plugin communicates with ZCode over the local host APIs and stdio. |
| Execution | ZCode loads the extension and runs its local Node.js 24 MCP server. The plugin has no hooks or extra extension grants. |
| Storage | Stores request IDs, model IDs, numerical token metrics and timing for each conversation in the plugin data directory. The server reads the current conversation's snapshot. Prompts and reply text are outside the stored metrics. |

The plugin is distributed under Apache-2.0. It bundles the [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk), [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps), [Zod](https://github.com/colinhacks/zod), and their runtime dependencies. Their license texts ship in `dist/THIRD_PARTY_NOTICES.txt`.
