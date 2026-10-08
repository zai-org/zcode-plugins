# Hyper3D Rodin

[简体中文](./README_CN.md)

Generate 3D models from text or reference images with Hyper3D Rodin Gen-2.5,
split completed models into parts with BANG, follow progress, and retrieve
result pages or requested model files in ZCode.

This plugin contains one remote HTTP MCP declaration and one Skill. A Hyper3D
account is required; generation and BANG consume credits from the personal or
group workspace selected during OAuth authorization.

## Install and connect

1. After publication, install and enable **Hyper3D Rodin** in ZCode's plugin
   manager.
2. Use ZCode's MCP authentication controls to sign in to Hyper3D in the browser.
   Review the requesting client, select the billing workspace, and authorize
   access. Select the MCP scope used by your active project; authorization in
   one scope does not mean another scope is connected. No API key, password,
   cookie, or session token belongs in chat or in
   this plugin's configuration.
3. Verify that the Hyper3D tools are available in the session. Tool discovery
   alone does not prove that OAuth or authenticated calls work. If the host has
   no authorization control or login fails, retain the redacted error for
   troubleshooting; do not work around it by pasting credentials into chat.

The MCP endpoint is `https://api.hyper3d.com/api/mcp`. ZCode namespaces the
server as `plugin:hyper3d-rodin:hyper3d-rodin`. The Skill maps the logical tool
names below to the actual tools exposed by the current session; this plugin
does not define slash commands.

The service advertises `rodin:generate` for uploads and generation and
`rodin:read` for status and results. OAuth metadata advertises authorization-code
flow with PKCE S256, dynamic client registration, and refresh-token support.
The actual login and refresh flow depends on ZCode's client implementation.
Reconnect to change the authorized account or billing workspace.

## Use

- “Use Hyper3D to generate a cartoon astronaut as a GLB model.”
- “Generate a 3D model from this reference image.”
- “Check my Rodin task with generation ID … and show its result page when done.”
- “Split my completed Rodin model with generation ID … into parts using BANG.”
- “Download the completed model into this project's assets directory.”

The Skill guides text/image submission, spaced status checks, and result
retrieval. Uploads accept 1–5 supported images, each at most 20 MiB. ZCode must
read the actual files, request upload URLs, and perform successful HTTP PUTs
before starting an image-based generation. If uploading is unavailable, the
agent reports that limitation and points to [Hyper3D](https://hyper3d.ai); it
does not silently omit the images.

| Tool | Purpose |
| --- | --- |
| `rodin_create_uploads` | Obtain temporary upload URLs for reference images |
| `rodin_generate` | Submit a Rodin generation; consumes credits |
| `rodin_generate_bang` | Split an owned, completed Rodin generation; consumes credits |
| `rodin_get_status` | Read a task's status and stage |
| `rodin_wait` | Server-side wait; prefer status checks in ZCode |
| `rodin_get_result` | Retrieve the result page and temporary file URLs |

The server also advertises `rodin_import_images`, which is for ChatGPT Chat
attachments only. The Skill instructs ZCode not to use it. There are no account
balance or generation-history tools. Available parameters and formats follow
the live tool schemas; current model formats are GLB, USDZ, FBX, OBJ, and STL.

## Dependencies, permissions, and side effects

- **Services and network:** ZCode provides the conversational model. Hyper3D
  provides the hosted Rodin/BANG service. MCP traffic goes to
  `api.hyper3d.com`; browser sign-in and result pages use Hyper3D's web service
  at `hyper3d.ai` and the endpoints advertised by OAuth metadata. Image uploads
  and requested file downloads also access the storage/CDN hosts in the signed
  URLs returned by Hyper3D. These URLs are temporary; avoid printing or sharing them. MCP responses and
  upload/download tool cards may retain signed URLs in ZCode history; this
  plugin cannot guarantee host-side redaction. Redact them before sharing logs
  or screenshots, and use host secret-redaction features when available.
- **Data:** Prompts, selected reference images, generation settings, and task
  identifiers are sent to Hyper3D as needed. The plugin does not request a
  repository upload. Status/result access is limited to the authorized user's
  generations; group billing does not grant access to other members' models.
- **Charges and recovery:** Generation and BANG consume Hyper3D credits and
  create remote tasks. The Skill explains the credit use before the first paid
  submission and does not generate merely to test a connection. These calls
  are not idempotent: after a timeout or connection error, check the known task
  or ask the user to inspect Hyper3D Mine before deciding on a new submission.
  Insufficient balance or entitlement is reported without silently changing
  the workspace or requested settings.
- **Local execution and files:** The package has no local MCP server, bundled
  executables, install scripts, commands, or hooks, and requires no additional
  Node.js/Python runtime or model API key. ZCode manages installation and OAuth
  state. The agent may use host file/network tools or shell commands to inspect
  the selected images and upload them. Downloading models writes local files
  only when requested by the user. Shell arguments must be safely quoted and
  signed URLs must not be exposed in shared output. Importing into Blender,
  Unreal, or another DCC is outside this plugin's scope.
- **Results:** Show the permanent `display_url` after completion. Temporary
  `files[].url` values are for requested downloads, not user-facing links.

## License

The plugin configuration, Skill, and documentation are licensed under the
[MIT License](./LICENSE). The remote MCP service is operated by Deemos;
its server implementation and generated assets are outside this license and
remain subject to Hyper3D's applicable terms. The Hyper3D icon identifies the
service and does not grant trademark rights.
