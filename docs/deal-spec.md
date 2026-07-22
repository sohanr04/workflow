# Winston Deal-Card Spec — captured live from Sohan's walkthrough (2026-07-22)

## Two views (do NOT confuse them)
- **LIST** ("what's open / what to reply on / what's stale / past 2 weeks"):
  ONE tight line per deal, ALL deals (~50+). Never expand one-by-one.
  Line = ref · product qty · whose ball · one-liner state
  ("we replied last saying X" / "waiting on Cherry $1.50, 1d" / "buyer asked price, no cost yet → source").
  Keep EVERY deal open/tracked, drop none.
- **DETAIL** (drill into one ref): the full card below. Only when Sohan asks about ONE deal.

## The full card (single deal)
Always three prices + state:
- **BUY (supplier):** last CONFIRMED cost = the SUPPLIER'S OWN offer to us (not our ask).
  + our pending ask if floated & unanswered ("we asked $8, no reply, Nd").
- **SELL (buyer):** buyer's CONFIRMED/target price = THEIR OWN number. "no target given = open" if none.
  + our pending ask ("we're asking $1.80, no reply").
- **CONFIRMED vs ASK (core rule):** confirmed = the number the COUNTERPARTY stood behind
  (their offer/target). Our "can you do X / clear at Y" = PENDING until they reply.
  Never replied → last confirmed stays THEIR number. They reply agreeing → our ask BECOMES the new confirmed.
  Examples: supplier offers $10, we ask $8, silence → confirmed $10. Buyer target $9.50, we ask $11.50, silence → confirmed $9.50.
- **Ball + our last action WITH TIMESTAMP:** "you followed up today 20:58 HKT."
- **Status:** LIVE / dead.
- **Next chase due:** date if no reply (~2-day window).
- **Spread at our ask** (if both numbers known).

## Per-shape logic (the sequence IS the intelligence)
- **No cost + buyer interested:** move = GET SUPPLIER PRICE FIRST → then quote buyer.
  Source the cost via the ORIGINAL SUPPLIER CODE (DIS-10753 → supplier's own ref, e.g. GBT/SP), not the DIS ref.
- **Supplier gave a usable price + we've quoted buyer + waiting:** nothing to do — don't surface as todo, don't say "answer supplier." A supplier price is ammunition, not a debt. Don't lock supplier until buyer confirms.
- **Below cost / thin margin:** NOT dead, NOT "chase the buyer." Two-sided: push BUYER UP
  and squeeze SUPPLIER DOWN until the gap opens to 15-20%. If nothing started on either side,
  first move = EMAIL THE SUPPLIER to drop the cost (buyer push alongside). Held/live until one
  side moves enough or it's clear neither will. (Hoody: get Lecia →~$1.80, supplier →~$1.50.)

## Margin rule (global)
- **Target 20%, floor 15% — markup on COST.** margin% = (sell − cost)/cost.
  $1.50 cost → $1.80 sell = 20% ✓. Accept down to 15%; below that, push both sides.
- Always quote the LOWEST sell that still clears the floor (be competitive, but never under 15%).
- Card flags: 🟢 ≥20% healthy · 🟡 15-20% thin · 🔴 <15% below-floor · ⛔ <0 below-cost (squeeze play).

## Don'ts
- Don't surface ball-on-them-not-overdue as a todo.
- Don't say "answer supplier" when the supplier already gave a usable price.
- Don't expand deals one-by-one when asked for a LIST.
