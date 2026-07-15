# Task: make Winston's Outlook read PERMANENT + reliable (kill "fetch failed")

Owner: architect session (unsandboxed). Winston can't edit graph.js (write-box)
or the network. Goal: Winston reads all 3 mailboxes on demand with ~zero failures.

## What we know (diagnosed live, don't re-litigate)
- Auth is SOLVED: `scripts/graph.js` uses the relay's consented app-only creds
  (`MS_GRAPH_*`). It authenticates fine. No login/consent/MFA issue.
- The failure is the **outbound `fetch` to Microsoft**, and it's INTERMITTENT:
  `graph.js: fetch failed`, in waves.
- Key clue: it fails from **Winston's pm2/gateway process** far more than from a
  **plain interactive shell** on the SAME Mac (shell runs clean; gateway flakes).
  → the gateway's node egress path is the shaky bit (env/proxy/DNS/IPv6 differ).
- `graph.js` does a **single-shot fetch with NO retry** — so one transient blip =
  hard fail. That amplifies the flakiness into "the reader is down."

## Tier A — harden graph.js in place (do this first, ~fast)
1. **Retry with backoff** around BOTH fetches (`getToken`, `graph`): 4–5 attempts,
   200ms→2s backoff, retry on network errors (`fetch failed` / ECONNRESET /
   ETIMEDOUT / ENOTFOUND) and 5xx. This alone should kill most failures.
2. **undici dispatcher** with keep-alive + sane timeouts + IPv4-friendly connect
   (a very common cause of intermittent macOS `fetch failed` is happy-eyeballs/
   IPv6): near the top of graph.js —
   ```js
   import { Agent, setGlobalDispatcher } from 'undici';
   setGlobalDispatcher(new Agent({
     connect: { timeout: 10_000, autoSelectFamily: true },
     keepAliveTimeout: 30_000, keepAliveMaxTimeout: 60_000,
   }));
   ```
3. **Proxy env parity:** make the pm2/gateway process inherit the same
   `HTTPS_PROXY`/`NO_PROXY` the interactive shell has (if any). If a proxy exists,
   add an undici `ProxyAgent`. If none, skip — Tier A #1/#2 should suffice.
4. Keep the token cache (it already caches in /tmp) so retries are cheap.

## Tier B — bulletproof: run the reader where the relay runs (do if A still flaps)
The relay (Railway) reads these mailboxes daily with zero egress issues. Expose a
tiny **read-only** endpoint there (shared-secret header) mirroring graph.js's
commands (`recent|search|thread|get`), and point graph.js at it instead of calling
Microsoft directly. Winston→Railway is plain HTTPS (never flakes); Railway→Microsoft
already works. This removes the local network from the path entirely — permanent.

## Acceptance test (must pass before calling it done)
Run from Winston's gateway process (not just a shell):
`for i in $(seq 20); do node ../../scripts/graph.js recent spr 2; done`
→ **20/20 succeed, 0 "fetch failed".** Then Winston does a full 3-box reconcile
without a single drop.

## Guardrails
- READ-ONLY. No send/delete/modify. Winston drafts; Sohan sends.
- Never print/copy `MS_GRAPH_CLIENT_SECRET`. Stays in `.env.local` / Railway env.
- Don't touch the relay's core mail-processing; Tier B only ADDS a read endpoint.
