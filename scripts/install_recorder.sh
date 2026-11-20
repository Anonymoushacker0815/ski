#!/bin/sh
# Richtet die tägliche Schnee-Erfassung als macOS-LaunchAgent ein
# (läuft um 09:30 und 14:30, kurz nach den LiftRadar-Updates; verpasste
# Läufe holt macOS nach dem Aufwachen nach).
#
#   sh scripts/install_recorder.sh            # einrichten
#   sh scripts/install_recorder.sh --uninstall # entfernen
set -eu

LABEL="local.ski-kaernten.recorder"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$(command -v python3)"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Erfassung entfernt."
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/data"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$ROOT/scripts/record_snow.py</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>14</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$ROOT/data/recorder.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/recorder.log</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Erfassung eingerichtet: $PLIST"
echo "Log: $ROOT/data/recorder.log"
