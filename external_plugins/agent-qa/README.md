# agent-qa

[中文文档](./README_CN.md)

Use [agent-qa](https://github.com/vostride/agent-qa) from vostride for natural-language Web, Android, and iOS tests, recorded run evidence, and advanced memidex memory and self-improvement.

## Use in ZCode

Install and enable **agent-qa** from the marketplace, then open a new session in the application project. The `agent-qa` skill is triggered by explicit agent-qa requests or its configuration and test files. For example:

- “Use agent-qa to validate and run this project's checkout test.”
- “Review the recorded agent-qa checkout evidence only. Do not start a run or change knowledge.”
- “Explain what memidex knowledge this agent-qa run used and learned.”
- “Author an agent-qa test for the configured komazon target that checks the product catalog is visible.”

The skill keeps preparation checks separate from execution results. A dry run or missing completed-run record is not a pass. Authoring uses the installed package's supported contract and can execute a test during verification.

## Prerequisites

The separately installed agent-qa runtime 0.2.3 requires Node.js 24+. Use the application's existing runtime version and configuration when present. For a new setup, follow the [quickstart](https://vostride.com/docs/agent-qa/quickstart) in the intended application project:

```bash
npm install -D agent-qa
npx agent-qa init --help
```

Configure the chosen model provider through its supported credential flow. Claude or Codex subscription sign-in also requires `npm install -D @vostride/agent-qa-subscription-auth`. Browser execution requires the configured browser; Android/iOS execution requires Appium and the relevant device/driver setup. Saved-run reviews do not need a new browser session.

The plugin supplies skill instructions; it does not bundle agent-qa, install dependencies, register MCP, or start services automatically. For connected authoring tools, configure agent-qa MCP separately using the [coding-agent guide](https://vostride.com/docs/agent-qa/coding-agents). Use the intended project configuration and a tool-call timeout appropriate for the test or suite. Without a connected tool, discover the installed capability interface rather than guessing an authoring command.

## Dependencies and side effects

- The skill can guide ZCode to execute the installed agent-qa CLI and use configured MCP tools within the requested task. It contains no executable hooks or bundled MCP server.
- Package installation downloads from npm. Test execution contacts the configured application and model provider; mobile execution also uses configured Appium/device services. Provider charges or subscription limits may apply.
- Initialization, authoring, and execution can create configuration, YAML tests, local run records, screenshots, logs, and knowledge in the application project. A read-only evidence review does not call authoring/execution or change outcome marks or knowledge.
- Runtime analytics, authentication, and data handling follow the installed agent-qa version and project settings. Only configured secret values are masked; inspect evidence before sharing it. Do not commit credentials or put them in chat.
- Outcome correction can change attributable knowledge or expectations. It requires a correction task and a reviewed effect; a corrected verdict is not evidence of a rerun.

## Contents and license

The package contains one skill and two references for setup/runs and evidence/memory. Instructions and manifests are contributed by vostride under Apache-2.0, the marketplace's license. The separately installed [agent-qa runtime uses FSL-1.1-ALv2](https://github.com/vostride/agent-qa/blob/main/LICENSE.md); it is not included in this plugin.
