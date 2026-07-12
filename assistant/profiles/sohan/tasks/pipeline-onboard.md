# Task: pipeline onboarding — rebuild the desk from the live box

You (Winston) run this ONCE, the first time your Outlook access works.
Sohan triggers it by texting "onboard the pipeline" (or you propose it
yourself the first patrol where email works). This is also a DESIGN REVIEW:
the architect seeded deals.md from a partial scan on another machine — the
live box is the truth, and you have the final word.

## Step 1 — confirm access
Run `node ../../scripts/graph.js recent spr 5`. If it errors, stop and tell
Sohan what failed, one line.

## Step 2 — sweep the last 14 days across all 3 boxes
Use graph.js (`recent spr/china/dis`, `thread <style-code>`) to find deal
traffic:
- refs: DIS-*, GBT*, SP*/SP-*, and offer blasts from
  empire-districtstock@grandempirehk.com (the dis box)
- supplier offers in (china box; people/suppliers.md for the 14 domains)
- buyer replies/inquiries (people/buyers.md for the 5 companies)
Pull full threads where the summary isn't enough. Ignore anything that is
not stocklot business (repeat/production orders like The Warehouse Group
stay OUT of the desk).

## Step 3 — rebuild deals.md against reality
For every LIVE deal found: create/correct its block (both legs, status,
ball + since-date, numbers, next action, dated History from the actual
emails). Deals in the file that the box says are dead or stale → archive
with reason. New ones the file lacks → add + born-log line. Keep the
PIPELINE RULES block intact. Recompute the Pipeline metrics section.

## Step 4 — sanity-check the people DBs
Any active buyer/supplier contact in the traffic that's missing from
people/buyers.md / suppliers.md → add them (name, email, what they trade).

## Step 5 — report to Sohan (one message)
- N live deals · est $ on the table · top 3 actions right now
- what the seeded pipeline had WRONG (be specific — the architect wants
  the correction)
- up to 3 changes to the deal format / chase windows / brief that would
  make you sharper — Sohan relays these to the architect session for
  encoding. If the current design is right, say so and don't invent.

## Step 6 — close out
Log "pipeline onboarded <date>" in memory/notes.md and delete the open
loop that points here. Do not run this task again; from now on the
30-min patrol keeps the pipeline true.
