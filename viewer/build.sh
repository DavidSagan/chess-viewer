#!/bin/bash
# Builds "Chess Book Viewer.app" next to this script.
set -euo pipefail
cd "$(dirname "$0")"

app="Chess Book Viewer.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
# Build for both Apple silicon and Intel Macs, running on macOS 12 and later
swiftc -O -target arm64-apple-macos12 main.swift -o "$app/viewer-arm64"
swiftc -O -target x86_64-apple-macos12 main.swift -o "$app/viewer-x86_64"
lipo -create "$app/viewer-arm64" "$app/viewer-x86_64" -output "$app/Contents/MacOS/ChessBookViewer"
rm "$app/viewer-arm64" "$app/viewer-x86_64"

cat > "$app/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Chess Book Viewer</string>
  <key>CFBundleIdentifier</key><string>local.chess-book-viewer</string>
  <key>CFBundleExecutable</key><string>ChessBookViewer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
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

codesign --force --sign - "$app"
echo "Built $PWD/$app"
