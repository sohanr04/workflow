# Family AI Assistants

Personal AI assistants for the family — one per person, each with its own
Telegram bot, personality, and private memory — running 24/7 on an old
laptop, powered by one Claude subscription (no API billing).

Two ways to run it:

| | |
|---|---|
| [`openclaw/`](./openclaw/) | **The main setup.** Config + per-person workspaces for [OpenClaw](https://github.com/openclaw/openclaw), the most popular open-source assistant gateway. Voice notes, skills, reminders, multi-channel — batteries included. |
| [`assistant/`](./assistant/) | DIY fallback: ~380-line zero-dependency Telegram→Claude bridge. Same personas, readable in one sitting. |

Start with `openclaw/README.md`.
