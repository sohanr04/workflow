# Task: give Winston a stable read into Sohan's Outlook (fix the "fetch failed")

## The problem (diagnosed, do not re-litigate)
Winston reads Outlook via `assistant/scripts/graph.js` (app-only Microsoft
Graph, client-credentials, reusing the relay's `MS_GRAPH_*` creds). The creds
and code are CORRECT. The failure is purely **network egress from this Mac**:

- `graph.js` → `fetch failed` on `login.microsoftonline.com` **both** inside
  Winston's gateway AND in a plain terminal (bisected — so it's NOT the Claude
  permission sandbox).
- Sohan's **browser** logs into Outlook fine, and the **cloud relay** (Railway)
  reads these same mailboxes daily with the same app. → classic case of a
  **system/corporate proxy the browser honours but Node's `fetch` (undici)
  ignores**, or a local egress block to the MS login host.

## Fix — pick ONE, in order of preference

### Option A (preferred): run the reader where the relay already runs
The relay repo (`~/Projects/grand-empire-stock-inventory-matching`, on Railway)
already has clean egress + the consented app + `lib/outlook/auth.ts`. Expose a
tiny **read-only** HTTP endpoint there (behind a shared secret) that wraps the
same calls graph.js makes:
- `GET /read?box=spr|china|dis&cmd=recent&n=15`
- `GET /read?box=spr&cmd=thread&code=SP80499`
- `GET /read?box=spr&cmd=get&id=<messageId>`
Then repoint `graph.js` to call that endpoint instead of Microsoft directly, so
Winston's command surface (`node ../../scripts/graph.js recent spr 15`) is
unchanged. Winston→Railway works (normal HTTPS); Railway→Microsoft already works.

### Option B: make the local reader proxy-aware
If the Mac has a real HTTPS proxy: set `HTTPS_PROXY` (from macOS System
Settings → Network → Proxies) in winston's pm2 env, and add near the top of
`scripts/graph.js`:
```js
import { ProxyAgent, setGlobalDispatcher } from 'undici';
const p = process.env.HTTPS_PROXY || process.env.https_proxy;
if (p) setGlobalDispatcher(new ProxyAgent(p));
```
First confirm a proxy actually exists: in a plain terminal run
`node -e "fetch('https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration').then(r=>console.log(r.status)).catch(e=>console.log('cause:',e.cause))"`
— the `cause` (ENOTFOUND / ECONNREFUSED / 407 / cert) tells you which fix.
If there's NO proxy and it's a hard firewall/DNS block, Option A is the answer.

## Acceptance test
From Winston's dir: `node ../../scripts/graph.js recent spr 5` prints 5 real
inbox subjects+senders (no `fetch failed`). Then have Winston reconcile the
3 boxes into `deals.md`.

## Guardrails
- READ-ONLY. No send/delete/modify of any mailbox. Winston drafts; Sohan sends.
- NEVER print/copy `MS_GRAPH_CLIENT_SECRET` anywhere. Keep it in the existing
  `.env.local` / Railway env only.
- Don't touch the relay's core mail-processing logic — only add a read endpoint.
