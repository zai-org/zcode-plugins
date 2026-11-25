# Android Device Runner

Run Android projects from ZCode: a side panel with devices, build, install, launch and logcat.

## What it does

**Side panel** (`ui.surfaces`)

- Device cards: model, serial, Android version, physical/emulator; click to switch the target device
- Emulators: lists AVDs and boots one, waiting until it is ready (up to 180s)
- App: package name, module/variant, Flavor (dropdown or typed), **the exact Gradle task and mode (single-flavor debug / plain debug)**, APK size/time and full path
- Environment: live SDK / adb / JDK / Gradle detection results
- Actions: run (build → install → launch), build, install, launch, stop, restart, logcat, environment check, uninstall, clear data
- Console: streamed output of build/install/launch; a second tab streams logcat

**CLI** (`scripts/ar.js`, zero dependencies)

```bash
node scripts/ar.js doctor          # environment self-check
node scripts/ar.js devices         # devices and emulators
node scripts/ar.js use <serial>    # remember the target device
node scripts/ar.js run             # build → install → launch
node scripts/ar.js logcat          # logcat, filtered to the app process
```

`ar.js --help` lists every command.

## Zero-config detection

| Item | Detection order |
|---|---|
| Project root | find `gradlew` inside the current workspace (6 levels up / recursive down) |
| adb | `local.properties` → `ANDROID_HOME` → common SDK dirs → `PATH` |
| JDK | saved choice for this project → `org.gradle.java.home` → `.idea/gradle.xml` `gradleJvm` → `JAVA_HOME` → Android Studio JBR → system `java` → installed JDKs (picks one compatible with the Gradle version) |
| Flavor | `productFlavors` in the module build file; defaults to `official` (else the only flavor / `dev`) |
| Package name | `output-metadata.json` → module `build.gradle` `applicationId` |
| APK | newest artifact under `build/outputs/apk/<flavor>/<variant>/` (also reads AGP 3.x `output.json`) |

Anything undetected can be passed explicitly: `--module`, `--variant`, `--flavor`, `--apk`, `--package`, `--adb`, `--java-home`.

### JDK and flavors

- **The JDK must match the Gradle version.** The plugin reads `gradle-wrapper.properties` and `gradle.properties` (e.g. a legacy `-XX:MaxPermSize` only works on Java 8) and auto-picks a compatible JDK, preferring the one configured by the project.
- Pin one: `ar java <path or 17 / corretto-17>` (saved per project); `ar java --clear` restores auto; one-off with `--java-home` or `AR_JAVA_HOME`. The panel's environment section can switch it too. Or use the `/android-java` shortcut.
- Multi-channel projects (`channel.txt` + `productFlavors`) default to the `official` **debug** variant — runs and builds stay on debug and never build every channel at once. Pass `--flavor <name>` for one specific channel (still debug only). With several detected flavors and no `official`, the plugin asks you to choose; when no flavor name can be detected at all, it falls back to a plain debug build (the panel also accepts a typed name).
- Pin a channel: `ar flavor <name>` (saved per project, `ar flavor --clear` restores auto), the panel's Flavor dropdown, or `/android-flavor`; one-off with `--flavor <name>`.
- The panel's Flavor row supports both a dropdown and free input: when flavors are generated dynamically, type the name and click Apply (or use `/android-flavor <name>`).

## Permissions

- Panel **state, job output and logcat refresh go through MCP resources** (`ui://android-runner/state.json`, etc.), not tool calls, so periodic refreshes no longer trigger approval prompts.
- Only **clicking an action button** calls an MCP tool (build/install/run, switching device/JDK/flavor, logcat start/stop). ZCode asks once according to the current permission mode — that is a real side effect and expected.
- ZCode currently marks every MCP tool as approval-required (even with `readOnlyHint`), so avoid tool polling for status.
- Running `ar.js` through the agent's shell may still trigger Bash approval; prefer the panel, or use full-access mode.
- The plugin **does not modify project files by default** (no auto-created `local.properties`); builds pass the SDK via `ANDROID_HOME`.

## Side effects and safety

- **Command execution**: runs the project's own `gradlew` and `adb` on the local machine. No network access of its own.
- **File writes**: **the project is not modified by default** — no more auto-created `local.properties`; builds pass the SDK via `ANDROID_HOME`. Opt in with `--local-properties` if needed. Preferences live in `~/.android-runner/`; build outputs in `build/`.
- **Destructive**: on signature mismatch or version downgrade, install **uninstalls and reinstalls automatically**, wiping the app's local data. Opt out with `--no-reinstall`; `--reinstall` opts back in and wins over `--no-reinstall`. Before uninstalling it verifies the package actually installed on the device, so `applicationIdSuffix` builds are handled.
- `uninstall` / `clear-data` are destructive: the panel asks for confirmation, the CLI requires an explicit `--yes`.
- **Multiple devices**: with more than one online device and no target selected, the panel asks you to pick one and disables install/launch-style actions. `build` is unaffected and never needs a device.
- **MCP server**: a local stdio server (`scripts/mcp-server.mjs`) serving the panel and running the CLI. It binds no ports.

## Requirements

- ZCode Desktop with `ui.surfaces` support
- Node.js 18+ on `PATH` (starts the MCP server)
- Android SDK with `platform-tools/adb`
- A Gradle Wrapper (`gradlew`) in the project

## Structure

```
.zcode-plugin/plugin.json   # manifest: ui.surfaces + MCP server
assets/panel.html           # side panel UI
scripts/mcp-server.mjs      # MCP server: tools, resources, background jobs
scripts/ar.js               # CLI core: detection, devices, build, install, launch, logcat
scripts/project-info.js     # module / APK / package detection
skills/android-runner/      # skill instructions
commands/                   # /android-run, /android-doctor, /android-devices, /android-panel
```

## License

MIT. The detection and execution logic is ported from
[menggod/android-runner](https://github.com/menggod/android-runner); the original
`LICENSE` is kept in this directory.
