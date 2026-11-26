# Kling AI Global Plugin

[中文说明](./README_CN.md)

Connect ZCode to the official Kling AI Global MCP service for image and video generation.

## Setup

1. Install and enable this plugin in ZCode.
2. Start a new session. In **Settings → MCP Servers**, choose **Open authorization** for `kling-ai-global` and sign in to a Global Kling account.
3. Ask the agent to create an image or video with Kling AI.

The service uses OAuth. Generation consumes credits from the connected Global Kling account. Global and China accounts, credits, and task history are separate.

## Network access and side effects

- The plugin connects to `https://kling.ai/mcp/plugin`.
- The server performs requested Kling image or video generation. These generation requests consume account credits.
- The plugin contains only a remote MCP configuration. It runs no local commands, installs no dependencies, and writes no files.
- No API key or password is stored in the plugin configuration. ZCode completes OAuth in the browser.

## Links

- [Official plugin repository](https://github.com/klingai-tech/claude-plugin)
- [Kling AI Global Plugin repository](https://github.com/klingai-tech/claude-plugin)
