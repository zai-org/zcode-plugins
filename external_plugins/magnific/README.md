# Magnific

Turn ideas, product photos, scripts, and reference images into visual campaigns with Magnific. This standard plugin bundles 12 skills, a `/magnific` command, and the official remote Magnific MCP connection. It declares no MCP Apps UI surfaces.

## Install and connect

For local review, follow the repository's [development guide](../../docs/PLUGIN_DEVELOPMENT.md): build the repository, add `dist/local-marketplace` as a local marketplace, and install `magnific@zcode-plugins-local`. After a marketplace release, install Magnific from the ZCode plugin catalog.

Enable the Magnific MCP connection and complete the browser sign-in requested by the client. A Magnific account and sufficient credits are required for paid operations. The endpoint is `https://mcp.magnific.com/mcp` (Streamable HTTP, OAuth 2.1). Authentication is handled by the host and Magnific; no API keys or tokens are bundled. ZCode runtime compatibility still needs verification; this package does not claim a completed ZCode installation or generation test.

Start with `/magnific What is my credit balance?` or `/magnific Plan a 15-second product ad; estimate the cost before generating anything.` Read-only account checks do not substitute for a paid generation test. Follow the skill's cost simulation and approval instructions before spending credits.

## Included workflows

- `magnific-essentials`: tool discovery, models, cost estimates, uploads and job handling.
- `ad-campaign`, `video-ad`: campaign assets and video advertising.
- `product-imagery`, `precise-image-edits`: product photography and targeted edits.
- `cinematic-shots`, `scene-direction`, `fight-scenes`: camera, staging and action.
- `consistent-characters`, `previs-storyboard`: character continuity and storyboards.
- `sound-and-voice`, `video-finishing`: audio, dubbing, upscaling and delivery.

## Dependencies and side effects

Internet access to Magnific's MCP and authentication services is required. Workflows may use service-provided upload and download URLs; user-selected images, video, audio and prompts can be sent to Magnific for processing. Generation, editing, audio and finishing operations can consume the signed-in user's credits. Plans and credits are purchased separately from the plugin.

The skills may ask the agent to run shell commands such as `curl` for uploads or downloads and write requested output files. The optional local `skills/product-imagery/scripts/packshot.py` helper requires Python 3 and Pillow and reads/writes the supplied local image paths; it makes no network requests. Dependencies are not installed automatically. The package includes no hooks, background daemon, bundled executable or local MCP server.

## Source, license and support

Skills, command, image helper, icon, MCP configuration and MIT license are copied unchanged from [freepik-company/magnific-plugin](https://github.com/freepik-company/magnific-plugin) version **1.3.0**, commit `857f25194f57390941c79bb73c9176a8137d1894`. The ZCode manifest, marketplace metadata and bilingual documentation are packaging additions. This is the first ZCode package version, 1.3.0.

The bundled plugin is MIT licensed; the hosted service is subject to Magnific's separate terms. See [MCP documentation](https://docs.magnific.com/modelcontextprotocol), [privacy policy](https://www.magnific.com/legal/privacy), [terms](https://www.magnific.com/legal/terms-of-use) and [support](https://www.magnific.com/ai/support).
