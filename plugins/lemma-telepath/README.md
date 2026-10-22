# Telepath — your Telegram, readable by ZCode

[中文文档](./README_CN.md)

Telepath connects **your own Telegram account** to ZCode through a hosted MCP
server. Not another chat channel for talking to an assistant — it gives the
assistant access to the conversations you already have: search the archive, read
the documents, photos and transcribed voice inside it, and reply as yourself.

It runs on Telegram's official business-bot API — a bot you add to your own
account — not on an MTProto user session. Nothing here logs in as you.

## What it adds

One MCP server, `telepath`, reached over HTTP at
`https://telepath.lemma.company/mcp`. Its tools cover:

- full-text search across your archived chats, captions and voice transcripts;
- reading a chat's recent messages, or a specific message and its context;
- opening attachments by content — PDFs, spreadsheets, documents, photos;
- sending, editing and reacting in your own chats, as yourself;
- a small markdown notes store scoped to your account.

Which of these exist in a session depends on the capabilities you leave enabled;
every one of them is a switch you control from the Telegram bot.

## Setup

1. In Telegram: **Settings → My Account → Chat automation**, add
   **@lemma_telepath_bot**, and choose which conversations it may access. This
   entry is open to every account — **Telegram Premium is not required**.
2. Install this plugin. ZCode registers the remote MCP server and asks you to
   authorize it.
3. Sign in with Telegram when the browser opens. That is the whole of the
   authentication; there is no API key and nothing to paste into chat.

From that moment, new messages in the chats you picked are archived and become
searchable from ZCode. Nothing older is imported unless you ask for it.

Walkthrough with screenshots: https://telepath.lemma.company/start

## Network access

The plugin itself ships no code — only this manifest and documentation. Every
request goes to one domain:

| Endpoint | Why |
|---|---|
| `https://telepath.lemma.company/mcp` | the MCP server itself (streamable HTTP) |
| `https://telepath.lemma.company/authorize`, `/token`, `/register` | OAuth 2.1 with PKCE and dynamic client registration |
| `https://telepath.lemma.company/oauth/login` | the sign-in page, which loads the Telegram Login widget from `oauth.telegram.org` |

No `curl | bash`, no downloaded executables, no `postinstall` step, no hooks, no
commands, no local file writes.

## Permissions and side effects

- **It reads your messages.** Only the chats you chose in Telegram, only from the
  moment you connected the bot.
- **It can send and edit messages as you**, if you leave that capability on.
  This is a real side effect in the world: a tool call reaches an actual person.
  Telegram allows it only in private chats that received an incoming message
  within the last 24 hours.
- **Voice transcription is optional and paid.** When enabled, audio is sent to
  Mistral (Voxtral, EU) to be turned into text; it is not reused for training,
  and no copy is kept once the transcript is stored. Everything else stays on
  our server.
- **Group archiving, history import and bringing your own bot** are optional and
  off by default.

Turn any of this off, or erase everything, from the bot: `/settings`,
`/deletedata`.

## Honest limits

Telepath is a **hosted service**, and it is **not end-to-end encrypted** — to
search and transcribe for you, our servers process your messages, so we can
technically access them. We say so plainly rather than implying otherwise.

Each account gets a physically separate database, the disk is encrypted at rest
(LUKS full-disk), and credentials are encrypted or hashed on top. If you need a
guarantee that no operator can ever read it, the connector is also available to
self-host, single-tenant, as the same code.

- Privacy policy: https://telepath.lemma.company/privacy
- Terms: https://telepath.lemma.company/terms
- Support: https://telepath.lemma.company/support

## Licensing and provenance

This plugin package is **MIT** — see the
[source repository](https://github.com/Lemma-Company/telepath-plugin). It
contains manifests and documentation only; none of the server's code is in it.
The hosted service it points at is operated by Lemma under the terms linked
above. Telepath is not affiliated with Telegram or Z.ai.
