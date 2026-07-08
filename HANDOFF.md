# Handoff — Winston (personal + business assistant)

Branch: `claude/free-laptop-8rzh36` · Last updated 2026-07-07

## What this is

Winston is a personal AI assistant for Sohan that runs on his Claude
subscription (via Claude Code headless — no API key) on an always-on
MacBook Air, and talks to him over **WhatsApp** (his own number, via the
"Message Yourself" chat). It doubles as a **deal desk** for the family
stock-trading business (Grand Empire HK).

Two codebases in the repo:
- `assistant/` — **the live one.** Our own ~700-line gateway (Telegram +
  WhatsApp channels over a shared Claude core). This is what's running.
- `openclaw/` + `vendor/openclaw` — the OpenClaw route (installed package
  + config). Not in use; kept as reference/alternative.

## Current status

WORKING (confirmed live on Sohan's Mac):
- WhatsApp linked to his number; messages route to Winston and back
- Claude Code logged in (his Max sub); replies come back as Winston
- Persona: "Winston" — human texting voice, loyal, dry, pushes him
- Deal desk: `memory/deals.md` seeded with 6 real live deals; buyer/
  supplier intel files; drafts follow-ups (tested); tracks who owes a reply
- Layered memory (core / people / journal), self-updating
- Reminders + 07:30 briefing + Sun review + 30-min heartbeat (all coded;
  need the gateway restarted after latest pull to be active)

PENDING (next session should drive these):
1. **Restart the gateway on the Mac** after `git pull` to load the latest
   (heartbeat startup log, deal desk, business knowledge, rename).
   `cd ~/workflow && git pull && bash scripts/laptop-setup.sh sohan`
   then `cd assistant && node whatsapp.js sohan` — look for
   "heartbeat armed" in the startup log.
2. **Email connection (the big multiplier).** Makes Winston autonomous:
   catches new deals, advances replies, flags what Sohan left waiting.
   - Outlook: runbook at `assistant/profiles/sohan/tasks/outlook-setup.md`.
     Uses company Azure app creds in `.env` (MS365_MCP_CLIENT_ID /
     TENANT_ID / CLIENT_SECRET). Server needs `--org-mode` (done in
     template). "Allow public client flows" must be ON in the app reg.
   - Gmail: GCP OAuth flow, `mcp.json` gmail server.
3. **Obsidian vault integration (Sohan's request).** He keeps his business
   in an Obsidian vault on the Mac — wants Winston to read/write it as his
   real brain instead of separate memory files. NEED: the vault's folder
   path. Then add it via profile `addDirs` and point memory at it.
4. **Goals conversation** — `memory/goals.md` is still empty; the whole
   coaching/accountability layer needs his real 2-3 goals.
5. **24/7**: move from `node whatsapp.js` to pm2
   (`pm2 start whatsapp.js --name winston -- sohan; pm2 save; pm2 startup`)
   + Mac keep-awake settings.

## Open notes / decisions

- **Secret**: a Microsoft client secret was pasted in chat earlier. Sohan
  says it's a shared secret used across many projects and he can't rotate
  it. It is NOT in any repo file (only ever belongs in gitignored `.env`).
  Real long-term fix: a dedicated per-app secret for Winston so his access
  can be revoked independently. Not urgent per Sohan; do not commit it.
- **The "relay" and "website"**: Sohan references an internal system/relay
  (tied to the Azure app) and a website + Obsidian vault. None of these
  were ever shared into this repo — this session only ever saw his email.
  They must be captured from him directly (or via the Obsidian vault once
  connected). `business.md` has explicit LEARN-from-Sohan placeholders.

## Key files

- `assistant/profiles/sohan/CLAUDE.md` — Winston's persona + all protocols
- `assistant/profiles/sohan/profile.json` — model (opus), heartbeat,
  schedules, allowedTools, addDirs
- `assistant/profiles/sohan/memory/` — business.md, deals.md, goals.md,
  notes.md, about-me.md, people/*, journal/*
- `assistant/profiles/sohan/mcp.json(.example)` — gmail/gcal/ms365/browser
- `assistant/lib/core.js` — Claude runner + scheduler (reminders/heartbeat)
- `assistant/{whatsapp,gateway}.js` — the two channels
- `assistant/README.md` — full setup docs

## How to verify quickly

`cd assistant && node test/e2e.js` → should print 8/8 checks passed.
