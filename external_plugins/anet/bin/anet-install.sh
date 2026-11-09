#!/bin/sh
# Installs the anet command line with the official installer.
#
# `sh install-anet.sh [installer arguments]` downloads https://agentnetwork.org.cn/install.sh
# into a new private directory, runs it only when the download succeeded, and
# removes the directory afterwards. The installer checks the signed release
# manifest and the SHA-256 of the binary and stops without changing anything
# when a check fails. The script exists so that an agent host that refuses
# command substitution in a shell command can still run the installation as one
# plain command.
set -u

umask 077
dir=$(mktemp -d 2>/dev/null) || {
  echo "Error: a temporary directory could not be created." >&2
  exit 1
}
trap 'rm -rf "$dir"' EXIT
trap 'exit 1' HUP INT TERM

if ! curl --proto '=https' --tlsv1.2 -fsSL https://agentnetwork.org.cn/install.sh -o "$dir/install.sh"; then
  echo "Error: the installer could not be downloaded." >&2
  exit 1
fi
sh "$dir/install.sh" "$@"
