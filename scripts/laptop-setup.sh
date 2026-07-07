#!/usr/bin/env bash
# Laptop setup checker: run this on the always-on machine after cloning.
# It verifies every prerequisite and prints exactly what's left to do.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-sohan}"
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
todo() { printf '  \033[33mTODO\033[0m %s\n' "$1"; MISSING=1; }
MISSING=0

echo "== Checking prerequisites for profile '$PROFILE' =="

# Node 20+
if command -v node >/dev/null && [ "$(node -e 'console.log(+process.versions.node.split(".")[0])')" -ge 20 ]; then
  ok "node $(node --version)"
else
  todo "install Node 20+ (https://nodejs.org or your package manager)"
fi

# Claude Code CLI, logged in
if command -v claude >/dev/null; then
  ok "claude CLI $(claude --version 2>/dev/null | head -1)"
  if claude auth status >/dev/null 2>&1 || [ -d "$HOME/.claude" ]; then
    ok "claude appears configured (run 'claude' once to confirm login)"
  else
    todo "log in: claude login   (uses your Claude subscription)"
  fi
else
  todo "install Claude Code: npm install -g @anthropic-ai/claude-code && claude login"
fi

# assistant dependencies (Baileys for WhatsApp)
if [ -d "$REPO_DIR/assistant/node_modules/@whiskeysockets" ]; then
  ok "assistant dependencies installed"
else
  todo "install deps: cd $REPO_DIR/assistant && npm install"
fi

# profile exists
if [ -f "$REPO_DIR/assistant/profiles/$PROFILE/profile.json" ]; then
  ok "profile '$PROFILE' found"
else
  todo "profile missing: cp -r assistant/profiles/_template assistant/profiles/$PROFILE"
fi

# WhatsApp linked?
if [ -f "$REPO_DIR/assistant/profiles/$PROFILE/state/whatsapp-auth/creds.json" ]; then
  ok "WhatsApp linked for '$PROFILE'"
else
  todo "link WhatsApp: cd assistant && node whatsapp.js $PROFILE   (scan the QR, then Ctrl-C)"
fi

# Telegram token (optional channel)
if [ -f "$REPO_DIR/assistant/.env" ] && grep -q "TELEGRAM_BOT_TOKEN" "$REPO_DIR/assistant/.env" 2>/dev/null; then
  ok "Telegram token present (.env)"
else
  echo "  INFO Telegram channel optional: cp assistant/.env.example assistant/.env + BotFather token"
fi

# Sleep settings (Linux laptop lids)
if [ -f /etc/systemd/logind.conf ] && grep -q '^HandleLidSwitch=ignore' /etc/systemd/logind.conf; then
  ok "lid-close suspend disabled"
elif [ "$(uname)" = "Linux" ]; then
  echo "  INFO laptop will sleep on lid close unless you set HandleLidSwitch=ignore"
  echo "       in /etc/systemd/logind.conf, then: sudo systemctl restart systemd-logind"
fi

echo
if [ "$MISSING" = "0" ]; then
  echo "All set. Run it 24/7 with systemd:"
  echo "  1. edit the EDIT_ME lines in assistant/systemd/assistant-wa@.service"
  echo "  2. sudo cp assistant/systemd/assistant-wa@.service /etc/systemd/system/"
  echo "  3. sudo systemctl daemon-reload && sudo systemctl enable --now assistant-wa@$PROFILE"
  echo "  (same pattern with assistant@.service for the Telegram channel)"
  echo "Logs: journalctl -u assistant-wa@$PROFILE -f"
else
  echo "Fix the TODO items above, then run this script again."
fi
