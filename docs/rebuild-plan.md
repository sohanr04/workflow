# Winston deal-engine rebuild — PLAN (for Sohan's markup, 2026-07-22)

Goal: make the live desk match the spec you walked me through. Everything derived
from threads; confirmed-vs-ask prices; 15-20% margin logic; per-shape moves; two views.

## What changes (all in status.js, one engine)

### 1. Price parsing — CONFIRMED vs ASK (the core new logic)
Per side, walk the messages and classify every price:
- **CONFIRMED** = a number the COUNTERPARTY stated (their msg) as their offer/target.
- **ASK** = a number WE stated as a question ("can you do $8", "clear at $11.50").
Track per side: `confirmed` (last counterparty price) + `ourAsk` (our last price, marked
PENDING if it's after their last msg and unanswered). Replaces the crude "last $ seen".
HARD PART: parsing free-text email ("$1.50/pc for all" = confirmed offer; "can we meet at
$1.80?" = our ask). Rule of thumb: price in THEIR msg = confirmed; price in OUR msg = ask.

### 2. Margin engine
`margin% = (sell − buy)/buy` on CONFIRMED numbers. Target 20%, floor 15%.
Flags: 🟢≥20 · 🟡15-20 · 🔴<15 · ⛔<0. "Quote the lowest that clears 15%."

### 3. Move derivation — the shape logic (what makes it smart)
- **No cost** (no supplier confirmed): move = SOURCE supplier price via the supplier code
  (DIS→GBT/SP map), THEN quote buyer at cost×1.20. Sequence-aware.
- **Cost known, margin ≥15%, not yet quoted:** quote buyer lowest ≥cost×1.15-1.20.
- **Cost known, quoted, waiting on buyer:** HOLD — nothing to do (don't say "answer supplier").
- **Below floor / below cost:** two-sided — email supplier to drop + push buyer up to open
  15-20%. If nothing started, first move = email supplier. Held, not dead.
- **Supplier gave price, we haven't locked:** ammunition, not a debt — don't "answer supplier"
  until the buyer confirms.

### 4. Two views
- **LIST** (`desk`): ONE line per deal, ALL of them —
  `REF · product qty · ball · margin-flag · one-liner move`. No per-deal expansion.
- **DETAIL** (`desk <ref>`): full card —
  BUY confirmed cost (+ our pending ask) · SELL confirmed/target (+ our pending ask) ·
  margin% vs 15-20% · ball + OUR last action w/ timestamp · LIVE/dead · next chase due · the move.

### 4b. Real-time ("on fire", not every 30 min)
The relay ALREADY runs Graph webhooks (lib/outlook/subscriptions.ts — changeType:created,
notificationUrl). Winston hooks into that push path: email lands → he reads it, updates the
deal, pings Sohan instantly ("Mandisa replied 'ok $2.70' — DIS-26-3334, your move"). 30-min
sweep demoted to a safety-net backstop.

### 4c. DIS→supplier(GBT) mapping — the negotiation backbone
Buyer threads = DIS-26-xxxx; supplier (Gbest/Cherry) threads = GBT26-xxxx — SEPARATE namespaces,
no cross-reference in the emails. The map lives in the relay:
- PRIMARY: `factory_checks` (224 rows) — offer_subject (DIS) → supplier_style (GBT) + supplier_email
  + supplier_name + buyer_usd_offer + target_price + currency. This ALSO hands us confirmed prices
  + FX/currency, so it feeds the price layer too. Winston reads it directly.
- FALLBACK (unmapped/older deals like DIS-26-3334): match the DIS product+qty against the supplier's
  china-box GBT offers (deduped_offers/china box). Fuzzy — flag low-confidence.
- Every card surfaces: GBT code · supplier email · their price — so Sohan can go negotiate.
- COVERAGE GAP (be honest): only the ~224 factory-checked deals are cleanly mapped; older ones need
  the fallback or Sohan's input.

### 4d. Incremental update (the efficiency core)
Email lands (webhook) → read ref in subject → re-derive ONLY that one deal → write cache.
Never re-scan the board. New ref = register new deal; no ref = flag, don't guess. State is
ALWAYS fresh because each email updates its own deal on arrival. So "what's open" = read
fresh cache → deterministic buckets → instant. Full scan = nightly backstop only.

### 4e. Deterministic bucket engine (hard-coded, checked every time)
Pure code, not LLM judgment. Each open deal → one of:
🆕 NEEDS OUR RESPONSE (fresh, never replied) · 🔄 FOLLOW-UP on us (ball us, ongoing) ·
⏰ CHASE (ball them, past 2-day window) · ⏳ WAITING (ball them, inside window) ·
🪦 STALE (long silence, batched) · 🙋 NEEDS YOU (Sohan-only decision) · 💰 TO RAISE (agreed, order pending).
Flavors inside a bucket: ⛔ below-cost (squeeze) · 🔍 no-cost-yet (source first).
Supplier/buyer window = 2 days. Same input → same buckets, every time, in a fraction of a second.

### 5. Kept from today
Live derivation off threads, two-leg blocker, signals, lifecycle tiers (2-day windows),
book.json = registry+overlay only.

## Build order
1. Price classifier (confirmed vs ask) — the foundation; unit-test on 5 real threads.
2. Margin engine + flags.
3. Move derivation per shape.
4. Rewire desk LIST + DETAIL to the new fields.
5. Verify on the 3 walked deals (sweater/shoes/hoody) + 5 more, live on the Air.

## GAPS FOUND (review pass 2026-07-22)
1. **Webhook reachability:** relay webhooks push to Railway's public URL; the Air has none.
   FIX: Winston polls the relay's Supabase event tables (buyer_events etc.) every ~60s —
   "on fire" = within a minute. Sub-second would need a tunnel; not worth the fragility.
2. **GBT→DIS reverse map:** supplier replies arrive under GBT codes with NO DIS ref. Without
   reverse routing, all buy-leg updates go stale. factory_checks maps ~224; older deals need
   product+qty fuzzy match (flag low-confidence) or Sohan's one-time confirm.
3. **Ref collision:** $search "DIS-26-3334" also matched DIS-26-33344 (observed). Must
   boundary-match refs or deals poison each other. May explain some of today's junk prices.
4. **Multi-buyer refs:** DIS-01333 = Nomndeni AND Caryn on one ref → sell leg PER BUYER,
   not per deal.
5. **LLM economy:** incremental updates are pure code; Winston-the-LLM fires only on notable
   transitions (buyer reply, signal, →NEEDS YOU, →TO RAISE). Explicit notify-list required.
6. **NEEDS YOU / TO RAISE** aren't thread-derivable — they're overlay marks (set when Winston
   asks the binary question / both confirms land). Buckets = code + overlay, stated honestly.
7. **Price classifier must strip quoted history** before extracting (a reply quoting our $2.50
   must not read as a new statement).
8. **Registry backfill:** one-time union of book refs + factory_checks + buyer_events window
   so old live deals aren't invisible.
9. **Cache staleness stamp:** every list line carries derived_at age; reader-down = show
   "(stale Xh)" rather than silently lying.

## ANSWERED (Sohan, 2026-07-22)
- **FX:** parked — he'll explain another time. Until then show R and $ as stated, never convert.
- **Notify policy: ANY update on a tracked deal = instant WhatsApp message.** No filtering,
  no waiting for the brief. (LLM-economy note stays: the CACHE update is pure code; the
  instant message itself is cheap — fire it on every deal update.)
- **Chase windows / silence clocks:**
  - **Suppliers: Mon–Sat are working days** (skip only Sunday when counting their silence).
  - **Buyers: skip Sat+Sun** (weekend silence doesn't count against them).
  - 2-day windows count in each side's own working days.

## Open questions for you
- Below-cost: Winston auto-drafts the supplier-squeeze email on your "go", or just flags held?
  (per the gated-drafting rule, I assume: surface the move + offer to draft, never auto.)
- "Dead" trigger: only when a side explicitly won't move enough, or never (always held)?
- Margin on COST confirmed (not on sell) — confirmed?
