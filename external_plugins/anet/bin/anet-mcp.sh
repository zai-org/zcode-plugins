#!/bin/sh
# Starts the MCP server of the local anet node (`anet mcp`, stdio) for the
# executable and identity of the plugin settings; see anet-run.sh. The server
# forwards every call to the running daemon of the selected identity and exits
# with status 1, with the reason on stderr, when no daemon runs for it.
set -u
ANET_PLUGIN_SETTINGS=env
export ANET_PLUGIN_SETTINGS
exec sh "$(dirname "$0")/anet-run.sh" mcp
