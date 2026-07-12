# Deal Desk — live pipeline

<!-- Winston's deal ledger for Grand Empire HK. THE TRACKING SYSTEM.
     Rebuilt 2026-07-08 from a live scan of spr@ Outlook (last ~5 days).

     STATUS: lead | quoting | negotiating | sample | confirmed | shipping | closed | dead
     BALL:   who owes the next move — "us" or "them" (+who, since DATE)

     Most deals are TWO-SIDED: a BUY leg (supplier, e.g. Cherry/Gbest,
     Stockpapa) and a SELL leg (buyer, e.g. Power Fashion, Choice, Good Hope,
     TWG). Margin = sell − buy per piece × qty. Track both legs.

     TWO layers per deal: header = current state; History = dated trail.
     Update both the same turn a deal moves. Sort ball-on-us, hottest first.
     $ per piece unless noted. Buyers often quote in Rands (R) — convert. -->

## Format (copy for new deals)
```
### <ref> · <product> · <qty>
- Buy:  <supplier> @ <cost> (target <x>)
- Sell: <buyer / region> @ <their offer> (target <y>)
- Status: <status> | Ball: <us|them since DATE>
- Spread: <sell − buy> = ~$_ on the lot
- Next: <single next action>
- History:
  - <YYYY-MM-DD>: <what happened>
```

## PIPELINE RULES (how Winston runs this file)

**Stages** — a deal is in exactly one:
lead (offer/inquiry exists, no price out) → quoting (price presented) →
negotiating (counters flowing) → sample (sample/test in play) → confirmed
(buyer committed, order raising) → shipping → closed | dead.
A deal ADVANCES only on evidence (an email, or Sohan says so) — never on hope.

**Chase windows** — past these, it's a leak; flag + draft the chase:
| Situation | Window |
|---|---|
| Ball on US (we owe anyone anything) | 24h max — same day ideally |
| Buyer silent on our offer/quote | 2 days |
| Supplier silent on our counter/ask | 2 days |
| Sample/test order pending, no movement | 3 days |
| Confirmed but order not raised | 2 days |

**Priority (what "hot" means)** — rank by:
1. Computable lot spread (both legs known): biggest $ first.
2. One leg known: qty × plausibility (a firm buyer number beats a wish).
3. Past-window leaks jump the queue regardless of size.
4. Ball-on-us beats ball-on-them at equal money.

**Metrics** — updated every Sunday review (and glanced at in the brief):

### Pipeline metrics
- Live deals: 13 · Est. $ on the table (computable spreads): ~$5.3k+
- This week: born 0 · closed 0 · dead 0 · booked $0
- (baseline set 2026-07-10 — Winston recomputes each Sunday)

---

## HOT — money on the table

### DIS-26-3334 · Lady's Pants · 7,500 pcs
- Buy:  Gbest (Cherry) — at $2.45, we're pushing **$1.80 to take all**
- Sell: Power Fashion (Mandisa Dladla) — offered **$2.50**
- Status: negotiating (both legs) | Ball: THEM — Cherry to answer $1.80
- Spread: dead at Cherry $2.45 (5c) → **~$5,250 if Cherry hits $1.80**
- Next: this deal IS the Cherry squeeze. Chase Cherry for $1.80; the sell
  side ($2.50) is already there. Don't lose the buyer waiting on the buy leg.
- History:
  - 2026-07-03: relay blasted DIS-26-3334 to buyers (empire-districtstock@)
  - 2026-07-06: Mandisa (Power) — interested, offered R70 → then $2.50 USD
  - 2026-07-07: Cherry (supplier) came back at $2.45
  - 2026-07-08: Joyce pushed Cherry to $1.80 to take all → ball on Cherry

### DIS-26070203 · Women's Baseball Cap · 3,500 pcs
- Sell: Choice Clothing (Nawaal) — offered **$0.90**, we're holding **$1.26**
- Status: negotiating | Ball: THEM — Joyce asked her to come up
- Spread gap: 36c × 3,500 = **~$1,260** between her $0.90 and our $1.26
- Next: hold $1.26; if she won't move, find the buy cost that makes $0.90+
  work or let it sit. Don't chase to the floor.
- History:
  - 2026-07-08: Nawaal offered $0.90 for all; Joyce confirmed $1.26, asked help

### DIS-80553-LLJ · Men Raglan Hooded Hybrid Jacket · 3,500 pcs
- Sell: Choice Clothing (Lecia) — best **$2.50**; says our offers had no prices
- Status: quoting | Ball: US — send a priced offer / respond to her $2.50
- Next: get her a clear USD price; she's ready to deal but can't see the ask.
- History:
  - 2026-07-08: Lecia — "best is $2.50, offers don't have prices"

### DIS-26-3304 · Lady's Overcoats · 5,600 pcs
- Buy:  Gbest (Cherry) — best price w/ our packing requested
- Sell: Power Fashion (Mandisa) — offer awaited
- Status: quoting | Ball: THEM — Cherry to price
- Next: get Cherry's number, then price to Power. Same pair as the pants.
- History:
  - 2026-07-08: Joyce asked Cherry best price with our packing → ball on Cherry

## WARM — awaiting them / smaller

### DIS-80513-LLJ · Two-Tone Hooded Windbreaker · 6,000 pcs
- Sell: Choice Clothing (Lecia) | Status: quoting | Ball: THEM since 2026-07-07
- Next: Parker re-sent Jul 8; chase Lecia if silent past ~Jul 10.
- History:
  - 2026-07-06: offer sent to Lecia · 2026-07-08: Parker re-sent, awaiting

### DIS-80566-LLJ · Unisex Sueded Bomber Baseball Jacket · 8,000 pcs
- Sell: Choice Clothing (Lecia) | Status: quoting | Ball: THEM
- Next: awaiting Lecia (Parker re-sent Jul 8); big qty, keep warm.
- History:
  - 2026-07-08: Parker re-sent to Lecia, awaiting

### DIS-80499-LLJ · Men Zip Pocket Jogger Pants · 1,208 pcs
- Sell: Choice Clothing (Lecia) | Status: sample | Ball: US
- Next: send the breakdown + sample cost to Lecia to confirm (Parker promised).
- History:
  - 2026-07-07: agreed to send breakdown first; sample courier cost applies

### DIS-77131-YK · Ladies Plaid Lounge Pants · 1,500 pcs
- Sell: Good Hope Sales (Chantal Nolan, Cape Town — NEW buyer) — target **$1.25**
- Status: quoting | Ball: US — quote against her $1.25
- Next: find the buy cost that clears margin over $1.25 and quote.
- History:
  - 2026-07-08: Chantal gave target $1.25

### DIS-26061903 · Unisex Sneakers · 6,000 pcs
- Sell: Power Fashion (Noma) | Status: confirmed (test) | Ball: THEM — raising
- Numbers: 1,000u test @ $2.70 confirmed; 5,000 balance to upsell
- Next: make sure the test order is actually raised (Joyce told Noma to raise),
  then upsell the balance once it lands.
- History:
  - 2026-07-07: Noma held to 1,000u test; Joyce confirmed 1,000prs @ $2.70, raise

### DIS-2606061205 · Kids' Board Shoes · 5,000 pcs
- Sell: Power Fashion (Noma / Hlengiwe Zindela) | Status: confirmed | Ball: THEM
- Buy: Stockpapa — board shoes SP10649 quoted $2.65
- Next: Noma said "I will raise the order" — confirm it's raised, watch the buy
  cost ($2.65) vs sell to hold margin.
- History:
  - 2026-07-07: Noma to raise the order

### DIS-80565-LLJ · Mens Knit Bomber Jacket · 2,117 pcs
- Sell: Choice Clothing (Lecia) — will pay **$3.20** USD
- Status: negotiating | Ball: US — price it against $3.20 / find the buy cost
- Next: Lecia gave a firm $3.20; find a supplier cost under it and close.
- History:
  - 2026-07-07: Lecia — "in dollars I can pay $3.20"

## SUPPLIER SOURCING (offers in — need a buyer)

### SP80529-LLJ · Mens Solid Rib Collar Sueded Bomber Jacket
- Buy: Stockpapa (Scott) — colours in, Parker likes them
- Status: lead | Ball: US — match to a buyer
- Next: find a buyer for these bombers before committing to the offer.
- History:
  - 2026-07-07: Scott sent colours; Parker "very good colours"

### AERO-LS · Aeropostale Mens Long Sleeve Tee · 15,000 pcs
- Buy: supplier baywatch098 (offer in), 100% cotton
- Status: lead | Ball: US — find a buyer before replying
- History:
  - 2026-07-07: offer landed (15,000 pcs, 100% cotton)

---

## VERIFY — carried from earlier, not seen in the Jul 8 scan

### DIS-26070707 · Girls' Short Sleeve T-Shirts · 453,892 pcs
- Sell: Power Fashion (Kyla) | Status: quoting | Ball: US — licensing blocker
- Next: huge volume — Power needs a store license to sell; confirm this thread
  is still live (not in the last-5-day inbox — chase or archive).
- History:
  - 2026-07-07: factory can export; blocker is Power's store license

---

## ARCHIVE — dropped / closed (keep the history)

<!-- Move a dead/closed deal's whole block here with reason + last price. -->

## Born / dropped log
- 2026-07-08: pipeline rebuilt from live spr@ inbox scan — added DIS-26-3334
  pants, DIS-26-3304 overcoats, DIS-26070203 cap, DIS-80553 raglan, DIS-80566
  bomber, DIS-80499 jogger, DIS-77131 lounge pants, SP80529 Stockpapa bomber;
  refreshed TWG + windbreaker; flagged Girls' Tees to verify.
- 2026-07-07: seeded 6 deals from work mail (initial)
