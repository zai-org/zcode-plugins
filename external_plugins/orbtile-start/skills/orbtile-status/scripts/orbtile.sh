#!/bin/sh
# Orbtile starter script, shared by the agent plugins in this repo.
# Source of truth: shared/orbtile.sh. Each plugin carries an identical copy (tests check this).
#
#   orbtile.sh <agent> session-start   Session-start hook: at most one line a day pointing to the Orbtile app,
#                                      nothing once Orbtile's own integration for <agent> is set up.
#   orbtile.sh <agent> status          Plain-text setup check.
#   <agent>: claude | codex | antigravity | zcode
#
# Reads local files only. Sends nothing anywhere. Always exits 0 so it can never block a session.

agent="${1:-}"
command="${2:-}"
download_url="https://orbtile.com/download"

# The Orbtile app runs on macOS and Windows. Elsewhere (Linux, WSL) the starter never points to a download.
case "${ORBTILE_START_OS:-$(uname -s 2>/dev/null)}" in  # ORBTILE_START_OS: override for tests only
    Darwin) platform=mac ;;
    MINGW*|MSYS*|CYGWIN*|Windows*) platform=windows ;;
    *) platform=other ;;
esac

case "$agent" in
    claude)
        agent_name="Claude Code"
        pitch="Orbtile shows your Claude Code sessions live on a keypad and lets you answer them from the keys"
        config_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
        state_dir="${CLAUDE_PLUGIN_DATA:-}"
        check_hint="run /orbtile to check setup"
        done_line="Next step: none. Orbtile is set up; this starter plugin stays quiet and can be removed with: /plugin uninstall orbtile-start@orbtile-public"
        hooks_optional=""
        ;;
    codex)
        agent_name="Codex"
        pitch="Orbtile shows your Codex sessions live on a keypad"
        config_file="${CODEX_HOME:-$HOME/.codex}/hooks.json"
        state_dir="${PLUGIN_DATA:-}"
        check_hint="ask Codex to check your Orbtile setup"
        done_line="Next step: none. Orbtile is set up; this starter plugin stays quiet and can be removed with: codex plugin remove orbtile-start@orbtile-public"
        hooks_optional="Orbtile reads Codex sessions without them"  # Codex is a zero-install adapter in the app
        ;;
    antigravity)
        agent_name="Antigravity"
        pitch="Orbtile shows your Antigravity sessions live on a keypad"
        config_file="$HOME/.gemini/config/hooks.json"
        state_dir=""
        check_hint="ask Antigravity to check your Orbtile setup"
        done_line="Next step: none. Orbtile is set up. You can remove the orbtile-start plugin from Antigravity."
        hooks_optional="Orbtile reads Antigravity sessions without them"  # zero-install adapter in the app
        ;;
    zcode)
        agent_name="ZCode"
        pitch="Orbtile shows your ZCode tasks live on a keypad"
        config_file="$HOME/.zcode/cli/config.json"
        state_dir="${ZCODE_PLUGIN_DATA:-}"
        check_hint="ask ZCode to check your Orbtile setup"
        done_line="Next step: none. Orbtile is set up. You can remove the orbtile-start plugin from ZCode."
        hooks_optional="Orbtile follows ZCode tasks from their files without them"  # read-only adapter; one optional approval hook
        ;;
    *)
        echo "usage: orbtile.sh claude|codex|antigravity|zcode session-start|status" >&2
        exit 0
        ;;
esac

# Config text on one line ("" when the file is missing or unreadable).
config_text() {
    [ -r "$config_file" ] && tr -d '\r\n' < "$config_file" 2>/dev/null
}

# Which Orbtile integration is set up for this agent, or nothing.
hook_marker() {
    text=$(config_text)
    [ -n "$text" ] || return 0
    case "$agent" in
        claude)
            # Mac app: enabledPlugins "orbtile@orbtile" (or the Enterprise / Sandbox ids) is true, or a
            # marketplace path points at an Orbtile claude-plugin folder (Mac, or a remote host the app set up).
            id=$(printf '%s' "$text" | grep -Eo '"(orbtile@orbtile|orbtile-enterprise@orbtile-enterprise|orbtile-sandbox@orbtile-sandbox)"[[:space:]]*:[[:space:]]*true' | head -n 1 | cut -d '"' -f 2)
            if [ -n "$id" ]; then echo "plugin $id"; return 0; fi
            if printf '%s' "$text" | grep -Eq '"path"[[:space:]]*:[[:space:]]*"[^"]*[Oo]rbtile[^"]*claude-plugin[/\\]*"'; then
                echo "Orbtile plugin folder"; return 0
            fi
            # Windows app: its hook commands carry --orbtile-claude-hook.
            if printf '%s' "$text" | grep -q -- '--orbtile-claude-hook'; then echo "Orbtile hooks"; return 0; fi
            ;;
        codex)
            # Mac app and remote hosts: orbtile-codex-hook; Windows app: --orbtile-agent.
            if printf '%s' "$text" | grep -Eq -- 'orbtile(-[a-z]+)?-codex-hook|--orbtile-agent'; then
                echo "Orbtile hooks"; return 0
            fi
            ;;
        antigravity)
            # Mac app: orbtile-antigravity-hook; Windows app: --orbtile-agent.
            if printf '%s' "$text" | grep -Eq -- 'orbtile(-[a-z]+)?-antigravity-hook|--orbtile-agent'; then
                echo "Orbtile hooks"; return 0
            fi
            ;;
        zcode)
            # The app's one approval hook. Mac app and remote hosts: orbtile-zcode-hook; Windows app: --orbtile-agent.
            if printf '%s' "$text" | grep -Eq -- 'orbtile(-[a-z]+)?-zcode-hook|--orbtile-agent'; then
                echo "Orbtile hooks"; return 0
            fi
            ;;
    esac
}

# Path of an installed Orbtile app, or nothing.
app_path() {
    apps="${ORBTILE_START_APPS_DIR:-/Applications}"  # override for tests only
    for p in "$apps/Orbtile.app" "$HOME/Applications/Orbtile.app" \
             "$apps/Orbtile Enterprise.app" "$HOME/Applications/Orbtile Enterprise.app"; do
        if [ -d "$p" ]; then echo "$p"; return 0; fi
    done
    # Windows (Git Bash): the app keeps its data in %LOCALAPPDATA%\Orbtile.
    if [ -n "${LOCALAPPDATA:-}" ] && [ -d "$LOCALAPPDATA/Orbtile" ]; then echo "$LOCALAPPDATA/Orbtile"; return 0; fi
    # Mac app run from another folder.
    if app_running; then echo "running"; return 0; fi
}

# Mac only: is Orbtile running? (false elsewhere)
app_running() {
    [ "$platform" = mac ] || return 1
    [ -z "${ORBTILE_START_APPS_DIR:-}" ] || return 1  # tests describe the installed apps themselves
    pgrep -x Orbtile >/dev/null 2>&1 || pgrep -x "Orbtile Enterprise" >/dev/null 2>&1
}

session_start() {
    [ "$platform" != other ] || return 0
    # Codex and ZCode can load Claude-format plugins; they then set PLUGIN_ROOT or ZCODE_PLUGIN_ROOT, which Claude Code
    # does not. The Claude Code line stays out of their sessions.
    if [ "$agent" = claude ] && { [ -n "${PLUGIN_ROOT:-}" ] || [ -n "${ZCODE_PLUGIN_ROOT:-}" ]; }; then return 0; fi
    [ -z "$(hook_marker)" ] || return 0
    # Agents the app follows without hooks: an installed app is a set-up app.
    if [ -n "$hooks_optional" ] && [ -n "$(app_path)" ]; then return 0; fi
    # Once a day at most. Without a writable state folder it still shows (the hook runs once per new session).
    today=$(( $(date +%s) / 86400 ))
    if [ -n "$state_dir" ]; then
        if [ "$(cat "$state_dir/last-shown-day" 2>/dev/null)" = "$today" ]; then return 0; fi
        mkdir -p "$state_dir" 2>/dev/null && printf '%s\n' "$today" > "$state_dir/last-shown-day" 2>/dev/null
    fi
    if [ -n "$(app_path)" ]; then
        msg="Orbtile is installed but not connected to $agent_name yet. Open Orbtile to connect it ($check_hint)."
    else
        msg="$pitch: $download_url ($check_hint)"
    fi
    printf '{"systemMessage":"%s"}\n' "$msg"
}

status() {
    marker=$(hook_marker)
    app=$(app_path)
    echo "Orbtile setup check for $agent_name"
    case "$app" in
        "") if [ "$platform" = other ]; then echo "- Orbtile app: runs on macOS and Windows, not on this system"
            else echo "- Orbtile app: not found on this computer"; fi ;;
        running) echo "- Orbtile app: found (running)" ;;
        *) echo "- Orbtile app: found at $app" ;;
    esac
    if [ -n "$hooks_optional" ]; then
        if [ -n "$marker" ]; then echo "- Orbtile's $agent_name hooks: on ($marker in $config_file)"
        else echo "- Orbtile's $agent_name hooks: off (optional: $hooks_optional)"; fi
    elif [ -n "$marker" ]; then echo "- $agent_name integration: on ($marker in $config_file)"
    else echo "- $agent_name integration: off (nothing from Orbtile in $config_file)"; fi
    if [ -n "$app" ] && [ "$platform" = mac ]; then
        if app_running; then echo "- Orbtile running: yes"; else echo "- Orbtile running: no"; fi
    fi
    if [ -n "$marker" ] || { [ -n "$hooks_optional" ] && [ -n "$app" ]; }; then
        if [ "$agent" = "codex" ] && [ -n "$marker" ]; then
            echo "- Note: Codex runs Orbtile's hooks only after you trust them once in /hooks (Settings > Hooks in the Codex app)."
        fi
        echo "$done_line"
    elif [ -n "$app" ]; then
        echo "Next step: open Orbtile and connect $agent_name in its settings."
    elif [ "$platform" = other ]; then
        echo "Next step: none here. Orbtile runs on macOS and Windows."
    else
        echo "Next step: download Orbtile from $download_url"
    fi
}

case "$command" in
    session-start) session_start ;;
    status) status ;;
    *) echo "usage: orbtile.sh claude|codex|antigravity|zcode session-start|status" >&2 ;;
esac
exit 0
