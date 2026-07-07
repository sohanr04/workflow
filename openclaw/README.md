# Family Assistants on OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) is the most popular
open-source personal AI assistant (the gateway that connects Telegram/
WhatsApp/Discord to an agent). You don't copy its code — you install it as
a package. **This folder holds the parts that are yours**: the config and
each person's persona + memory workspace.

Three isolated agents on one laptop, one Claude subscription:

```
Sohan's bot    ──▶ agent "sohan"   ──▶ workspaces/sohan/    (right-hand man)
Brother's bot  ──▶ agent "brother" ──▶ workspaces/brother/  (sidekick)
Dad's bot      ──▶ agent "dad"     ──▶ workspaces/dad/      (patient helper)
```

Each agent has its own persona (`SOUL.md`), user profile (`USER.md`),
long-term memory (`MEMORY.md`), and sessions. They can't see each other's
stuff.

## Laptop setup

1. **Node 22.19+ (24 recommended)** — `node --version`
2. **Claude Code logged into your sub** (OpenClaw reuses this login — no
   API key, usage draws from your subscription):
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude login
   ```
3. **Install OpenClaw** and run the wizard — pick **Claude CLI** when asked
   for the model provider:
   ```bash
   npm install -g openclaw@latest
   openclaw onboard --install-daemon
   ```
   This installs the gateway as a daemon (systemd/launchd) so it runs 24/7
   and survives reboots.
4. **Create 3 Telegram bots** with [@BotFather](https://t.me/BotFather)
   (`/newbot` three times), one per person. Copy the tokens.
5. **Merge in the family config**: open `~/.openclaw/openclaw.json` and add
   the `agents`, `bindings`, and `channels` blocks from
   [`openclaw.json.example`](./openclaw.json.example). Fix the two things
   marked for editing:
   - workspace paths → wherever you cloned this repo
   - the three bot tokens
6. **Restart and verify**:
   ```bash
   openclaw gateway restart
   openclaw agents list --bindings
   openclaw models list --provider anthropic
   ```
7. **Pair each person**: everyone DMs their own bot; approve with
   `openclaw pairing approve` (pairing = only approved people can talk to
   each bot).

## Personalizing

- `workspaces/<person>/SOUL.md` — personality. Sohan's is the full
  right-hand-man (chief of staff / accountability / coach / tutor). Replace
  `BROTHER_NAME` / `DAD_NAME` placeholders and add real details.
- `workspaces/<person>/USER.md` — facts about them (agents keep it updated).
- `workspaces/sohan/HEARTBEAT.md` — proactive behavior: 07:30 morning
  briefing, Sunday 18:00 weekly review, overdue-commitment nudges. OpenClaw
  polls this on its heartbeat; copy it to brother/dad if they want
  proactive check-ins too.
- Reminders, cron jobs, web search, and skills are built into OpenClaw —
  just ask the assistant in chat ("remind me at 9am", "check my email
  setup"). Browse skills: `openclaw skills list`. Email/Gmail hookup is an
  OpenClaw skill too — ask your agent to walk you through connecting it.

## Cost / sub limits (read this one)

Since mid-2026, Anthropic meters programmatic use (OpenClaw, `claude -p`,
Agent SDK) through a dedicated **Agent SDK credit** pool included in paid
subs — roughly $20/month worth on Pro, $100 on Max 5x — separate from your
normal chat/Claude Code limits. When the pool runs out, agents stop
responding until it resets (or you enable pay-as-you-go extra usage).

Ballpark, per ~$20 pool (typical message = persona + memory context):
Opus ≈ 75 messages/month, Sonnet ≈ 380, Haiku ≈ 1,100. The template
defaults to Sonnet — strong enough to be a real PA, cheap enough to text
all day. The pool resets monthly, and extra usage (if you enable it) has a
spending cap you set, so worst case is a few dollars, never a runaway bill.

Making it last with three people:

- Family agents on `anthropic/claude-haiku-4-5` (already registered in the
  example config) — ~10x more messages per credit. Save Opus for moments
  that need it, not the default.
- Heartbeats cost credits every poll: widen the interval, and only enable
  HEARTBEAT.md for people who actually want proactive check-ins.
- Long conversations resend context each message — `/new` or fresh topics
  keep costs down.
- If everyone uses it daily, a Max plan's bigger pool is the honest answer.

## Security (important)

- The gateway is local-first and binds to your machine. **Do not port-
  forward or expose it to the internet** — exposed OpenClaw gateways have
  been a real problem for people. Telegram works via outbound polling; no
  open ports needed.
- Keep `dmPolicy: "pairing"` so strangers who find a bot can't use it.
- Real tokens live only in `~/.openclaw/openclaw.json` on the laptop —
  never commit them. The file in this repo is a placeholder template.
- `MEMORY.md` files fill up with personal info over time. This repo is
  where they live — keep it private, or gitignore `openclaw/workspaces/`
  if you ever make it public.

## Also in this repo

`../assistant/` is a ~380-line zero-dependency DIY version of the same idea
(Telegram → `claude -p`). It predates the OpenClaw setup and stays as a
readable reference / fallback — same personas, tiny enough to understand
in one sitting.
