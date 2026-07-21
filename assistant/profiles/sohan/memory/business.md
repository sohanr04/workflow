# The Business — Grand Empire HK (Winston's operating manual)

<!-- Winston's understanding of the stock trade — and the engine for
     getting sharper at it. Facts marked (evidenced) come from Sohan's work
     mail. Items marked ASK SOHAN are gaps to fill from him — do NOT invent
     these; ask a sharp question, record his answer, move it out of the
     LEARN list. Six months in, you should know this trade cold. -->

## The model (evidenced)

Grand Empire HK is an apparel **stocklot / surplus trading** business.
Source garment stock cheap — overstock, cancelled orders, factory surplus,
fresh production — from suppliers (mostly Chinese factories) and sell it to
retail buyers, mainly **South Africa** and **Oceania**. The money is the
**spread per piece × the volume**. You don't hold much risk if you sell
before you buy; you make it back on speed and on knowing what each buyer
will pay.

**The core equation Winston runs on every deal:**
`(sell price/pc − cost price/pc) × quantity = gross spread`.
Then subtract freight, duties, any sample/inspection cost to get real
margin. Always show Sohan the gross spread number when a price moves — it's
how he decides.

## The flow of a deal (evidenced)

1. **Offer in / source out** — a supplier sends a stock offer (item, qty,
   fabric, price, photos), OR a buyer requests a product type and Sohan
   hunts stock to fill it.
2. **Quote** — present to a buyer at a per-piece price + MOQ. Deals carry a
   ref (DIS-80513-LLJ, GBT26-3334).
3. **Negotiate** — buyer counters on price/qty; often a small **test order**
   first (e.g. 1000u) before the full lot.
4. **Sample** — physical sample sent/approved before bulk.
5. **Confirm & raise order** — buyer confirms, Joyce raises it internally.
6. **Payment & ship** — Jacqueline handles payment; Toni-Ann handles ship.

Recurring terms: **power packing**, MOQ, per-piece USD pricing, CADs,
lookbooks, "raise the order".

## The states Winston tracks (deals.md)

lead → quoting → negotiating → sample → confirmed → shipping → closed (or dead).

**THE DEAL LIFECYCLE LAW (Sohan, 2026-07-15) — this governs everything:**
- **BORN = a BUYER REPLIES to an offer we sent.** Only that. The relay blasts
  offers constantly; those are NOT deals — we've already offered, we're always
  willing to sell. A buyer replies only when it's a style they actually need —
  **that reply is the birth.** A supplier offer alone is a lead to match, not a deal.
- **LIVE = never stops until explicit death.** The instant it's born I chase it
  relentlessly (both legs + sample legs) and it NEVER goes cold or falls off the
  board. **Silence is NOT death — silence is an overdue chase.**
- **DEAD = only explicit.** The buyer says drop, OR Sohan says drop. Nothing else
  kills a deal — not silence, not age, not "it went cold." (OLD rule "goes cold →
  archive" was WRONG and is retracted.)
- Dead deals → archive with reason + last price; never delete. The losses teach
  pricing and which buyers flake (e.g. Lecia shops samples).

## Winston's Deal-Desk OS (board's structure + LLM brain)

Source of the model: the deal board's own code — `grand-empire-stock-deals/lib/
deals/derive.ts` (ball/legs/staleness), `chase.ts` (urgent pulse), and the `deals`
schema. Mirror its RIGOR; add intelligence it can't have.

**Adopt from the board (the deterministic spine):**
- Deal = **buyer × style**; born ONLY on a buyer reply (buy|question). See lifecycle law above.
- **Ball = who sent last, per leg.** Their reply → ball US. We sent → waiting on them.
- Clock = last message; **ball-on-US past the short clock = URGENT** (the silent killer).
- Two linked legs per deal: **buyer thread** (sell) + **factory_check** (supplier price / buy).

**Add the LLM layer (why I beat the cron):**
1. **Chase BOTH sides — including the supplier on PRICE.** Draft the factory squeeze
   ("need $X to close vs the buyer's $Y"), not just "relay quote." Buy leg = margin.
2. **Read the words, not just timestamps** — hard-no vs soft-maybe vs "need a sample"
   (a sample leg being born). Set ball/stage from meaning, not just who emailed last.
3. **Margin math** — (sell − buy) × qty − freight; rank the board by DOLLARS, biggest first.
4. **Carry scars** — apply per-counterparty patterns (Lecia shops samples → PO before sample).
5. **Samples = their own two legs** — supplier makes/ships · buyer reviews/confirms.
6. **Draft the chase** — ready-to-send, quoting the last email, in Sohan's voice. He hits send.

**The loop:** sweep 3 boxes → derive ball/legs/margin per deal → surface only ball-on-US
by dollars (+ subject line) → draft the chase → never let a live deal go silent till explicit drop.

## The desk playbook — how Winston wins deals (general trade craft)

These are the levers that make a stocklot desk money. Sharpen each with the
real Grand Empire specifics as you learn them.

- **Speed is the edge.** Stock is perishable in value — the same lot sits in
  five traders' inboxes. First credible quote usually wins. A deal with the
  ball on us for >24h is a leak.
- **Sell before you commit.** Ideal order: line up the buyer's interest and
  price, then lock the supplier. Reduces the risk of sitting on stock.
- **Anchor, then concede slowly.** Quote with room. When a buyer counters,
  don't jump to their number — give ground in small steps, and only for
  something (bigger qty, faster payment, taking the full lot).
- **Test order → full lot.** Buyers derisk with a small test (e.g. 1000u).
  Winston's job: make sure the test actually gets raised, then upsell the
  balance the moment it lands well.
- **Bundle the slow movers.** Move dead/aging stock by pairing it with a
  hot lot a buyer already wants.
- **Every gap in dollars.** "45c/pc on 7,500 = ~$3,375." Never let Sohan
  argue a price in cents when the lot number is what matters.
- **Protect Parker's floor.** Parker has final say on price. Never draft a
  quote below whatever floor applies (ASK SOHAN the floors per category).

## Pricing & margin — LEARN the real numbers

The playbook above is generic until it's calibrated to Grand Empire's
actual economics. Fill these from Sohan (ask one at a time, in context):

- ASK SOHAN: **target margin per category** (jackets vs tees vs shoes vs
  pants) — what $/pc or % spread makes a deal worth doing?
- ASK SOHAN: **the price floor** — how low can we go before Parker says no?
- ASK SOHAN: **who sets the sell price** — Sohan, Parker, or the buyer's
  budget? How much room does Sohan have to move without asking Parker?
- ASK SOHAN: **freight/duty rule of thumb** to SA and NZ — roughly what to
  subtract per piece to get real margin from gross spread.
- ASK SOHAN: **payment terms** — deposit %, when does money move, what does
  Jacqueline need before shipping?

## The counterparties — LEARN their patterns

Each buyer and supplier has a pattern worth knowing cold (record it in the
people/ files as you learn it):

**Buyers — FULL ROSTER (from relay `data/customers.csv`, 2026-07-16).**
6 buyer accounts, 38 contacts. (u) = unsubscribed from blasts — do NOT
expect them on a blast; reachable direct only. All SA unless noted.

- **Power Fashion** (@powerfashion.co.za) — biggest account, 19 contacts,
  big volumes, often quotes in Rands (R). Live: **Mandisa Dladla** (mdladla —
  pants, opened R70→$2.50), **Noma Fakazi** (nfakazi — sneakers, board shoes),
  **Kyla Mulder** (kmulder — the 453k girls' tees), **Michelle Sampson**
  (msampson — baby 2pc sets, opened $0.80), Nomndeni Nkosi (nnkosi), Somi
  Ntsodi, Taryn Smith, Setshaba Mmusi, **Kylie Blakeman** (kblakeman — a Power
  buyer, ≠ internal "Kylie Yan"), Ziyanda Zembe, Aysha Ballim, Clayton Manuel.
  (u): Bernita Sukhlal, Tyla Reddy, Denise Pillay, Megan Govender, KerryLee
  Godden, Damian Narasimmah, Janaine Naidoo.
- **Choice Clothing** (@choiceclothing.co.za) — very active; jackets, caps,
  joggers, windbreakers, bombers. **Lecia** (leciao — fast, needs a clear USD
  price on the offer; was auto-suppressed early Jul, lifted 6 Jul), **Nawaal**
  (nawaalk — opens low, $0.90 on the cap), Caryn (caryna), Kauthar (kauthars),
  Thakierah (thakierahj).
- **Good Hope Sales** (Cape Town; labelled **"Stride"** in the relay,
  @goodhopesales.com) — **Chantal Nolan** (chantaln — $1.25 on lounge pants),
  Amanda (amandac), David (davidf).
- **Style / Retail SLS** (@retailsls.co.za) — Charmain Xaba (charmaine.xaba),
  Tidoe Mbhelu, Bianca Lee. (u): Zahra.
- **Jam Clothing** (@jamclothing.co.za) — **blast-SUPPRESSED; pull channel.**
  Gets ONE digest email/day (see "The Jam digest" below) + browses ge-stock.com.
  Grant Fraser (mens), Marisa Ribbink (ladies), Ronald Mampa (kids), Zanele
  Mgoduka (footwear), Nicole Thompson (bags).
- **Blue Barrel** (@bluebarrel.co.za) — **outerwear-ONLY** buyer (env-gated to
  the jacket family: jacket/coat/bomber/puffer/windbreaker/parka/anorak/etc).
  Mohammed Karodia, Ashraf.

<!-- The Warehouse Group (Mark Stirton, NZ) is repeat/production business,
     NOT stocklot — deliberately OUT of Winston's stock-only desk. -->

**Suppliers — FULL ROSTER (from relay `SUPPLIERS.md`, 2026-07-16).**
14 active supplier domains, ranked by offer volume. This is the real buy
side — squeeze here, margin is made here.

- **stockpapa.cn** (~47%, the dominant source) — Scott (scott@), Daisy;
  SP-xxxxx refs; bombers, jackets, tees. Sends body+JPGs and multi-product
  `.pptx` decks. Good colours (Parker).
- **gbestgarment.com** (~28% — "Cherry") — GBT26-xxxx refs. Sat $2.45 on the
  pants, we pushed $1.80. JPGs + Excel + inline. LEARN: how far/fast Cherry drops.
- **tailormax.com** (~7%) — body + inline photos + size chart.
- **hpromise.com** (~5%) — Excel + many inline images.
- **bentagarment.com** (~4%) — JPGs + Excel; 86% arrive as RE:/FW: threads.
- **wolftrade.cn** (~3%) — footwear.
- **yeletrading.com** (~2%) — quotation-style Excel.
- **qq.com / 163.com** (~1% each) — generic shared mailboxes; JPGs. (Note:
  ninaguo1990@163.com caused the Jul-9 image leak → her offers now draft-only.)
- **wellroyalgarment.com, xuanqigmt.com, royalgarment.cn, wintopstock.com,
  wintopshoes.com** (<1% each) — long tail; royalgarment is Excel-only+PDF,
  wintopshoes is footwear.
- **Atila** (YLBL-/DIS- footwear: sandals, flats, skate shoes) — draft-mode
  supplier; text-only + carton-photo habits triggered the no-photo + photo-type
  gates. Ningbo-based, ships from a Jan DC (per DIS-26071506 skate shoes).
- LEARN: the single go-to source per category (jackets→Stockpapa/Gbest,
  shoes→wolftrade/wintopshoes/Atila, tees→?).

> ⚠️ **"District Stock" is NOT a supplier.** It is Grand Empire's OWN
> outbound identity — the name/address the relay blasts offers under
> (empire-districtstock@grandempirehk.com) to hide the real supplier from
> buyers. Every **DIS-** ref is our own offer number. (Stanley Ng is a
> Grand Empire colleague per about-me.md, not a "District Stock" contact —
> earlier note conflating them was wrong.)

## Two-sided deals — where the money actually is (evidenced 2026-07-08)

**Most deals have two legs, and the margin is the gap between them:**
- **BUY leg** — a supplier (Chinese factory: Gbest/Cherry, Stockpapa/Scott).
- **SELL leg** — a buyer (SA: Power Fashion, Choice, Good Hope; NZ: TWG).

Margin = **sell price − buy price, per piece × qty**. Worked example
(DIS-26-3334 lady's pants, 7,500): buyer Power Fashion offered **$2.50**;
supplier Cherry sat at **$2.45** → only 5c, dead. Joyce is squeezing Cherry
to **$1.80** → that turns it into ~$5,250. **The lesson: buyers come in low
and the real work is squeezing the SUPPLIER down, not the buyer up.** Winston
tracks both legs on every deal and watches the buy side hardest.

## Refs — how to read a deal code (evidenced)

- **DIS-xxxxx** = a **District Stock** offer, blasted by the relay (see
  below). Used across ALL buyers — it's Grand Empire's own offer number, not
  any one buyer's. (Earlier note that DIS = Power Fashion's numbering was
  WRONG.)
- **GBT26-xxxx** = a Gbest (Cherry) supplier ref. **SP-xxxxx** = Stockpapa.
- The ref is how a deal is tracked across the whole thread, both legs.

## The relay — the automated blast engine (evidenced + from prior builds)

Grand Empire runs a **mail relay** (Sohan's own system) that automates the
top of the funnel. Sender address: **empire-districtstock@grandempirehk.com**.

- A supplier stock offer comes in → the relay **strips the supplier's
  identity and cost**, assigns a DIS ref, and **blasts the offer to matched
  buyers** (photos, spec, sizes, qty) — buyers see "[External Sender]".
- When a buyer replies with interest/a price, it comes back to the team
  (Parker/Joyce/Sohan) and **human negotiation takes over** — that's the
  email traffic Winston tracks in deals.md.
- Some suppliers are **drafted not sent** (e.g. Atila) via a draft-mode
  switch; there's also a global pause on buyer blasts. (Operational detail —
  Winston doesn't run the relay, just understands deals are born through it.)

So a DIS deal is usually **born automatically** (relay blast) and then
**closed by hand** (the team negotiates buy + sell). Winston's job starts at
the negotiation and never lets one stall.

### The full pipeline, in my words (from relay README + HANDOFF, 2026-07-16)

A deal's birth and flow, stage by stage — this is the machine Winston sits on
top of:

1. **Offer lands** in a shared Outlook inbox (empire-chinastocks@). Classifier
   (Claude Sonnet) decides: is this a real stock offer or noise (bounce,
   newsletter, internal)?
2. **Extract by ALLOWLIST** — the core safety idea: the relay never tries to
   *remove* the supplier's price/name, it only **extracts the safe fields**
   (style, description, fabric, colours, sizes, breakdown, qty, packaging) and
   **builds a fresh email**. Price and supplier identity have *no field to live
   in*, so they can't leak. Excel sheets are parsed for data + images then
   DISCARDED (never forwarded); PDFs/docs never forwarded; only **images** go out.
3. **Category tag + persona routing** — the offer is tagged with categories
   (footwear, clothing-mens/womens/kids, knitwear, outerwear-jackets, denim,
   accessories, bags, etc). **Only buyers whose persona buys those categories
   get the email.** (Blue Barrel = outerwear-only; a buyer with no persona is
   skipped until profiled.)
4. **QA gates before send** (all fail-CLOSED → hold + Telegram alert, never a
   bad blast): `detectLeaks()` scans for any supplier name/price/URL; a **Gemini
   image scan** classifies every photo product/packaging/document/other and
   **drops non-product photos** (carton stencils, spec sheets); **no-photo hold**
   (zero product photos = held, never blasted bare); **assorted gate** (offer
   spanning ≥3 buyer categories = skipped, leak risk); **MOQ filter** (known qty
   < 750 skipped); **dedup** (repeat sends fingerprinted, only the first goes).
5. **Blast** — a fresh DIS-xxxxx email under **empire-districtstock@**, photos +
   safe spec, to the matched buyers (they see "[External Sender]").
6. **Buyer bites** — a buyer replies "keen"/gives a price → a **🔥 ping** hits
   the team's WhatsApp. THIS is where a deal enters Winston's book.
7. **Negotiation loops** (relay assists, team decides):
   - **`factory - <msg>`** off the ping → drafts a sourcing reply TO the supplier
     (squeeze the buy leg).
   - **`buyer - <msg>`** off the ping → drafts a reply TO the buyer, threaded
     into their "keen" email with the cleaned offer photos + detail block
     re-attached. Signs Sohan (from spr@) or Joyce (from joyce@).
   - Both are **DRAFT mode** now — the team reviews/edits/sends manually; edits
     are logged to sharpen the voice profile. One ref can carry a factory draft
     AND a buyer draft independently.
8. **Close by hand** — buyer confirms → Joyce raises the order → Jacqueline
   payment → Toni-Ann ship.

### How the team REPLIES — the addressing protocol (from the relay code, 2026-07-21)

When a buyer bites on a DIS blast, the reply does NOT come from the relay
address. The pattern (relay `factory.ts` / `customer-followups.ts` — every
draft Winston writes must match it):

- **BUYER reply:** FROM a personal mailbox — **spr@** (Sohan) or joyce-wong@
  (Joyce) — TO the buyer, **CC the internal team**: Mpr@ (Parker), joyce-wong@,
  Kylie-yan@ (minus whoever is sending). Threaded into the buyer's "keen"
  email, cleaned offer photos re-attached. **NEVER a supplier on a buyer
  email.**
- **FACTORY reply:** FROM **spr@**, TO the supplier who sent the offer, CC =
  internal team **plus that factory's own team** (e.g. stockpapa → daisy@,
  scott@, admin@stockpapa.cn). **NEVER cross-CC suppliers; a supplier never
  appears on a buyer email and vice versa** — that's the identity wall.
- **Voice** (the relay's own spec): warm, brief, direct — "Hi @handle," …
  "Can we please do $1.40 with power packing?" … "Please let me know." Sign-off
  as its own final paragraph: "Thank you," + name on a new line.
- Customers reply into districtstock@; the team answers from personal boxes.

So when Winston drafts: buyer draft = as Sohan from spr@, CC Parker/Joyce/Kylie;
factory draft = from spr@, CC team + the factory's own people. Include the CC
line in every draft so Sohan can copy-paste it whole.

### The Jam digest — the one buyer who doesn't get blasts

**Jam Clothing is DIGEST-ONLY.** Instead of per-offer blasts they get ONE
email/day (cron 00:00 HKT), subject `Empire District Stock — <Month D> Stock
Update`, counts per department + a link to **ge-stock.com**. Sent **AS Joyce**
(joyce-wong@ — Parker required the sender be Joyce), CC spr@ + internal Kylie
Yan. Live + verified since 14 Jul.

### The leak scars — why all those gates exist (know this)

The gates above aren't paranoia — they're scar tissue. **9 Jul: a mixed June
lot (ninaguo1990@163.com) blasted to 17 buyers WITH the supplier's name + FOB
cost prices** because two tall catalog spec-sheets slipped the image scan. Not
recallable. That one incident spawned the no-photo hold, the photo-type gate,
and the assorted-category gate. **The whole system exists to make sure a buyer
never sees what we paid or who we bought from** — the relay is FROZEN and
Winston never touches it, but this is why: one leak burns the spread on every
future deal with that buyer.

## The website — the buyer pull channel (from prior builds)

**ge-stock-site.vercel.app** — a buyer-facing **live stock catalog** (rolling
7-day window). Instead of waiting for a blast, some buyers browse the site
and click **"Interested"** on an offer; that intent is turned into a buyer
reply the relay processes just like an email. Notably **Jam Clothing** is
blast-suppressed and uses the site as their pull channel. Product photos come
from the districtstock Sent Items, refreshed every ~15 min.

## Where deals live + YOUR ACCESS — the Outlook reader (important)

You have **read access to all 3 Grand Empire mailboxes** through a small
app-only reader — the SAME Microsoft Graph app the relay uses, so there is
**no login to do and nothing that expires**. It is READ ONLY (you cannot
send, delete, or change anything from it — you still draft, Sohan sends).

**HOW TO RUN IT (matters — get this wrong and it's blocked):** call it as
the EXACT command below, from your working dir. Do NOT prepend `cd`, do NOT
wrap it in quotes, do NOT use an absolute path — those forms are not on your
permission allowlist and will come back "requires approval". Just:
`node ../../scripts/graph.js <cmd>`. If a run is ever refused, you're either
adding a `cd`/path prefix or trying a mailbox other than spr/china/dis
(Parker's box `mpr@` is deliberately banned — that refusal is correct, not a bug).

Run it from your working dir (`profiles/sohan/`):

```
node ../../scripts/graph.js boxes                 # the 3 mailboxes
node ../../scripts/graph.js recent spr 15         # latest in the deal desk
node ../../scripts/graph.js recent china 10       # supplier offers landing
node ../../scripts/graph.js recent dis 10         # relay outbound / buyer intent
node ../../scripts/graph.js search spr "Lecia" 20 # KQL search one box
node ../../scripts/graph.js thread SP80499        # ONE deal across ALL 3 boxes, in time order
node ../../scripts/graph.js get spr <messageId>   # full body of one message
```

The **three boxes and what each is for:**
- **spr** = `spr@grandempirehk.com` — the human deal desk. Sohan + team
  (Joyce, Parker) negotiating buy & sell. Most deal state lives here.
- **china** = `empire-chinastocks@grandempirehk.com` — where **supplier
  offers land** (Scott/Stockpapa, Cherry/Gbest, etc.). A new deal is often
  BORN here.
- **dis** = `empire-districtstock@grandempirehk.com` — the **relay's
  outbound**: the blasted DIS- offers, and the buyer-intent forwards
  ("Lecia is interested in DIS-… they said $2.90"). The SELL leg shows up here.

**`thread <style-code>` is your deal-tracking superpower** — it pulls a
code (SP80499, DIS-80553, GBT26-3334) across all 3 boxes and orders it in
time, so you see the whole life of a deal — offer in → blasted → buyer bit →
who replied last → where it stalled — in one shot. Run it on any deal you're
reconciling or before answering "what's the status of X". Reconcile what you
find into `deals.md` the same turn.

- Personal Gmail carries some too (Parker forwards deals there) — via the
  gmail MCP if connected.

The buyer/supplier DBs in people/ are a **working set**, not the full list.
There are **14 active suppliers** and many more buyer contacts than are
written down. Build the roster out from the real box + the authoritative
sources below as you go — never assume the people files are complete.

## Understand the systems — READ THE RELAY CODEBASE

The relay, website, and matching engine are real code you can and SHOULD read
to fully understand this business. The authoritative repo:

- **`~/Projects/grand-empire-stock-inventory-matching`** (branch
  `feat/auto-relay`) — the mail relay (`harmonious-transformation`). Also on
  GitHub: `sohanr04/grand-empire-stock-inventory-matching` (private).
  Reading map:
  - **`HANDOFF.md`** — READ FIRST. Current state, what's live, the session log.
  - **`SUPPLIERS.md`** — every supplier's format + the leak tricks the relay
    defeats (allowlist-not-blocklist: extract safe fields, rebuild a fresh
    email so price/identity can't leak). This is the real supplier DB.
  - **`data/customers.csv`** — the authoritative buyer list (company, contact,
    email, unsubscribed).
  - **`README.md` / `ROADMAP.md`** — architecture + direction.
  - **`lib/factory.ts`, `src/server.ts`** — the factory loop (sourcing replies)
    and the buyer loop (`buyer - <msg>` drafts a reply to the buyer). `lib/`
    holds extraction, image redaction, voice profiles.
- Siblings (if present): `~/Projects/ge-stock-site` (the catalog website),
  `~/Projects/ge-site-intents` (the "Interested" click → buyer-reply worker).

**Rules when reading the code:**
- Read to UNDERSTAND, never to modify. The relay core is FROZEN — you don't
  deploy, change, or run it. You're a deal operator, not the relay engineer.
- The repo holds secrets (`.env`, Supabase/API keys). NEVER copy a secret into
  memory, notes, chat, or anywhere — same absolute rule as always.

## Winston's job, in one line

Make sure no deal dies from neglect, no reply is forgotten, every price is
argued in dollars, the big deals get priority, and Grand Empire books more
spread this month than last. Learn the trade well enough that a quote is
benchmarked against history, not guessed.

## Open LEARN list (work this down — one question at a time)

<!-- Winston: pull the top item into a real conversation when the moment
     fits, get the answer, write it into the right section above, delete it
     from here. Don't dump all these on Sohan at once. -->

1. Monthly margin/revenue target (→ goals.md).
2. Target margin per category + Parker's price floor.
3. How much room Sohan has to move price without asking Parker.
4. Freight/duty rule of thumb to SA and NZ.
5. Payment terms + what Jacqueline needs before shipping.
6. How far/fast Cherry (and other suppliers) drop on a counter — the buy leg
   is where margin is made, so this is worth watching every deal.
7. Go-to supplier per category (jackets, shoes, tees).

<!-- RESOLVED 2026-07-08 (kept for history): the relay = automated blast
     engine (empire-districtstock@); the website = ge-stock-site.vercel.app
     buyer pull channel; DIS- = District Stock relay ref. See sections above. -->

