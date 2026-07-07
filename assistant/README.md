# Your Own Agent

Personal AI assistants on **Telegram and WhatsApp (your own number)**, one
per person, powered by your Claude subscription (via Claude Code headless —
no API key, no per-token billing). Runs on any always-on machine, like an
old laptop. This is your code — small enough to read in one sitting.

```
Telegram bot (one per person)      Your WhatsApp number (self-chat)
      │                                   │
  gateway.js                         whatsapp.js
      └────────────┬──────────────────────┘
              lib/core.js   (Claude runner, sessions, reminders, schedules)
                   │
              claude -p     (Claude Code CLI, logged into your sub)
                   │
         profiles/<person>/   persona (CLAUDE.md) + memory (markdown files)
```

Each person gets their own channel, personality, and private memory. The
assistant updates its memory files itself as it learns things. Design
patterns (self-chat loop guard, allowlists, reconnect handling) are borrowed
from OpenClaw's source, vendored at `../vendor/openclaw` as a reference.

## Laptop setup (once)

1. **Install Node 18+** — `node --version` to check.
2. **Install Claude Code** and log in with your subscription:
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude login
   ```
3. **Clone this repo** onto the laptop.
4. **Disable sleep** (lid close, suspend) in your OS power settings.

## Set up a person (start: you)

1. **Create a Telegram bot**: message [@BotFather](https://t.me/BotFather),
   send `/newbot`, pick a name. Copy the token.
2. **Save the token**:
   ```bash
   cd assistant
   cp .env.example .env     # then paste your token into .env
   ```
3. **Run it**:
   ```bash
   node gateway.js sohan
   ```
4. **Activate yourself**: message your bot on Telegram. It replies with your
   Telegram user id. Put that number in
   `profiles/sohan/profile.json` → `"allowedUserIds": [123456789]`,
   restart the gateway, and you're live. (This also locks the bot so ONLY
   you can use it.)
5. **Make it yours**: edit `profiles/sohan/CLAUDE.md` (personality) and
   `profiles/sohan/memory/about-me.md` (facts about you). The assistant
   keeps memory updated on its own from there.

## WhatsApp on your own number

Your agent links to your WhatsApp account as a device (same mechanism as
WhatsApp Web) and you talk to it in WhatsApp's **"Message Yourself"** chat.

```bash
cd assistant
npm install            # one-time: WhatsApp needs the Baileys library
node whatsapp.js sohan
```

A QR code prints in the terminal — scan it from your phone: **WhatsApp →
Settings → Linked devices → Link a device**. Then open the "Message
Yourself" chat and say hi. Agent replies arrive prefixed with 🤖 (that
prefix is also the loop guard — don't remove it).

Config lives in `profile.json` under `"whatsapp"`:

- `selfChat` — talk to the agent in your own chat (default true)
- `allowFrom` — other numbers (E.164, e.g. `"+15551234567"`) allowed to
  message the agent directly. Everyone else is ignored, and the agent
  NEVER replies in your other chats or to messages you send to people.
- `replyPrefix` — the reply marker (default 🤖)

Know before you link: this rides the WhatsApp Web protocol unofficially
(against WhatsApp ToS; self-chat use rarely gets flagged, but not never —
use a spare SIM if losing your number would hurt), and the laptop must
stay online for replies. Telegram and WhatsApp channels run side by side
fine — same persona, memory, and reminders, separate conversation
sessions.

## Add your brother / dad

```bash
cp -r profiles/_template profiles/dad
```

1. Replace `NAME_HERE` in `profiles/dad/profile.json`, `CLAUDE.md`, and
   `memory/about-me.md` — and personalize the vibe section for them.
2. Create a NEW bot with @BotFather, add `TELEGRAM_BOT_TOKEN_DAD=...` to
   `.env` (must match `botTokenEnv` in their profile.json).
3. Run `node gateway.js dad` (each person is a separate process).
4. Have them message the bot, then add their id to their `allowedUserIds`.

All three assistants share your one Claude sub. Chat commands: `/new`
(fresh conversation), `/id`, `/help`.

## Run 24/7

**systemd** (recommended): see `systemd/assistant@.service` — edit the two
`EDIT_ME` lines, install it, then:

```bash
sudo systemctl enable --now assistant@sohan
sudo systemctl enable --now assistant@dad
journalctl -u assistant@sohan -f     # logs
```

Or quick-and-dirty with pm2: `pm2 start gateway.js --name sohan -- sohan`.

## Tuning

Per-person knobs in `profile.json`:

- `allowedTools` — what the assistant can do. Default is files + web search.
  Add e.g. `"Bash(curl:*)"` for specific commands, or MCP tools later.
- `permissionMode` — `acceptEdits` lets it edit its own memory files without
  prompting. Don't set `bypassPermissions` unless you understand the risk.
- `model` — leave unset for your sub's default; set e.g. `claude-haiku-4-5`
  to burn fewer sub tokens on someone's assistant.
- `timeoutSeconds` — max time per reply (default 300).

## Notes on your Claude sub

- This gateway uses `claude -p` (non-interactive), which since mid-2026
  draws from your subscription's **Agent SDK credit** pool (~$20/mo worth
  on Pro, ~$100 on Max 5x) — separate from your normal chat limits. When
  it's exhausted, the assistant stops until the pool resets.
- Stretch it: set `"model": "claude-haiku-4-5"` in family profiles, keep
  scheduled prompts few, and use `/new` to reset long conversations (full
  context is resent every message).

## Privacy

- Memory files contain personal info about each person. They're plain
  markdown in this repo — if you push the repo anywhere shared, add
  `assistant/profiles/*/memory/` to `.gitignore` first.
- `.env` (bot tokens) and `state/` (session ids) are already git-ignored.

## Reminders

Just tell the assistant: "remind me to call the bank tomorrow at 9". It
writes `profiles/<person>/reminders.json`; the gateway checks every ~20s and
pings your Telegram when one is due. Supports one-off, `daily`, and `weekly`
repeats. Times are laptop-local.

## Scheduled check-ins (briefings, reviews)

`profile.json` → `"scheduled"`: prompts that fire at a set time and message
you with the result. Sohan's profile ships with a 07:30 morning briefing and
a Sunday 18:00 weekly review — edit times/prompts to taste, or add your own:

```json
{"time": "07:30", "days": ["mon","tue"], "prompt": "..."}
```

Omit `"days"` for every day. Each run is a fresh session with full persona +
memory. **Adjust the times to your timezone** — they use the laptop's clock.

## The full stack (email, calendar, browser — via MCP)

Sohan's profile is set up as "Alfred" — persona in `CLAUDE.md` — with the
overpowered loadout: files + web search (built into Claude Code) plus three
MCP servers:

| Server | Gives Alfred | Package |
|---|---|---|
| `gmail` | inbox summaries, search, drafts (never sends) | `@gongrzhe/server-gmail-autoauth-mcp` |
| `gcal` | sees your calendar, flags collisions | `@cocal/google-calendar-mcp` |
| `playwright` | drives a real browser: research, forms, price checks | `@playwright/mcp` |

Enable them:

1. `cp profiles/sohan/mcp.json.example profiles/sohan/mcp.json` — whatever
   is in `mcp.json` gets auto-enabled and allowlisted at startup.
2. Gmail + Calendar need a one-time Google OAuth setup — follow each
   project's README (both use a Google Cloud credential). Playwright needs
   nothing (first run downloads a browser).
3. Delete any server you don't want from your `mcp.json` — each one adds
   startup time and tool tokens per message.
4. Restart the channel. It logs `mcp servers enabled: gmail, gcal, playwright`.

`mcp.json` is git-ignored (it's personal). Each family member can have
their own with their own accounts. Browser + purchases: Alfred is
instructed to never buy/submit anything without an explicit go-ahead —
keep it that way.

## Ideas for later

- Voice notes: transcribe Telegram voice messages before handing to Claude.
- Calendar MCP server, same pattern as Gmail.
- Group chat mode: one family bot everyone can talk to, with shared memory.
