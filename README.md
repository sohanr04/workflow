# Family AI Assistants

Personal AI assistants for the family — one per person, each with its own
channel, personality, and private memory — running 24/7 on an old laptop,
powered by one Claude subscription (no API billing).

| | |
|---|---|
| [`assistant/`](./assistant/) | **Your own agent.** Telegram + WhatsApp (your own number) channels over a shared Claude Code core. Personas, self-updating memory, reminders, scheduled briefings, Gmail via MCP. Small enough to read in one sitting — it's yours. |
| [`vendor/openclaw`](./vendor/openclaw) | Full OpenClaw source (git submodule, auto-updatable) — the parts bin: reference implementations to borrow from. |
| [`openclaw/`](./openclaw/) | Optional alternative: config + workspaces for running stock OpenClaw instead of your own agent. |

Start with `assistant/README.md`.
