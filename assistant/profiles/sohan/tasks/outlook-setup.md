# Task: Outlook read access (app-only Graph reader)

Outlook is connected through **`scripts/graph.js`** — an app-only Microsoft
Graph reader using the SAME company app the stock relay uses. **No
interactive login, nothing that expires.** READ ONLY (list/search/read;
never send/delete). This replaces the old `@softeria/ms-365-mcp-server`
device-code setup, which is gone.

## Setup — usually NOTHING to do

`graph.js` **self-sources** its creds: if `MS_GRAPH_*` aren't in the
environment, it reads them from the relay's `.env.local`
(`~/Projects/grand-empire-stock-inventory-matching/.env.local`, which is
already on this Mac). So a plain **git pull + gateway restart** is enough —
no `.env` editing. (The restart matters: it reloads `profile.json` so
Winston is allowed to run the reader.)

**Only** if the relay repo is NOT on this machine, put the three creds in
`assistant/.env` manually (copy from the relay's `.env.local`; never in chat
or a committed file):
```
MS_GRAPH_CLIENT_ID=…
MS_GRAPH_TENANT_ID=…
MS_GRAPH_CLIENT_SECRET=…
```
Or point `RELAY_ENV_PATH` at wherever that `.env.local` lives.

## Verify (Winston, do this once)

From your working dir (`profiles/sohan/`):
```
node ../../scripts/graph.js boxes
node ../../scripts/graph.js recent spr 3
```
- Prints the 3 mailboxes + 3 recent spr@ subjects → **working.** Tell Sohan
  "Outlook read is live across all 3 boxes" and append to today's journal:
  "Outlook (app-only Graph reader) connected — spr/china/dis."
- `missing creds` → the `.env` step wasn't done or the gateway wasn't
  restarted. Tell Sohan which.
- `token request failed` / `graph error 403` → wrong cred value, or the app
  lost its Mail.Read application permission. Paste the exact line to the
  architect (the Claude session that maintains this repo).

## How you use it day to day

Full command list + what each box is for: see `memory/business.md` →
"Where deals live + YOUR ACCESS". The one to reach for constantly is
`node ../../scripts/graph.js thread <style-code>` — one deal across all 3
boxes, in time order. Reconcile findings into `deals.md` the same turn.
