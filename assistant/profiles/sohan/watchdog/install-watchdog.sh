#!/bin/bash
# One-time installer for the Grand Empire gateway watchdog.
# After this runs, launchd keeps the gateway (Winston) alive forever:
#   - relaunches it instantly if it crashes or is killed
#   - starts it automatically on reboot / login
#   - a restart NEVER again needs Sohan at the terminal
#
# Run once:   bash install-watchdog.sh
# Uninstall:  bash install-watchdog.sh --uninstall
set -e

WD="/Users/sohanramchandani/workflow/assistant/profiles/sohan/watchdog"
LABEL="com.grandempire.gateway"
PLIST_SRC="$WD/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "$1" = "--uninstall" ]; then
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  rm -f "$PLIST_DST"
  echo "Watchdog removed. Gateway will no longer auto-restart."
  exit 0
fi

chmod +x "$WD/run-gateway.sh"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST_SRC" "$PLIST_DST"

# Idempotent: unload an old copy first, then load fresh.
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo ""
echo "  Watchdog installed + running."
echo "  launchd now owns the gateway ($LABEL)."
echo ""
echo "  IMPORTANT: if a gateway is still running in an old terminal window,"
echo "  close that window — launchd's copy is the one in charge now."
echo ""
echo "  Restart Winston any time (from ANY terminal, no window needed):"
echo "    launchctl kickstart -k gui/\$(id -u)/$LABEL"
echo ""
echo "  Logs:  $WD/gateway.log   (and .err.log)"
