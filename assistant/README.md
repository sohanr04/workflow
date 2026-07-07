# Family Assistant

Personal AI assistants over Telegram, one per person, powered by your Claude
subscription (via Claude Code headless — no API key, no per-token billing).
Runs on any always-on machine, like an old laptop.

```
Telegram bot (one per person)
      │
gateway.js  (tiny Node daemon, zero dependencies)
      │
claude -p   (Claude Code CLI, logged into your sub)
      │
profiles/<person>/   persona (CLAUDE.md) + memory (markdown files)
```

Each person gets their own bot, their own personality, and their own private
memory. The assistant updates its memory files itself as it learns things.

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

## Email (Gmail via MCP)

The assistant can read/summarize your inbox and write drafts (it's told to
never send — you hit send yourself):

1. `cp profiles/sohan/mcp.json.example profiles/sohan/mcp.json`
2. The example uses a community Gmail MCP server
   (`@gongrzhe/server-gmail-autoauth-mcp`) which needs a Google Cloud OAuth
   credential — follow that project's README for the one-time auth flow. Any
   Gmail MCP server works; whatever is in `mcp.json` gets auto-enabled.
3. Restart the gateway. It logs `mcp servers enabled: gmail` on startup.

`mcp.json` is git-ignored (it's personal). Each family member can have their
own with their own accounts.

## Ideas for later

- Voice notes: transcribe Telegram voice messages before handing to Claude.
- Calendar MCP server, same pattern as Gmail.
- Group chat mode: one family bot everyone can talk to, with shared memory.
