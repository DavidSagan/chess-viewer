#!/bin/bash
# Builds "Chess PDF Viewer.app" next to this script.
# Usage: build.sh [version]
set -euo pipefail
cd "$(dirname "$0")"

version="${1:-0.0.0}"

app="Chess PDF Viewer.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
# Build for both Apple silicon and Intel Macs, running on macOS 12 and later
swiftc -O -target arm64-apple-macos12 main.swift -o "$app/viewer-arm64"
swiftc -O -target x86_64-apple-macos12 main.swift -o "$app/viewer-x86_64"
lipo -create "$app/viewer-arm64" "$app/viewer-x86_64" -output "$app/Contents/MacOS/ChessPDFViewer"
rm "$app/viewer-arm64" "$app/viewer-x86_64"

cat > "$app/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Chess PDF Viewer</string>
  <key>CFBundleIdentifier</key><string>local.chess-pdf-viewer</string>
  <key>CFBundleExecutable</key><string>ChessPDFViewer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>VERSION</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>PDF</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key><array><string>com.adobe.pdf</string></array>
    </dict>
  </array>
</dict>
</plist>
EOF

plutil -replace CFBundleShortVersionString -string "$version" "$app/Contents/Info.plist"
codesign --force --sign - "$app"
echo "Built $PWD/$app"
