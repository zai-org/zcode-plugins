# Android Device Runner

Run Android projects from ZCode: a side panel with devices, build, install, launch and logcat.

## What it does

**Side panel** (`ui.surfaces`)

- Device cards: model, serial, Android version, physical/emulator; click to switch the target device
- Emulators: lists AVDs and boots one, waiting until it is ready (up to 180s)
- App: package name, module/variant, APK size and build time
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
| Project root | `gradlew` inside the current window's workspace (6 levels up, then downward scan) |
| adb | `local.properties` → `ANDROID_HOME` → common SDK locations → `PATH` |
| JDK | `.idea/gradle.xml` `gradleJvm` → `JAVA_HOME` → platform default |
| Package name | `output-metadata.json` → module `build.gradle` `applicationId` |
| APK | newest artifact under `build/outputs/apk/<variant>/` |

Anything undetected can be passed explicitly: `--module`, `--variant`, `--apk`, `--package`, `--adb`, `--java-home`.

## Side effects and safety

- **Command execution**: runs the project's own `gradlew` and `adb` on the local machine. No network access of its own.
- **File writes**: may create `local.properties` when missing (contains `sdk.dir`); remembers device/project choices in `~/.android-runner/`.
- **Destructive**: on signature mismatch or version downgrade, install **uninstalls and reinstalls automatically**, wiping the app's local data. Opt out with `--no-reinstall`.
- `uninstall` / `clear-data` are destructive: the panel asks for confirmation, the CLI requires an explicit `--yes`.
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
