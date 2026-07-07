# Family Assistants on OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) is the most popular
open-source personal AI assistant (the gateway that connects Telegram/
WhatsApp/Discord to an agent). **This folder holds the parts that are
yours** (config + per-person workspaces); the full OpenClaw source lives in
[`../vendor/openclaw`](../vendor/openclaw) as a git submodule.

When cloning this repo on the laptop, grab the submodule too:

```bash
git clone --recurse-submodules <this-repo>
```

## Staying up to date

`scripts/update-openclaw.sh` pulls the latest OpenClaw source into
`vendor/openclaw` and updates the running install to match, then restarts
the gateway. For hands-off weekly updates, install the systemd timer:

```bash
sudo cp openclaw/systemd/openclaw-update.* /etc/systemd/system/   # edit EDIT_ME first
sudo systemctl daemon-reload
sudo systemctl enable --now openclaw-update.timer
```

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

## WhatsApp on your own number

Your agent can live in WhatsApp using your personal number — it links as a
device on your account (same mechanism as WhatsApp Web) and you talk to it
in WhatsApp's **"Message Yourself"** chat. Built into OpenClaw, no extra
repo needed.

1. Install the WhatsApp plugin:
   ```bash
   openclaw channels add --channel whatsapp
   ```
2. In `~/.openclaw/openclaw.json`, set your real number in
   `channels.whatsapp.allowFrom` (E.164 format, e.g. `+15551234567`). The
   example config already has the block + a binding routing WhatsApp to the
   `sohan` agent.
3. Link it (shows a QR — scan from phone: **WhatsApp → Settings → Linked
   devices → Link a device**):
   ```bash
   openclaw channels login --channel whatsapp
   ```
4. `openclaw gateway restart`, then open the "Message Yourself" chat in
   WhatsApp and say hi. Replies arrive prefixed with the agent's name.

Know before you link:

- **Only you can trigger it.** `dmPolicy: "allowlist"` with just your
  number means friends texting you never reach the agent — it won't reply
  to your chats on your behalf.
- **Unofficial protocol.** This rides WhatsApp Web (Baileys), which is
  against WhatsApp's ToS; accounts occasionally get flagged. Rare in
  self-chat use, but if losing your number would wreck you, use a spare
  SIM as a dedicated agent number instead (OpenClaw's recommended setup).
- **Laptop must stay online** — the gateway owns the linked session.

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

Status July 2026: Anthropic announced, then **paused**, a plan to meter
programmatic use (OpenClaw, `claude -p`, Agent SDK) through a separate
"Agent SDK credit" pool. **Right now agents draw from your normal
subscription limits, same as Claude Code in a terminal.** On Max 20x
that's a lot of headroom; the example config defaults to Opus.

If/when the pool change lands (Anthropic says advance notice first):
Pro ≈ $20/mo of agent credits, Max 5x ≈ $100, Max 20x ≈ $200. At API
rates that's roughly — Opus ≈ 800 messages/mo on Max 20x, Sonnet ≈ 4,000,
Haiku ≈ 11,000. Still plenty for a personal assistant + light family use;
revisit the tips below if it ever feels tight.

Stretching usage with three people:

- Family agents on `anthropic/claude-haiku-4-5` or Sonnet (both registered
  in the example config) — 5-10x more messages per token than Opus.
- Heartbeats run the agent every poll: widen the interval, and only enable
  HEARTBEAT.md for people who actually want proactive check-ins.
- Long conversations resend context each message — `/new` or fresh topics
  keep costs down.

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
