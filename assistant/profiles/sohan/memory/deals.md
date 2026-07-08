# Deal Desk — live pipeline

<!-- Winston's deal ledger for Grand Empire HK. One block per deal.
     STATUS: lead | quoting | negotiating | sample | confirmed | shipping | closed | dead
     BALL: who owes the next move — "us" (Sohan) or "them" (+who/when)
     Keep this current: update the moment a deal moves. Sort hottest first.
     $ figures are per-piece unless noted. -->

## Format (copy for new deals)
```
### <ref> · <product> · <qty>
- Client: <name / company / region>
- Status: <status> | Ball: <us|them since DATE>
- Numbers: target $X · quoted $Y · MOQ Z
- Last: <what happened, date>
- Next: <the single next action>
```

---

## HOT — money on the table

### TWG-INTRO · sample F1 bomber jackets · pricing
- Client: Mark Stirton, The Warehouse Group (NZ)
- Status: negotiating | Ball: US — he asked for cost price on sample units
- Last: Jul 6, liked the jackets, intro call booked
- Next: send cost price BEFORE the Jul 13 call. This is a new-account door.

### GBT26-3334 · Lady's Pants · 7500 pcs
- Client: Gbest Garment (Cherry, China supplier side)
- Status: negotiating | Ball: US — decide on price
- Numbers: target $2.00 · quoted $2.45 · power packing
- Last: Jul 7, Cherry came back at $2.45
- Next: counter or accept; gap is 45c/pc = ~$3,375 on the lot

### DIS-80513-LLJ · Two-Tone Hooded Windbreaker · 6000 pcs
- Client: Lecia, Choice Clothing (South Africa)
- Status: quoting | Ball: THEM since Jul 7 — confirm interest / sample
- Last: Jul 7, told her it's a fresh offer, offered to arrange a sample
- Next: chase if silent 2+ more days

### DIS-26070707 · Girls' Short Sleeve T-Shirts · 453,892 pcs
- Client: Kyla (Power Fashion side)
- Status: quoting | Ball: US — big volume, licensing question
- Last: Jul 7, factory can export but Power needs a license to sell in stores
- Next: resolve the license question — huge qty, worth the effort

## WARM

### AERO-LS · Aeropostale Mens Long Sleeve Tee · 15,000 pcs
- Client: supplier baywatch098 (offer inbound to us), 100% cotton
- Status: lead | Ball: US — evaluate the offer
- Next: decide if there's a buyer for it before replying

### PWR-SNEAKERS · Unisex Sneakers · 6000 pcs
- Client: Noma, Power Fashion (SA)
- Status: negotiating | Ball: THEM — confirmed 1000u test @ $2.70
- Last: Jul 7, Joyce confirmed 1000prs test order
- Next: make sure the test order is raised; upsell rest after test lands

<!-- Add: Power Fashion board shoes 5000 (order being raised), Stockpapa
     kids shoe quotes pending, NINGBO/Stanley shipments (Toni-Ann). -->

---

## ARCHIVE — dropped / closed (keep the history)

<!-- When a deal dies or closes, move its block here with the outcome.
     Dropped: reason + last price (teaches us what didn't work).
     Closed: final price + margin if known (teaches us what does). -->

## Born/dropped log

<!-- One line per deal birth or death, dated — the pulse of the pipeline.
     Winston appends here so we can see flow over time: how many deals
     born vs dropped per week, and why the dead ones died. -->
- 2026-07-07: seeded 6 live deals from work mail (see above)
