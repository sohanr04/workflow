#!/usr/bin/env bash
# winston-doctor.sh — run on the Air to see exactly what Winston needs before
# he can go active. Checks each prerequisite; green = ready, red = do this.
#   cd ~/Projects/workflow/assistant && ./winston-doctor.sh
set -uo pipefail
cd "$(dirname "$0")"
ok(){ echo "  ✓ $1"; } ; no(){ echo "  ✗ $1"; } ; hdr(){ echo; echo "$1"; }

hdr "1. Code + deps"
[ -f server.js ] || [ -f whatsapp.js ] && ok "in assistant/" || no "run from ~/Projects/workflow/assistant"
[ -d node_modules/exceljs ] && ok "deps installed" || { no "deps missing → run: npm install"; }

hdr "2. Claude subscription login (the one manual step)"
if security find-generic-password -l "Claude Code-credentials" >/dev/null 2>&1; then
  if timeout 30 env -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_SESSION_ID -u CLAUDECODE claude -p "reply OK" --model claude-opus-4-8 --output-format text 2>/dev/null | grep -qi ok; then
    ok "logged in AND answering on the sub"
  else ok "keychain has a login (verify it answers once)"; fi
else no "NOT logged in → run: claude   then type /login"; fi
[ -n "${ANTHROPIC_API_KEY:-}" ] && no "ANTHROPIC_API_KEY is set → unset it (would bill the API): unset ANTHROPIC_API_KEY" || ok "no stray ANTHROPIC_API_KEY"

hdr "3. Mail access (so he can read deals into his book)"
if timeout 40 node scripts/graph.js boxes >/tmp/wd-graph 2>&1; then ok "Outlook reader works ($(grep -c @ /tmp/wd-graph 2>/dev/null || echo '?') boxes)";
else no "mail reader failing → $(tail -1 /tmp/wd-graph | cut -c1-90)"; echo "     needs the GE Graph creds (~/.claude/.secrets/ge-ms365-app.env or the relay .env.local) + network"; fi

hdr "4. A channel to reach you (pick ONE)"
if grep -q "TELEGRAM_BOT_TOKEN_SOHAN=." .env 2>/dev/null; then ok "Telegram token set → start with: node gateway.js sohan";
elif [ -f profiles/sohan/state/whatsapp-auth/creds.json ]; then ok "WhatsApp linked → start with: node whatsapp.js sohan";
else no "no channel yet — do one:";
  echo "     • WhatsApp: node whatsapp.js sohan   (scan the QR with your phone, then text yourself)";
  echo "     • Telegram: make a bot via @BotFather → put TELEGRAM_BOT_TOKEN_SOHAN=<token> in assistant/.env → node gateway.js sohan"; fi

hdr "When all green — make him always-on:"
echo "  pm2 start whatsapp.js --name winston -- sohan   # (or gateway.js for Telegram)"
echo "  pm2 save && pm2 startup                          # run the line it prints → survives reboots"
echo
echo "Then text yourself: \"morning brief\" → he should patrol his book and reply."
