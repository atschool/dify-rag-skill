#!/usr/bin/env bash
#
# Install dify-rag-gateway as a per-user launchd service on macOS.
#
# Run this on the Dify host after ./install.sh:
#   ./scripts/install-gateway-launchd.sh
#
set -euo pipefail

LABEL="com.atschool.dify-rag-gateway"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
CONFIG_DIR="$HOME/.dify-rag"
GATEWAY_DIR="$CONFIG_DIR/gateway"
GATEWAY_SERVER="$GATEWAY_DIR/server.mjs"
LOG_DIR="$CONFIG_DIR/logs"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

if [ -z "$NODE_BIN" ]; then
    echo "node was not found. Install Node.js, then rerun ./install.sh and this script." >&2
    exit 1
fi

if [ ! -f "$GATEWAY_SERVER" ]; then
    echo "$GATEWAY_SERVER was not found." >&2
    echo "Run ./install.sh from the dify-rag-skill repository first." >&2
    exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${GATEWAY_SERVER}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${GATEWAY_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/gateway.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/gateway.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
    launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
fi

launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/${LABEL}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "Installed launchd service: ${LABEL}"
echo "Plist: $PLIST"
echo "Logs:"
echo "  $LOG_DIR/gateway.out.log"
echo "  $LOG_DIR/gateway.err.log"
echo ""
echo "Verify:"
echo "  curl -s http://127.0.0.1:8787/health"
