#!/usr/bin/env bash
# 手动组装 macOS .app：复用 release/mac-arm64.tmp 里的 Electron.app 框架，把 out/ + assets/ 放进去
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="release/mac-arm64"
SRC_APP="node_modules/electron/dist/Electron.app"
BUNDLE="$OUT_DIR/桃屁屁.app"

if [ ! -d "$BUNDLE" ] || [ ! -f "$BUNDLE/Contents/Info.plist" ] || [ ! -d "$BUNDLE/Contents/Frameworks" ]; then
  echo "no complete Electron.app at $BUNDLE; copying from $SRC_APP"
  rm -rf "$BUNDLE" 2>/dev/null || true
  mkdir -p "$OUT_DIR"
  cp -R "$SRC_APP" "$BUNDLE"
fi

# 2) 准备 app/ 资源目录（放 out/ + 必需资源）
APP_RES="$BUNDLE/Contents/Resources/app"
rm -rf "$APP_RES"
mkdir -p "$APP_RES"
cp -R out assets "$APP_RES"/

# 3) 应用图标
cp assets/app-icon/pipeach.icns "$BUNDLE/Contents/Resources/" || true

# 4) 改 Info.plist 显示名 + 包 ID
plutil -replace CFBundleName -string "桃屁屁" "$BUNDLE/Contents/Info.plist"
plutil -replace CFBundleDisplayName -string "桃屁屁" "$BUNDLE/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string "com.pipeach.desktop" "$BUNDLE/Contents/Info.plist"
plutil -replace CFBundleIconFile -string "pipeach.icns" "$BUNDLE/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "0.1.0" "$BUNDLE/Contents/Info.plist"
plutil -replace CFBundleVersion -string "1" "$BUNDLE/Contents/Info.plist"
plutil -replace LSApplicationCategoryType -string "public.app-category.productivity" "$BUNDLE/Contents/Info.plist"

# 5) PkgInfo
printf "APPL????" > "$BUNDLE/Contents/PkgInfo"

# 6) ad-hoc 签名（让 macOS Gatekeeper 不拦）
codesign --force --deep --sign - "$BUNDLE" 2>/dev/null || true

echo "packaged: $BUNDLE"
