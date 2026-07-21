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
// surface $ prices (and bare x.xx after USD) from text, order preserved
const prices = (t) => (String(t).match(/(?:US?\$|USD\s?)\s?\d+(?:\.\d+)?|\$\s?\d+(?:\.\d+)?/gi) || []).map((s) => s.replace(/\s+/g, ''));

function die(m) { console.error('status.js: ' + m); process.exit(1); }

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
    link.price = (os_.find((r) => r.supplier_price) || {}).supplier_price || null;
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
  const terms = [ref];
  // the factory thread lives under the SUPPLIER's ref — search it too
  if (link.style && link.style.toUpperCase() !== ref.toUpperCase()) terms.push(link.style);
  for (const [key, mb] of Object.entries(BOXES)) {
    for (const t of terms) {
      const j = await graph(`/users/${mb}/messages?$search=${encodeURIComponent('"' + t + '"')}&$select=subject,from,toRecipients,receivedDateTime,bodyPreview&$top=50`, tok);
      for (const m of j.value || []) rows.push({ box: key, viaSupplierRef: t !== ref, ...m });
    }
  }
  // de-dupe (same message can appear via CC in two boxes) by date+subject
  const seen = new Set();
  const msgs = rows.filter((m) => {
    const k = `${(m.receivedDateTime || '').slice(0, 16)}|${(m.subject || '').slice(0, 60)}|${m.from?.emailAddress?.address || ''}`;
    if (seen.has(k)) return false; seen.add(k); return true;
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
    side.push({
      ts: m.receivedDateTime, from, us, counterparty,
      subject: m.subject || '', preview: (m.bodyPreview || '').replace(/\s+/g, ' ').slice(0, 200),
    });
  }
  return { msgs, sell, buy };
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
  };
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
    if (S.lastPrice) out.push(`      last price seen: ${S.lastPrice.vals.join(' ')} (${S.lastPrice.from}, ${S.lastPrice.when})`);
    out.push(`      last msg: "${S.last.preview.slice(0, 110)}"`);
  }
  // BUY side — the hinge is negotiation
  if (B.state === 'none') {
    // no factory thread — but the relay may still know the supplier + list price
    if (link.price || link.name) out.push(`BUY:  no negotiation — supplier ${link.name || '?'}${link.style ? ` (${link.style})` : ''}, their list price: ${link.price || 'no price on record'}`);
    else out.push(`BUY:  no factory contact for this ref — no negotiation, no price on record`);
  } else {
    const sup = B.who || '?';
    if (B.ours === 0) out.push(`BUY:  offer only from ${sup} — no negotiation started${B.lastPrice ? `; their list price: ${B.lastPrice.vals.join(' ')} (${B.lastPrice.when})` : '; no price found'}`);
    else out.push(`BUY:  negotiating with ${sup} — last move ${day(B.last.ts)} (${fmtAge(B.last.ts)}) by ${B.last.us ? 'US' : 'them'} → ball = ${B.state === 'ball-us' ? 'US' : 'them'}${B.lastPrice ? `; most recent price: ${B.lastPrice.vals.join(' ')} (${B.lastPrice.from}, ${B.lastPrice.when})` : ''}`);
    if (B.state !== 'none') out.push(`      last msg: "${B.last.preview.slice(0, 110)}"`);
  }
  return { text: out.join('\n'), S, B };
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
  if (!a0) die('usage: status.js <ref> [--book] | status.js sweep [days] [--book]');
  const tok = await getToken();

  if (a0 === 'refresh') {
    // Re-derive the card for every OPEN deal already in the book — this is how
    // existing deals stay current (our replies / factory moves don't create new
    // birth events, so a window sweep alone would miss them).
    const bookFile = process.env.WINSTON_BOOK || path.join(process.cwd(), 'memory', 'book.json');
    let book = {}; try { book = JSON.parse(fs.readFileSync(bookFile, 'utf8')); } catch { die('no book at ' + bookFile); }
    const open = Object.entries(book.deals || {}).filter(([, d]) => !d.closed).map(([r]) => r);
    console.log(`# REFRESH — ${open.length} open deals in the book\n`);
    let unanswered = 0, ballUs = 0, ballThem = 0;
    for (const ref of open) {
      const link = await supplierLink(ref);
      const d = await readDeal(ref, tok, link);
      if (!d.msgs.length) { console.log(`═══ ${ref} — no messages found (check the ref)\n`); continue; }
      const { text, S, B } = card(ref, d, link);
      console.log(text + '\n');
      if (S.state !== 'none' && S.theirs > 0 && S.oursAfterPing === 0) unanswered++;
      else if (S.state === 'ball-us') ballUs++;
      else if (S.state === 'ball-them') ballThem++;
      toBook(ref, d, S, B, link);
    }
    console.log(`# TOTALS: ${open.length} open · ❌ unanswered ${unanswered} · ball-US ${ballUs} · ball-them ${ballThem}`);
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
