# Unity

Unity 0.1.4 packages Unity Technologies’ official CLI skill and references, plus installation, environment detection, and version compatibility guidance for ZCode. It registers no MCP server or UI extension.

## Use

Install Unity from the plugin marketplace and ask: “Use Unity to inspect my open project and create a test cube.” The `unity-cli` skill drives the Editor; `unity-setup` handles installation, licensing, environment checks, and version differences. The official skill entry links to the compatibility guidance before executing commands.

Install the official Unity CLI and a matching Unity Editor with an active license. Live Editor operations require the project’s Unity Pipeline package and a running compatible Editor (Unity 6+). Node.js is needed only for the optional read-only environment helper. Do not migrate an existing project just to enable Pipeline.

## Compatibility and verification

A user-reported Windows smoke test passed with CLI 1.0.0-beta.6, Editor 6000.3.26f1, and Pipeline 0.9.0-exp.1: skill loading, diagnostics, connection, command discovery, C# evaluation, scene objects, hierarchy, Play mode, screenshots, assets, and script compilation. Player builds and test-runner execution were not tested.

Version 0.1.2 adds guidance for quoted multiword commands, asset paths, unsupported flags, bounded reconnection after domain reload, and avoiding an update feed that reports an older release. The revised guidance has static validation; it has not yet been re-tested on Windows. Keep the working CLI version and inspect installed command schemas before mutations.

## Dependencies and side effects

This package adds instructions and a read-only Node.js helper, not a bundled Unity binary or automatic installer. No hooks run on installation. Requested CLI operations can execute C#, modify project files/assets/scenes, install packages, start Editors, or create build output. Downloads, sign-in, license operations, and release queries contact Unity services or the selected official package registry. Local Pipeline operations connect to the running Editor. A model is provided by the host ZCode session; this plugin configures no model endpoint or credentials. Account login and license/terms acceptance remain interactive user steps.

## License

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Unity’s skill is pinned to upstream commit `9d282100540601cfddc4bbd69f36a239d7a6f55c` under the included Unity Companion License. Its entrypoint has a marked ZCode compatibility note; a redacted proxy URL example is expressed in prose for public mirroring; all other upstream content is retained. Z.ai integration helpers are MIT-licensed.
