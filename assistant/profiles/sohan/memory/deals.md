# Deal Desk — live pipeline

<!-- Winston's deal ledger for Grand Empire HK. One block per deal.
     THIS IS THE TRACKING SYSTEM. Keep it current to the minute.

     STATUS: lead | quoting | negotiating | sample | confirmed | shipping | closed | dead
     BALL:   who owes the next move — "us" (Sohan) or "them" (+who/when)

     TWO layers per deal:
     - the header fields = the CURRENT state (status, ball, live numbers).
     - the History log    = HOW it got here, dated, append-only.
     Every time a deal moves: update the header AND append a dated History
     line the same turn. The header answers "where is this now"; the History
     answers "what did Cherry quote last month" — grep it, don't guess.

     Sort ball-on-US, hottest first. $ figures are per-piece unless noted. -->

## Format (copy for new deals)
```
### <ref> · <product> · <qty>
- Client: <name / company / region> · <buyer|supplier>
- Status: <status> | Ball: <us|them since DATE>
- Numbers: target $X · quoted $Y · MOQ Z · spread ~$_ on the lot
- Next: <the single next action, with the $ stake if it matters>
- History:
  - <YYYY-MM-DD>: <what happened>
```

---

## HOT — money on the table

### TWG-INTRO · F1 bomber jackets · sample/pricing
- Client: Mark Stirton, The Warehouse Group (NZ) · buyer · NEW ACCOUNT
- Status: negotiating | Ball: US — he asked for cost price on sample units
- Next: send cost price BEFORE the Jul 13 intro call. New-account door — do
  not fumble it.
- History:
  - 2026-07-06: liked the jackets, intro call booked (Mon Jul 13, Teams)
  - 2026-07-06: asked for cost price on the sample units → ball to us

### GBT26-3334 · Lady's Pants · 7,500 pcs
- Client: Gbest Garment (Cherry) · supplier · power packing
- Status: negotiating | Ball: US — decide on price
- Numbers: target $2.00 · quoted $2.45 · gap 45c = **~$3,375 on the lot**
- Next: counter or accept. Recommend counter ~$2.20 and hold.
- History:
  - 2026-07-07: Cherry came back at $2.45 vs our $2.00 target → ball to us

### DIS-26070707 · Girls' Short Sleeve T-Shirts · 453,892 pcs
- Client: Kyla, Power Fashion (SA) · buyer · **huge volume**
- Status: quoting | Ball: US — resolve the licensing question
- Next: factory can export but Power needs a license to sell in stores.
  Resolve the license path — the volume makes this worth real effort.
- History:
  - 2026-07-07: confirmed factory can export; blocker is Power's store
    license → ball to us to resolve

### DIS-80513-LLJ · Two-Tone Hooded Windbreaker · 6,000 pcs
- Client: Lecia, Choice Clothing (SA) · buyer
- Status: quoting | Ball: THEM since 2026-07-07 — confirm interest / sample
- Next: chase if silent 2+ more days (chase window hits ~Jul 9).
- History:
  - 2026-07-07: told her it's a fresh offer, offered to arrange a sample →
    ball to her

## WARM

### PWR-SNEAKERS · Unisex Sneakers · 6,000 pcs
- Client: Noma, Power Fashion (SA) · buyer
- Status: negotiating | Ball: THEM — test order confirmed, awaiting raise
- Numbers: 1,000u test @ $2.70; balance 5,000 to upsell after test lands
- Next: confirm the 1,000u test order is actually raised; upsell the rest
  once it ships well.
- History:
  - 2026-07-07: Joyce confirmed the 1,000prs test order @ $2.70

### AERO-LS · Aeropostale Mens Long Sleeve Tee · 15,000 pcs
- Client: supplier baywatch098 (offer inbound to us) · 100% cotton
- Status: lead | Ball: US — evaluate the offer
- Next: decide if there's a buyer for it before replying. Don't tie up
  attention on stock with no home.
- History:
  - 2026-07-07: offer landed in our inbox (15,000 pcs, 100% cotton)

<!-- Add when captured: Power Fashion board shoes 5,000 (order being raised),
     Stockpapa kids shoe quotes pending, NINGBO/Stanley shipments (Toni-Ann). -->

---

## ARCHIVE — dropped / closed (keep the history)

<!-- When a deal dies or closes, move its whole block here (History and all).
     Dropped: reason + last price — teaches what didn't work.
     Closed:  final price + margin if known — teaches what does. -->

## Born / dropped log

<!-- One dated line per deal birth or death — the pulse of the pipeline.
     Winston appends here so we can see flow over time. -->
- 2026-07-07: seeded 6 live deals from work mail (TWG-INTRO, GBT26-3334,
  DIS-26070707, DIS-80513-LLJ, PWR-SNEAKERS, AERO-LS)
