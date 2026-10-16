# ChatGPT Bridge

[中文说明](README_CN.md)

Manage a local ChatGPT plan bridge from ZCode using four standard slash commands. The companion macOS service handles independent OpenAI authorization and exposes a local **OpenAI Responses** provider. This command plugin adds no MCP Apps page, Hook, MCP server, native provider-registration API or application-bundle patch.

## Install and use

1. Install Node.js 22+ and ZCode on macOS. This release was exercised on Apple Silicon with ZCode 3.15.3; Intel Macs have not been tested.
2. Download the companion ZIP from [weixshaw/zcode-chatgpt-bridge releases](https://github.com/weixshaw/zcode-chatgpt-bridge/releases). Extract it, review the source and `SHA256SUMS.txt`, then run `安装.command` (the macOS installer). The bridge is a separate prerequisite; installing this command plugin alone does not install the service.
3. In its local dashboard, select **Continue with ChatGPT** and finish authorization on the official OpenAI page. The account must grant ChatGPT plan usage. Model access and limits depend on the account/workspace; a catalog entry alone does not establish inference access.
4. Select **应用到 ZCode** to add the local provider and account model catalog, or copy the dashboard's Base URL/local key into a custom **OpenAI Responses** provider. Start a new ZCode conversation and select a bridge model.
5. Install and enable this plugin from the community marketplace. Before community inclusion, add `https://github.com/weixshaw/zcode-chatgpt-bridge` as a personal plugin market (the repository has a root `marketplace.json`).

| Command | Behavior |
| --- | --- |
| `/chatgpt-connect` | Open the local account and provider setup dashboard |
| `/chatgpt-status` | Read service state, saved-account labels and current-run inference counters |
| `/chatgpt-models` | Refresh the active account's model catalog |
| `/chatgpt-doctor` | Diagnose local service, sign-in and model discovery; does not run inference |

Commands invoke `node` and the companion CLI under the current user's macOS Application Support directory. Node must be on the Agent PATH. Commands run through the current Agent's normal tool permission flow. Opening the dashboard does not change the current conversation's model. If the service is missing, install it from the linked repository first.

## Network, permissions and side effects

- The plugin's commands run a local Node.js process. `connect` opens the system browser; `models` / `doctor` can cause the companion to contact OpenAI. There are no automatic Hooks, background actions or model calls in this plugin itself.
- The companion installs its program and protected data under `~/Library/Application Support/ZCode ChatGPT Bridge/` and a current-user LaunchAgent under `~/Library/LaunchAgents/`. It binds to `127.0.0.1` (default port 19781) and keeps running independently of plugin enablement.
- It contacts `auth.openai.com` for registration, sign-in, signed-key discovery, refresh and revocation; `api.openai.com` for models and Responses inference. GitHub supplies the source/releases. Source installations fetch pinned runtime packages from npm. Optional configured HTTP proxies can carry these requests.
- Only **应用到 ZCode** writes the bridge's provider/model rules to `~/.zcode/v2/provider_config.json`, after creating an owner-only backup in bridge data. Other providers and the existing default are retained. Manual provider setup is also available.
- OAuth credentials remain in protected local storage (`0700` data directory, `0600` files). They are not read from Codex, committed, printed by these commands, or written into ZCode provider settings. The local connection key is separate. `/status` may display the account email/label; avoid posting its output publicly.
- ZCode prompts, files and tool results selected for a model request are sent to OpenAI. The bridge stores conversation continuation only in bounded memory and does not write prompt/reply logs. Restarting it, switching accounts or cache eviction requires a new conversation or complete-history resubmission.
- Real model use consumes the authorized ChatGPT plan limits. No API key is required for the subscription route. The service does not promise eligibility or extra quota.

This integration targets local macOS workspaces. Remote SSH/container Agents need a separately deployed and authorized bridge on that host; their `127.0.0.1` is not the Mac's loopback. Do not copy local credentials into remote workspaces.

## Disable and remove

Disabling/uninstalling this plugin removes only its commands. Sign out in the dashboard to revoke the renewable session, then run the companion's `卸载.command` to stop/remove the LaunchAgent and program. Its data is retained for explicit user removal. Remove the bridge provider in ZCode settings separately. If remote revocation is not confirmed, disconnect the app in [ChatGPT settings](https://chatgpt.com/settings/usage).

## Verification and provenance

The companion has 19 automated tests. Its 0.1.0 implementation completed real GPT-6.1-Sol text, local function-call and tool-result continuation checks, plus a ZCode 3.15.3 write/read task returning `NATIVE_OK`. The four commands were discovered by the installed ZCode runtime. These checks do not establish compatibility with every model, tool or future release. See the companion repository's `VERIFICATION.md` for limits.

Plugin and companion source: [weixshaw/zcode-chatgpt-bridge](https://github.com/weixshaw/zcode-chatgpt-bridge), MIT. The companion depends on `jose` and `undici` (MIT); notices and pinned versions are in that repository. No third-party code is embedded in this command plugin. OpenAI and ZCode are external service/product dependencies. This is an independent community project with no affiliation with OpenAI or Z.ai.
