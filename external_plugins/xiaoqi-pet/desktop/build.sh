#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
APP="$DIST/ZCode Xiaoqi Pet.app"
ARCH="$(uname -m)"
TARGET="${ARCH}-apple-macos13.0"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "Compiling XiaoqiPet for $TARGET…"
xcrun swiftc \
  -O \
  -swift-version 5 \
  -target "$TARGET" \
  -o "$APP/Contents/MacOS/XiaoqiPet" \
  "$ROOT/Sources/"*.swift \
  -framework SwiftUI \
  -framework AppKit \
  -framework Foundation

cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/Resources/pet.svg" "$APP/Contents/Resources/pet.svg"

if [[ -f "$ROOT/Resources/AppIcon.icns" ]]; then
  cp "$ROOT/Resources/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
fi

codesign --force --deep --sign - "$APP" >/dev/null
echo "Built: $APP"

if [[ "${1:-}" == "--install" ]]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/ZCode Xiaoqi Pet.app"
  ditto "$APP" "$HOME/Applications/ZCode Xiaoqi Pet.app"
  echo "Installed: $HOME/Applications/ZCode Xiaoqi Pet.app"
fi
