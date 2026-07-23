#!/usr/bin/env node
'use strict';

/**
 * status.js — the two-sided deal reader. Sohan's model, verbatim:
 *
 *   BORN  = a buyer ping (the intent forward / districtstock mail / WA mirror).
 *   SELL  = the buyer side. The hinge is OUR REPLY:
 *             no reply after their ping  → "you haven't answered X on this item"
 *             replied                    → "working it — last move <date>, ball us/them"
 *   BUY   = the factory side. The hinge is NEGOTIATION:
 *             none  → carry the supplier's current/list price (or "no price")
 *             open  → most recent price + date.
 *
 * Everything is derived from the ACTUAL MESSAGES (who sent last, when), never
 * from a feed date — so the ball can't be guessed wrong. Prices are surfaced
 * from the messages ($ amounts, most recent first) for Winston to verify.
 *
 * Usage (from profiles/sohan/):
 *   node ../../scripts/status.js <ref>              # one deal's two-sided card
 *   node ../../scripts/status.js sweep [days]       # every buyer ping in window → cards (+ --book)
 *   node ../../scripts/status.js <ref> --book       # also write the result into book.js
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { BOXES, getToken, graph } = require('./graph');
const { retryFetch } = require('./_net');
const { classify, refMatches, core, sameCore, disSuffix, supplierCodeIn, fmtP, marginFlag } = require('./prices');

// ── who is who ───────────────────────────────────────────────────────────────
const US_DOMAINS = ['grandempirehk.com', 'district-stock.com'];
// supplier detection: known domains (mirrors the relay registry) + any .cn
const SUPPLIER_DOMAINS = new Set([
  'stockpapa.cn', 'gbestgarment.com', 'tailormax.com', 'bentagarment.com',
  'wintopstock.com', 'royalgarment.cn', 'wellroyalgarment.com', 'hpromise.cn',
]);
const domOf = (addr) => String(addr || '').toLowerCase().split('@')[1] || '';
const isUs = (addr) => US_DOMAINS.some((d) => domOf(addr).endsWith(d));
const isSupplier = (addr) => {
  const d = domOf(addr);
  if (!d || US_DOMAINS.some((x) => d.endsWith(x))) return false;
  return SUPPLIER_DOMAINS.has(d) || d.endsWith('.cn');
};

const fmtAge = (iso) => {
  if (!iso) return '?';
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
  return h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};
const day = (iso) => (iso || '').slice(0, 10);

// ── working-day silence clock (Sohan's rule) ─────────────────────────────────
// Silence is counted in WORKING hours on the relevant side's calendar, in HKT:
//   supplier → Mon–Sat (skip Sunday) · buyer → Mon–Fri (skip Sat+Sun).
// So a buyer who went quiet Friday isn't "overdue" on Monday — the weekend
// doesn't count against them. Weekend hours simply don't accrue.
const HK_OFF = 8 * 3600 * 1000;
const hkDow = (ms) => new Date(ms + HK_OFF).getUTCDay(); // 0=Sun … 6=Sat, HKT
function workingSilentH(sinceISO, side) {
  const start = new Date(sinceISO || 0).getTime();
  if (!start || isNaN(start)) return 0;
  const now = Date.now();
  if (now <= start) return 0;
  const isWork = (dow) => side === 'supplier' ? dow !== 0 : (dow !== 0 && dow !== 6);
  const DAY = 86400000;
  let ms = 0, cursor = start, guard = 0;
  while (cursor < now && guard++ < 500) {
    const nextMid = (Math.floor((cursor + HK_OFF) / DAY) + 1) * DAY - HK_OFF; // next HKT midnight
    const segEnd = Math.min(nextMid, now);
    if (isWork(hkDow(cursor))) ms += segEnd - cursor;
    cursor = segEnd;
  }
  return ms / 3.6e6;
}
const fmtWD = (h) => h == null ? '?' : (h < 24 ? `${Math.round(h)}wh` : `${Math.round(h / 24 * 10) / 10}wd`); // working-hours / working-days
// surface $ prices (and bare x.xx after USD) from text, order preserved
const prices = (t) => (String(t).match(/(?:US?\$|USD\s?)\s?\d+(?:\.\d+)?|\$\s?\d+(?:\.\d+)?/gi) || []).map((s) => s.replace(/\s+/g, ''));

function die(m) { console.error('status.js: ' + m); process.exit(1); }

// bounded-concurrency map — keeps the live board fast without hammering Graph
async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; } }
  }));
  return out;
}

// ── the DIS → factory link, from the relay's own records ─────────────────────
// offer_sends holds the supplier's ORIGINAL price for each DIS offer (the
// "no negotiation → their current price is X" case); factory_checks holds the
// supplier-side ref (DIS-10396 ↔ SP10396-WL) + supplier name/email, which is
// how we find the factory THREAD (it runs under the supplier's ref, not DIS).
async function supplierLink(ref) {
  const URL = (process.env.SUPABASE_URL || relayEnv('SUPABASE_URL') || '').replace(/\/$/, '');
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || relayEnv('SUPABASE_SERVICE_ROLE_KEY');
  const link = { price: null, style: null, name: null, email: null };
  if (!URL || !KEY) return link;
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  const pat = encodeURIComponent(`*${ref}*`);
  try {
    const os_ = await (await retryFetch(`${URL}/rest/v1/offer_sends?offer_subject=ilike.${pat}&select=supplier_price&limit=3`, { headers: H })).json();
    const rawP = (os_.find((r) => r.supplier_price) || {}).supplier_price;
    if (rawP != null) {
      // relay stores split-lot prices mashed ("3.282.95" = mens 3.28 / kids 2.95)
      const nums = String(rawP).match(/\d+(?:\.\d{1,2})?/g) || [];
      link.price = nums.length ? nums.join('/') : null; // "3.28/2.95" — clean, split visible
      link.priceNum = nums.length ? parseFloat(nums[0]) : null; // first for margin math
    }
  } catch { /* best effort */ }
  try {
    const fc = await (await retryFetch(`${URL}/rest/v1/factory_checks?offer_subject=ilike.${pat}&select=supplier_style,supplier_name,supplier_email,target_price&order=created_at.desc&limit=5`, { headers: H })).json();
    const best = fc.find((r) => r.supplier_style) || fc[0];
    if (best) { link.style = best.supplier_style || null; link.name = best.supplier_name || null; link.email = best.supplier_email || null; }
  } catch { /* best effort */ }
  return link;
}

// ── read one deal: all messages for the ref, split into the two sides ────────
async function readDeal(ref, tok, link = {}) {
  const rows = [];
  // search the DIS ref, the relay-known supplier code, AND the shared suffix
  // ("26-3964") which appears in BOTH the DIS blast and the GBT/SP supplier
  // subjects — so the buy thread is found even when the relay has no mapping.
  const terms = [ref];
  if (link.style && !sameCore(link.style, ref)) terms.push(link.style);
  const suffix = disSuffix(ref);
  if (suffix && suffix !== ref) terms.push(suffix);
  for (const [key, mb] of Object.entries(BOXES)) {
    for (const t of terms) {
      const j = await graph(`/users/${mb}/messages?$search=${encodeURIComponent('"' + t + '"')}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview&$top=50`, tok);
      for (const m of j.value || []) rows.push({ box: key, mb, viaSupplierRef: t !== ref, ...m });
    }
  }
  // de-dupe (same message can appear via CC in two boxes) by date+subject
  const seen = new Set();
  const REFTOK = /\b(?:DIS|GBT|SP|KG)[- ]?\d[\d-]*[A-Z]*/i;
  // clean the relay's supplier_style (often stored as "GBT26-3964MEN'S PADDED VEST")
  // down to just the code; the extractor keeps only the same-core token.
  let supplierCode = link.style ? supplierCodeIn(link.style, ref) : null;
  const msgs = rows.filter((m) => {
    const k = `${(m.receivedDateTime || '').slice(0, 16)}|${(m.subject || '').slice(0, 60)}|${m.from?.emailAddress?.address || ''}`;
    if (seen.has(k)) return false; seen.add(k);
    const hay = `${m.subject || ''} ${m.bodyPreview || ''}`;
    // keep only messages that BOUNDARY-match the DIS ref OR share its core with a
    // supplier code (kills DIS-26-33344 bleed; keeps GBT26-3964 same-core threads).
    if (REFTOK.test(m.subject || '')) {
      const hitDis = refMatches(hay, ref);
      const sc = supplierCodeIn(m.subject || '', ref); // same-core GBT/SP code
      if (!hitDis && !sc) return false;
      if (sc && !supplierCode) supplierCode = sc; // learn the supplier code from the thread
    }
    return true;
  }).sort((a, b) => (a.receivedDateTime || '').localeCompare(b.receivedDateTime || ''));

  const sell = [], buy = [];
  for (const m of msgs) {
    const from = m.from?.emailAddress?.address || '';
    const tos = (m.toRecipients || []).map((r) => r.emailAddress?.address || '');
    const text = `${m.subject || ''} ${m.bodyPreview || ''}`;
    // CRITICAL: the relay's buyer-intent forward ("X is interested… They said:")
    // is sent FROM our relay address but it is the BUYER'S move, not ours.
    // Counting it as "us" fakes a reply we never sent. Same for inbound-offer
    // notifications. A message is OURS only if from an us-domain AND not a
    // mirrored buyer ping.
    const intentForward = /is interested in|They said:|New buyer reply|buyer replied/i.test(text);
    const us = isUs(from) && !intentForward;
    // pull the real buyer's name out of the forward when present
    const fwdWho = intentForward ? ((text.match(/([A-Za-zÀ-ÿ .'-]+?\s*\([^)]+\))\s+is interested/i) || [])[1] || null) : null;
    const counterparty = us ? tos.find((t) => !isUs(t)) || '' : (fwdWho || from);
    const side = (m.viaSupplierRef || m.box === 'china' || isSupplier(counterparty) || isSupplier(from) ||
      (link.email && (from === link.email || tos.includes(link.email)))) ? buy : sell;
    // PRICE TEXT: on an intent-forward, ONLY the buyer's quoted words are theirs.
    // The "Offer received from supplier … $X" footer is OUR blast price — reading
    // it as the buyer's number is what flags every fresh bite as below-cost. Cut
    // to just the "They said: '…'" quote so the classifier sees only their words.
    let clsText = text;
    if (intentForward) {
      const q = (text.match(/They said:\s*["']?([\s\S]*?)["']?\s*(?:📅|Offer\s+re|$)/i) || [])[1];
      clsText = q != null ? q : text.replace(/(?:📅|Offer\s+re)[\s\S]*$/i, '');
    }
    side.push({
      ts: m.receivedDateTime, from, us, counterparty, id: m.id, mb: m.mb, box: m.box,
      subject: m.subject || '', preview: (m.bodyPreview || '').replace(/\s+/g, ' ').slice(0, 200),
      text: clsText, // buyer's own words only (forwards), for the confirmed-vs-ask classifier
    });
  }
  return { msgs, sell, buy, supplierCode };
}

// derive one side's state from its messages (the hinge logic)
function sideState(list) {
  if (!list.length) return { state: 'none' };
  const last = list[list.length - 1];
  const theirs = list.filter((m) => !m.us);
  const ours = list.filter((m) => m.us);
  // The hinge (Sohan's rule): did WE reply AFTER their ping? A pre-ping blast
  // doesn't count as working the deal.
  const firstPing = theirs[0] ? theirs[0].ts : null;
  const oursAfterPing = firstPing ? ours.filter((m) => m.ts > firstPing).length : ours.length;
  const lastPrice = [...list].reverse().map((m) => ({ p: prices(m.subject + ' ' + m.preview), m })).find((x) => x.p.length);
  return {
    state: last.us ? 'ball-them' : 'ball-us',
    last, ours: ours.length, oursAfterPing, theirs: theirs.length, firstPing,
    lastTheirs: theirs[theirs.length - 1] || null,
    who: (theirs[theirs.length - 1] || theirs[0] || last).counterparty || (theirs[0] && theirs[0].from) || '',
    lastPrice: lastPrice ? { vals: lastPrice.p, when: day(lastPrice.m.ts), from: lastPrice.m.us ? 'us' : 'them' } : null,
    cls: classify(list), // {confirmed: THEIR number, ourAsk: ours + pending} — Sohan's model
  };
}

// Obvious death/kill language — NOT authoritative (Winston verifies by reading),
// but a deterministic tripwire so a "sorry, sold" can never hide inside a
// timestamps-only card. Checked on the counterparty's last 2 messages per leg.
const KILL_RE = /(sold ?out|already sold|is sold|been sold|stock (is )?gone|no (more )?stock|out of stock|please drop|kindly drop|cancell?ed|cannot supply|not available( any ?more)?|withdrawn|pass on this)/i;

// READING WRITES — decisive state-change language in a message BODY. When the
// read-pass hits one in a THEM message, it writes a sticky book signal so the
// state change can never be forgotten (the Militia scar). accept = ADVANCE to
// order; drop = candidate for dead (needs Sohan/Winston to confirm — never
// auto-closed). Precise on purpose: a false positive costs a re-read, a miss
// costs a deal.
const ACCEPT_RE = /\b(we(?:'?ll| will| can)? (?:accept|take|confirm)|accepted?(?: the| this)?(?: order| offer)?|confirm(?:ed|ing)? the order|place (?:the |an )?order|go ahead(?: with)?|proceed with|please (?:proceed|arrange the|go ahead)|raise the (?:pi|proforma|order)|deposit (?:paid|sent|done|received)|po attached|purchase order|move forward with|want to (?:move forward|order))\b/i;
const DROP_RE = /\b(reject(?:ed)?|declin(?:e|ed|ing)|not interested|we'?ll pass|pass on (?:this|it)|won'?t (?:take|proceed|work)|can'?t use|no longer (?:need|want|interested)|cancel(?:led)? (?:the )?order|(?:please )?drop (?:this|it)|not (?:going|moving) (?:ahead|forward))\b/i;
function readSignal(text) {
  const t = String(text || '');
  const a = t.match(ACCEPT_RE); if (a) return { kind: 'accept', phrase: a[0] };
  const d = t.match(DROP_RE) || t.match(KILL_RE); if (d) return { kind: 'drop', phrase: d[0] };
  return null;
}
function killFlag(list) {
  const theirs = list.filter((m) => !m.us).slice(-2);
  for (const m of theirs) {
    const hit = (m.subject + ' ' + m.preview).match(KILL_RE);
    if (hit) return { phrase: hit[0], when: day(m.ts) };
  }
  return null;
}

function card(ref, d, link = {}) {
  const S = sideState(d.sell), B = sideState(d.buy);
  const out = [];
  out.push(`═══ ${ref} — ${d.msgs.length} messages ═══`);
  // SELL side — the hinge is our reply
  if (S.state === 'none') out.push(`SELL: (no buyer thread found for this ref)`);
  else {
    const buyer = (S.who || '?').replace(/\s+is interested.*/i, '').replace(/^[^A-ZÀ-ÿ]*/, '');
    if (S.theirs > 0 && S.oursAfterPing === 0) out.push(`SELL: ❌ NOT REPLIED — ${buyer} pinged ${day(S.lastTheirs.ts)} (${fmtAge(S.lastTheirs.ts)} ago), no reply from us since`);
    else out.push(`SELL: ✅ working it — last move ${day(S.last.ts)} (${fmtAge(S.last.ts)} ago) by ${S.last.us ? 'US' : buyer} → ball = ${S.state === 'ball-us' ? 'US' : 'THEM'}`);
    const sc = S.cls || {};
    if (sc.confirmed) out.push(`      buyer's number: ${fmtP(sc.confirmed)}${sc.confirmed.viaAgreedAsk ? ' (AGREED to our ask' : ' (their price'}, ${day(sc.confirmed.when)})`);
    else out.push(`      buyer's number: none given — open`);
    if (sc.ourAsk) out.push(`      our ask: ${fmtP(sc.ourAsk)} (${day(sc.ourAsk.when)})${sc.ourAsk.pending ? ' — PENDING, no reply' : ''}`);
    out.push(`      last msg: "${S.last.preview.slice(0, 110)}"`);
  }
  // BUY side — the hinge is negotiation
  if (B.state === 'none') {
    // no factory thread — but the relay/core-match may still know the supplier code
    const supCode = d.supplierCode;
    if (link.price || link.name || supCode) out.push(`BUY:  no negotiation started — supplier ${link.name || '?'}${supCode ? ` (${supCode})` : ''}${link.email ? ` · ${link.email}` : ''}, list price: ${link.price || 'none on record — source it'}`);
    else out.push(`BUY:  no factory contact for this ref — SOURCE the supplier code + price`);
  } else {
    const sup = B.who || '?';
    const supCode = d.supplierCode;
    if (B.ours === 0) out.push(`BUY:  offer only from ${sup} — no negotiation started`);
    else out.push(`BUY:  negotiating with ${sup} — last move ${day(B.last.ts)} (${fmtAge(B.last.ts)}) by ${B.last.us ? 'US' : 'them'} → ball = ${B.state === 'ball-us' ? 'US' : 'them'}`);
    if (supCode || link.email) out.push(`      ↳ supplier thread: ${supCode || '?'}${link.email ? ` · ${link.email}` : (B.who && /@/.test(B.who) ? ` · ${B.who}` : '')} (negotiate here)`);
    const bc = B.cls || {};
    if (bc.confirmed) out.push(`      confirmed cost: ${fmtP(bc.confirmed)}${bc.confirmed.viaAgreedAsk ? ' (AGREED to our ask' : ' (their offer'}, ${day(bc.confirmed.when)})`);
    else if (link.price) out.push(`      confirmed cost: $${String(link.price).replace(/[^0-9.]/g, '')} (their list, relay record)`);
    else out.push(`      confirmed cost: NONE — source it first`);
    if (bc.ourAsk) out.push(`      our ask: ${fmtP(bc.ourAsk)} (${day(bc.ourAsk.when)})${bc.ourAsk.pending ? ' — PENDING, no reply' : ''}`);
    if (B.state !== 'none') out.push(`      last msg: "${B.last.preview.slice(0, 110)}"`);
  }
  // kill tripwires — the words override the timestamps; Winston must verify
  const sk = killFlag(d.sell), bk = killFlag(d.buy);
  if (sk) out.push(`⚠️ SELL KILL-WORDS ${sk.when}: "${sk.phrase}" — read the thread; this leg may be DEAD, not "ball on them"`);
  if (bk) out.push(`⚠️ BUY KILL-WORDS ${bk.when}: "${bk.phrase}" — supplier may have KILLED this (sold/dropped). If so: buy leg dead → RE-SOURCE or tell the buyer; do NOT chase a corpse`);
  return { text: out.join('\n'), S, B, sellKill: sk, buyKill: bk };
}

// write the derived state into Winston's book (via book.js so history logs)
function toBook(ref, d, S, B, link = {}) {
  const args = ['add', ref];
  // overall ball: we owe the buyer a reply > factory owes us > buyer owes us
  let ball = 'us', since = d.msgs.length ? d.msgs[d.msgs.length - 1].ts : new Date().toISOString();
  if (S.state === 'ball-us' || (S.state !== 'none' && S.ours === 0)) { ball = 'us'; since = S.last ? S.last.ts : since; }
  else if (S.state === 'ball-them') { ball = 'buyer'; since = S.last.ts; }
  if (B.state === 'ball-us' && ball !== 'us') { /* factory replied, we owe them too — us wins */ ball = 'us'; since = B.last.ts; }
  args.push('--ball', ball, '--since', since);
  const next = [];
  if (S.ours === 0 && S.state !== 'none') next.push(`REPLY to ${S.who} (unanswered ${fmtAge(d.sell[0].ts)})`);
  if (B.state !== 'none' && B.lastPrice) next.push(`factory ${B.who}: ${B.lastPrice.vals[0]} (${B.lastPrice.when})`);
  else if (link.price) next.push(`factory ${link.name || '?'} list: ${link.price}`);
  if (next.length) args.push('--next', next.join(' · '));
  if (S.lastPrice && S.lastPrice.from === 'them') args.push('--sell', S.lastPrice.vals[0].replace(/[^0-9.]/g, ''));
  if (B.lastPrice) args.push('--buy', B.lastPrice.vals[0].replace(/[^0-9.]/g, ''));
  else if (link.price) args.push('--buy', String(link.price).replace(/[^0-9.]/g, ''));
  execFileSync('node', [path.join(__dirname, 'book.js'), ...args], { cwd: process.cwd(), stdio: 'inherit' });
}

// ── sweep discovery: every buyer ping in the window (relay feed = birth log) ──
function relayEnv(k) {
  const home = os.homedir();
  for (const p of [process.env.RELAY_ENV_PATH,
    path.join(home, 'Projects/grand-empire-stock-inventory-matching/.env.local'),
    path.join(home, 'grand-empire-stock-inventory-matching/.env.local')].filter(Boolean)) {
    try { const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); } catch { /* next */ }
  }
}
async function births(days) {
  const URL = (process.env.SUPABASE_URL || relayEnv('SUPABASE_URL') || '').replace(/\/$/, '');
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || relayEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!URL || !KEY) die('missing Supabase creds for sweep discovery');
  const cut = new Date(Date.now() - days * 864e5).toISOString();
  const res = await retryFetch(`${URL}/rest/v1/buyer_events?reply_type=in.(buy,question)&reply_at=gte.${cut}&select=normalized_subject,offer_subject,reply_at&order=reply_at.desc&limit=300`,
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  if (!res.ok) die('birth query HTTP ' + res.status);
  const rows = await res.json();
  const refs = new Map();
  for (const r of rows) {
    const m = String(r.offer_subject || r.normalized_subject || '').match(/\b(?:DIS|GBT|SP|KG)[- ]?[0-9][0-9-]+[A-Z]*/i);
    const ref = m ? m[0].toUpperCase().replace(/\s/g, '') : null;
    if (ref && !refs.has(ref)) refs.set(ref, r.reply_at);
  }
  return refs;
}

(async () => {
  const [a0, a1] = process.argv.slice(2);
  const wantBook = process.argv.includes('--book');
  const flagVal = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  if (!a0) die('usage: status.js <ref> [--book] | status.js sweep [days] [--book]');
  const tok = await getToken();

  if (a0 === 'unread') {
    // THE READ PASS — the whole point of Winston is FULL context: he READS
    // every message, in full, not previews. This walks every open book deal,
    // finds messages he has never read (tracked in memory/seen.json), and
    // prints their FULL BODIES oldest-first, grouped by deal. `--mark` records
    // them as read. Run every patrol: nothing on the desk stays unread.
    const limit = parseInt(flagVal('--limit'), 10) || 40;
    const mark = process.argv.includes('--mark');
    const seenFile = path.join(process.cwd(), 'memory', 'seen.json');
    let seen = {}; try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch { /* first run */ }
    const bookFile = process.env.WINSTON_BOOK || path.join(process.cwd(), 'memory', 'book.json');
    let book = {}; try { book = JSON.parse(fs.readFileSync(bookFile, 'utf8')); } catch { die('no book at ' + bookFile); }
    const open = Object.entries(book.deals || {}).filter(([, d]) => !d.closed).map(([r]) => r);

    const queue = [];
    for (const ref of open) {
      const link = await supplierLink(ref);
      const d = await readDeal(ref, tok, link);
      for (const side of ['sell', 'buy']) for (const m of d[side]) {
        if (m.id && !seen[m.id]) queue.push({ ref, side, ...m });
      }
    }
    queue.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
    const batch = queue.slice(0, limit);
    console.log(`# UNREAD — ${queue.length} messages never read${queue.length > limit ? ` (showing oldest ${limit}; rerun for the rest)` : ''}\n`);
    for (const m of batch) {
      let body = '';
      try {
        const j = await graph(`/users/${m.mb}/messages/${m.id}?$select=body`, tok);
        body = (j.body && j.body.content || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
        // cut quoted history — the NEW content is what matters
        body = body.split(/From:\s|-----Original|On .{10,40} wrote:/)[0].trim().slice(0, 1600);
      } catch (e) { body = `(body fetch failed: ${e.message.slice(0, 80)})`; }
      console.log(`═══ ${m.ref} [${m.side.toUpperCase()}] ${day(m.ts)} · ${m.us ? 'US' : 'THEM'} · ${m.from}`);
      console.log(`    ${m.subject}`);
      console.log(body.split('\n').map((l) => '    ' + l).join('\n') + '\n');
      // READING WRITES: a decisive accept/drop from THE COUNTERPARTY becomes a
      // sticky book signal — persisted so the next patrol/brief can't forget it
      // (the Militia scar). Only on the real patrol pass (--mark), only on THEIR
      // messages, checking subject + full body. Never auto-closes.
      if (mark && !m.us) {
        const sig = readSignal(`${m.subject} ${body}`);
        if (sig) {
          try {
            execFileSync('node', [path.join(__dirname, 'book.js'), 'signal', m.ref,
              '--kind', sig.kind, '--phrase', sig.phrase.slice(0, 60),
              '--when', m.ts || new Date().toISOString(), '--from', (m.from || '').split('@')[0]],
              { cwd: process.cwd(), stdio: 'inherit' });
          } catch (e) { console.log(`    (signal write failed: ${(e.message || '').slice(0, 70)})`); }
        }
      }
      if (mark) seen[m.id] = m.ts || new Date().toISOString();
    }
    if (mark) { fs.mkdirSync(path.dirname(seenFile), { recursive: true }); fs.writeFileSync(seenFile, JSON.stringify(seen)); console.log(`# marked ${batch.length} read · ${queue.length - batch.length} remaining`); }
    return;
  }

  if (a0 === 'fresh') {
    // THE UNANSWERED LIST as one deterministic command — never hand-built.
    // Walks every open book deal, re-derives its card from the real threads,
    // prints ONE line per NOT-REPLIED ping, oldest first. No transcription step
    // for Winston to fumble: this output IS the list.
    const bookFile = process.env.WINSTON_BOOK || path.join(process.cwd(), 'memory', 'book.json');
    let book = {}; try { book = JSON.parse(fs.readFileSync(bookFile, 'utf8')); } catch { die('no book at ' + bookFile); }
    const open = Object.entries(book.deals || {}).filter(([, d]) => !d.closed).map(([r]) => r);
    const rows = [];
    for (const ref of open) {
      const link = await supplierLink(ref);
      const d = await readDeal(ref, tok, link);
      if (!d.msgs.length) continue;
      const S = sideState(d.sell);
      if (S.state === 'none' || !(S.theirs > 0 && S.oursAfterPing === 0)) continue; // answered → not fresh
      // product · qty from the blast subject ("DIS-x · Product · N pieces")
      const subj = (d.sell.map((m) => m.subject).find((s) => /·.*·/.test(s)) || '').replace(/^\s*(re|fw|fwd):\s*/i, '');
      const pm = subj.match(/·\s*([^·]+?)\s*·\s*([\d,]+)\s*(?:pieces|pcs|prs)/i);
      const buyer = (S.who || '?').replace(/\s+is interested.*/i, '').replace(/^[^A-ZÀ-ÿ]*/, '');
      rows.push({ ref, ts: S.lastTheirs.ts, product: pm ? pm[1] : subj.slice(0, 40), qty: pm ? pm[2] : '?', buyer, price: S.lastPrice && S.lastPrice.from === 'them' ? S.lastPrice.vals[0] : '' });
    }
    rows.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
    console.log(`# FRESH (unanswered buyer pings) — ${rows.length}`);
    for (const r of rows) {
      console.log(`${day(r.ts)} (${fmtAge(r.ts)}) — ${r.ref} · ${r.product} ${r.qty} · ${r.buyer}${r.price ? ' · their ' + r.price : ''}`);
    }
    return;
  }

  if (a0 === 'refresh') {
    // Re-derive the card for every OPEN deal already in the book — this is how
    // existing deals stay current (our replies / factory moves don't create new
    // birth events, so a window sweep alone would miss them).
    const bookFile = process.env.WINSTON_BOOK || path.join(process.cwd(), 'memory', 'book.json');
    let book = {}; try { book = JSON.parse(fs.readFileSync(bookFile, 'utf8')); } catch { die('no book at ' + bookFile); }
    const open = Object.entries(book.deals || {}).filter(([, d]) => !d.closed).map(([r]) => r);
    console.log(`# REFRESH — ${open.length} open deals in the book\n`);
    let unanswered = 0, ballUs = 0, ballThem = 0, unverified = 0;
    for (const ref of open) {
      const link = await supplierLink(ref);
      // reader resilience: a single ETIMEDOUT to Graph must NOT crash the pass
      // or silently pass off stale book state as current. Flag it UNVERIFIED and
      // move on — the scar where a reader outage made Winston chase a deal Sohan
      // had already handled (DIS-26-3868, 2026-07-22).
      let d;
      try { d = await readDeal(ref, tok, link); }
      catch (e) { console.log(`═══ ${ref} — ⚠️ READER FAILED (${(e.message || '').slice(0, 44)}) — book state is STALE/UNVERIFIED, do not chase off it\n`); unverified++; continue; }
      if (!d.msgs.length) { console.log(`═══ ${ref} — no messages found (check the ref)\n`); continue; }
      const { text, S, B } = card(ref, d, link);
      console.log(text + '\n');
      if (S.state !== 'none' && S.theirs > 0 && S.oursAfterPing === 0) unanswered++;
      else if (S.state === 'ball-us') ballUs++;
      else if (S.state === 'ball-them') ballThem++;
      toBook(ref, d, S, B, link);
    }
    console.log(`# TOTALS: ${open.length} open · ❌ unanswered ${unanswered} · ball-US ${ballUs} · ball-them ${ballThem}${unverified ? ` · ⚠️ UNVERIFIED ${unverified} (reader timed out — stale, don't trust)` : ''}`);
    return;
  }

  if (a0 === 'desk') {
    // ── THE LIVE SYSTEM BOARD ────────────────────────────────────────────────
    // Every ball, age and price is DERIVED FROM THE ACTUAL THREADS on every run
    // — never a stored or hand-typed value. book.json is demoted to two things:
    // the REGISTRY (which refs are live deals) and the OVERLAY (judgment that
    // isn't in the threads: signals, notes, "Sohan said hold", close/outcome).
    // This is the fix for stale "ball on us" — you can no longer be told to chase
    // what Joyce already sent, because the ball is re-read live from her email.
    const LC = require('./lifecycle');
    const bookFile = process.env.WINSTON_BOOK || path.join(process.cwd(), 'memory', 'book.json');
    let book = {}; try { book = JSON.parse(fs.readFileSync(bookFile, 'utf8')); } catch { die('no book at ' + bookFile); }
    const only = (a1 && /^(DIS|GBT|SP|KG)/i.test(a1)) ? a1.toUpperCase() : null; // desk <ref> = one deal through the live board
    const limit = parseInt(a1, 10) || 0;                                          // desk <N> = cap the sweep
    let open = Object.entries(book.deals || {}).filter(([, d]) => !d.closed);
    if (only) open = open.filter(([r]) => r.toUpperCase() === only);
    else if (limit) open = open.slice(0, limit);
    const nameOf = (s) => (s || '?').replace(/\s+is interested.*/i, '').replace(/^[^A-Za-zÀ-ÿ]*/, '').replace(/^(pieces|pcs|prs|pairs|the|for|units?)\s+/i, '').slice(0, 22);
    const rows = (await mapPool(open, 6, async ([ref, ov]) => {
      const link = await supplierLink(ref);
      const d = await readDeal(ref, tok, link);
      const sig = ov.signal && !ov.signal.resolved ? ov.signal : null;
      if (!d.msgs.length) return { ref, ov, sig, tier: 'unread', ball: '?', silentH: 0, next: 'no thread found — check ref', line: true };
      const S = sideState(d.sell), B = sideState(d.buy);
      // LIVE ball derivation with the TWO-LEG BLOCKER rule. A buyer ping is only
      // OURS to answer if we can actually price it — i.e. the BUY leg is settled.
      // If we're still waiting on the supplier, the buyer waits downstream and the
      // real move is the supplier leg (this is what stops "reply Lecia" when the
      // block is Cherry). Read live, never stored.
      let ball, since, next, clockSide, fresh = false;
      const buyer = nameOf(S.who), sup = B.who || (link.name || 'supplier');
      const sellUnanswered = S.state !== 'none' && S.theirs > 0 && S.oursAfterPing === 0;
      // "Will send you today" from THEM = a PROMISE — the ball STAYS on them
      // (they owe the promised thing); timestamps alone would flip it to us.
      const PROMISE_RE = /\b(will\s+(send|check|get\s+back|revert|confirm|update|let\s+you\s+know)|let\s+me\s+check|checking\s+with|i'?ll\s+(send|check|confirm|revert|get\s+back))\b/i;
      const bPromise = B.state === 'ball-us' && B.last && PROMISE_RE.test(B.last.text || '');
      const sPromise = S.state === 'ball-us' && S.last && PROMISE_RE.test(S.last.text || '');
      const buyWaiting = (B.state === 'ball-them' && B.ours > 0) || bPromise;
      const havePrice = !!((B.cls && B.cls.confirmed) || link.price || ov.buy); // a CONFIRMED cost to quote with
      // AMMUNITION rule (Sohan): a supplier's last message that CARRIES a price
      // is not a debt to answer — it's the cost to work the sell side with. Don't
      // lock the supplier until the buyer confirms.
      const bAmmo = B.state === 'ball-us' && B.cls && B.cls.confirmed && B.last && B.cls.confirmed.when >= B.last.ts;
      if (B.state === 'ball-us' && !bPromise && !bAmmo) { ball = 'us'; clockSide = 'supplier'; since = B.last.ts; next = `ANSWER ${sup} — they replied, we owe`; }
      else if (buyWaiting) { ball = 'supplier'; clockSide = 'supplier'; since = B.last.ts; next = bPromise ? `${sup} promised ("will send") — hold them to it` : `waiting on ${sup}${sellUnanswered ? ` — ${buyer} waits on this` : ''}`; }
      else if (sellUnanswered) { ball = 'us'; clockSide = 'buyer'; fresh = true; since = S.lastTheirs.ts; next = havePrice ? `REPLY ${buyer} — pinged, unanswered` : `SOURCE a cost, then quote ${buyer} — pinged, unanswered`; }
      else if (S.state === 'ball-us' && !sPromise) { ball = 'us'; clockSide = 'buyer'; since = S.last.ts; next = `MOVE on ${buyer}`; }
      else if (S.state === 'ball-them' || sPromise) { ball = 'buyer'; clockSide = 'buyer'; since = S.last.ts; next = sPromise ? `${buyer} promised ("will revert") — hold them to it` : `waiting on ${buyer}`; }
      else { ball = 'us'; clockSide = 'buyer'; since = (d.msgs[d.msgs.length - 1] || {}).ts; next = 'review thread'; }
      // silence in WORKING hours on the relevant side's calendar (weekend-aware)
      const silentH = workingSilentH(since, clockSide);
      // tier from LIVE silence, canonical thresholds (lifecycle.js — one source)
      let tier;
      if (ball === 'us') tier = silentH <= LC.HOT_MAX_H ? 'hot' : (silentH >= LC.DORMANT_MIN_H ? 'dormant' : silentH >= LC.COLD_MIN_H ? 'cold' : 'aging');
      else { const t = ball === 'supplier' ? LC.WAIT_SUP_H : LC.WAIT_CUST_H; tier = silentH >= LC.DORMANT_MIN_H ? 'dormant' : silentH >= LC.COLD_MIN_H ? 'cold' : (silentH <= t ? 'waiting' : 'chase_due'); }
      // waiting-but-overdue → the move is a chase on the SAME thread
      if (tier === 'chase_due') next = `CHASE ${ball === 'supplier' ? sup : buyer} — silent ${fmtWD(silentH)} (working) on our last`;
      // CONFIRMED numbers only (Sohan's model: their number, never our unanswered ask)
      const bc = (B.cls && B.cls.confirmed) || null, scf = (S.cls && S.cls.confirmed) || null;
      const buyP = bc ? fmtP(bc) : (link.price ? ('$' + link.price + (/\//.test(link.price) ? ' split' : '')) : (ov.buy ? '$' + ov.buy : null));
      const sellP = scf ? fmtP(scf) : (ov.sell ? '$' + ov.sell : null);
      const askP = (S.cls && S.cls.ourAsk && S.cls.ourAsk.pending) ? fmtP(S.cls.ourAsk) : null;
      // spread only when both legs are confirmed, same currency, and positive —
      // never across R/$ (FX parked), never off a pending ask, no fake precision.
      const b = bc ? bc.val : (link.priceNum || parseFloat(ov.buy || '') || null);
      const s = scf ? scf.val : null;
      const sameCur = bc && scf ? (bc.cur === scf.cur || bc.cur === '?' || scf.cur === '?') : true;
      const q = parseFloat(ov.qty || '');
      const spread = (b && s && q && sameCur && s > b) ? Math.round((s - b) * q) : null;
      // margin flags (20% target / 15% floor on cost) + shape-aware moves
      const mg = marginFlag(bc || (b ? { val: b, cur: '?' } : null), scf);
      if (ball === 'us' && mg && mg.flag === '⛔') next = `SQUEEZE ${sup} down / push ${buyer} up — buyer ${sellP} UNDER cost ${buyP}`;
      else if (ball === 'us' && sellUnanswered && b && (!mg || mg.flag !== '⛔')) next = `QUOTE ${buyer} ~$${(Math.ceil(b * 120) / 100).toFixed(2)} (cost ${buyP} +20%)`;
      // write the derived state back as a reader-down FALLBACK only (display is always live)
      const dd = book.deals[ref]; if (dd) { dd.ball = ball === 'buyer' ? 'buyer' : ball; dd.since = since; dd.derived_at = new Date().toISOString(); }
      // DETERMINISTIC BUCKET (Sohan's "what's open" categories) — pure from state
      let bucket;
      if (ov.needsYou) bucket = 'needs_you';
      else if ((sig && sig.kind === 'accept') || ov.toRaise) bucket = 'to_raise'; // real agreement only, not a stale stage flag
      else if (tier === 'cold' || tier === 'dormant') bucket = 'stale';
      else if (ball === 'us') bucket = fresh ? 'needs_response' : 'followup';
      else bucket = tier === 'chase_due' ? 'chase' : 'waiting';
      const flav = (mg && mg.flag === '⛔') ? '⛔' : (fresh && !havePrice) ? '🔍' : '';
      const sortKey = spread != null ? spread : (parseFloat(String(ov.qty || '').replace(/[^0-9.]/g, '')) || 0);
      return { ref, ov, sig, tier, ball, silentH, next, buyP, sellP, askP, spread, mg, bucket, flav, sortKey, supCode: d.supplierCode || null, supEmail: link.email || (B.who && /@/.test(B.who) ? B.who : null), product: ov.product || '', qty: ov.qty || '' };
    })).filter(Boolean);
    try { fs.writeFileSync(bookFile, JSON.stringify(book, null, 2)); } catch { /* cache best-effort */ }
    const nSig = rows.filter((r) => r.sig).length;

    // ── DETAIL view: `desk <ref>` → the full two-line read for one deal ─────────
    if (only) {
      for (const r of rows) {
        const money = `${r.spread ? ` ($${r.spread.toLocaleString()})` : ''}${r.mg ? ` ${r.mg.flag}${r.mg.pct}%` : ''}`;
        const px = (r.buyP || r.sellP || r.askP) ? `  [cost ${r.buyP || 'none'} · buyer ${r.sellP || 'open'}${r.askP ? ' · our ask ' + r.askP + ' pending' : ''}]` : '';
        console.log(`${(LC.LC_TAG[r.tier] || r.tier)} ball=${r.ball} ${fmtWD(r.silentH)}  ${r.ref} · ${r.product} ${r.qty}${money}`);
        console.log(`   → ${r.next}${px}${r.supCode ? `  ·  supplier ${r.supCode}${r.supEmail ? ' ' + r.supEmail : ''}` : ''}`);
      }
      return;
    }

    // ── LIST view: `desk` → the 7-bucket "what's open", ONE line per deal ───────
    const BUCKETS = [
      ['needs_you', '🙋 NEEDS YOU — a call only you can make'],
      ['to_raise', '💰 TO RAISE — agreed, order pending'],
      ['needs_response', '🆕 NEEDS OUR RESPONSE — buyer asked, never answered'],
      ['followup', '🔄 FOLLOW-UP — ball on us'],
      ['chase', '⏰ CHASE — ball on them, past the window'],
      ['waiting', '⏳ WAITING — ball on them, still in window'],
      ['stale', '🪦 STALE — long silence'],
    ];
    console.log(`# WHAT'S OPEN — ${rows.length} live deals · every ball read LIVE (${day(new Date().toISOString())})`);
    for (const [key, label] of BUCKETS) {
      const rs = rows.filter((r) => r.bucket === key).sort((a, x) => (x.sortKey - a.sortKey) || (x.silentH - a.silentH));
      if (!rs.length) continue;
      console.log(`\n${label} — ${rs.length}`);
      for (const r of rs) {
        const money = `${r.spread ? ` $${(r.spread / 1000).toFixed(1)}k` : ''}${r.mg ? ` ${r.mg.flag}${r.mg.pct}%` : ''}`;
        const clk = ['chase', 'waiting'].includes(key) || key === 'followup' ? ` · ${fmtWD(r.silentH)}` : '';
        const sup = r.supCode ? ` · sup ${r.supCode}` : '';
        console.log(`  ${r.flav}${r.ref} · ${(r.product || '?').slice(0, 24)}${r.qty ? ' ' + r.qty : ''}${money}${clk} — ${r.next.replace(/@grandempirehk\.com|@gbestgarment\.com|@stockpapa\.cn/g, '').slice(0, 60)}${sup}`);
      }
    }
    console.log(`\n# ${BUCKETS.map(([k, l]) => `${l.split(' ')[0]}${rows.filter((r) => r.bucket === k).length}`).join(' · ')}`);
    return;
  }

  if (a0 === 'sweep') {
    const days = parseInt(a1, 10) || 14;
    const refs = await births(days);
    console.log(`# SWEEP — ${refs.size} deals born (buyer pings) in last ${days}d\n`);
    let unanswered = 0, ballUs = 0, ballThem = 0;
    for (const [ref] of refs) {
      const link = await supplierLink(ref);
      const d = await readDeal(ref, tok, link);
      const { text, S, B } = card(ref, d, link);
      console.log(text + '\n');
      if (S.state !== 'none' && S.theirs > 0 && S.oursAfterPing === 0) unanswered++;
      else if (S.state === 'ball-us') ballUs++;
      else if (S.state === 'ball-them') ballThem++;
      if (wantBook) toBook(ref, d, S, B, link);
    }
    console.log(`# TOTALS: ${refs.size} born · ❌ unanswered ${unanswered} · ball-US ${ballUs} · ball-them ${ballThem}`);
    return;
  }

  const link1 = await supplierLink(a0.toUpperCase());
  const d = await readDeal(a0.toUpperCase(), tok, link1);
  if (!d.msgs.length) die(`no messages found for "${a0}" in any box`);
  const { text, S, B } = card(a0.toUpperCase(), d, link1);
  console.log(text);
  if (wantBook) toBook(a0.toUpperCase(), d, S, B, link1);
})().catch((e) => die(e.message));
