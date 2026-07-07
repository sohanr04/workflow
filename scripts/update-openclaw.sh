#!/usr/bin/env bash
# Auto-update OpenClaw: pulls the latest source into vendor/openclaw and
# updates the running install to match, then restarts the gateway.
# Run manually or via the systemd timer in ../openclaw/systemd/.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Pulling latest OpenClaw source into vendor/openclaw"
git -C "$REPO_DIR" submodule update --remote --depth 1 vendor/openclaw
NEW_REV=$(git -C "$REPO_DIR/vendor/openclaw" rev-parse --short HEAD)
echo "    source now at $NEW_REV"

echo "==> Updating the runnable install (npm builds of this same source)"
npm install -g openclaw@latest

echo "==> Restarting gateway"
openclaw gateway restart || echo "    (gateway not running; skipped restart)"

echo "==> Done. Installed version: $(openclaw --version 2>/dev/null || echo unknown)"
echo "    Tip: commit the submodule bump to track what you're running:"
echo "    git add vendor/openclaw && git commit -m \"Bump openclaw to $NEW_REV\""
