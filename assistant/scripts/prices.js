'use strict';

/**
 * prices.js — CONFIRMED vs ASK price classification (Sohan's model, verbatim).
 *
 * The rule (2026-07-22 walkthrough):
 *   - CONFIRMED = a number the COUNTERPARTY stated (their offer / their target).
 *   - ASK       = a number WE floated ("can you do $8?", "clear at $11.50?").
 *     An ask is PENDING until they reply; if they reply agreeing without a new
 *     number, the ask BECOMES the confirmed price. If they never reply, the
 *     last confirmed stays THEIR number.
 *   Examples: supplier offers $10, we ask $8, silence → confirmed $10.
 *             buyer target $9.50, we ask $11.50, silence → confirmed $9.50.
 *
 * Currencies: USD ($, US$, USD) and ZAR (R92). FX is PARKED — never convert,
 * show what was said. Bare numbers only when keyword-gated ("offer 45.00").
 *
 * Pure module: no I/O, unit-testable. `node prices.js` runs the self-test.
 */

// cut quoted history — a reply quoting our old "$2.50" must not read as new
function stripQuoted(text) {
  return String(text || '').split(/(?:^|\n)\s*(?:From:\s|-----Original|On .{5,60} wrote:|_{10,})/)[0];
}

// price mentions, in order of appearance: {val, cur, raw}
const SANE_MAX = 500; // per-piece stock prices; kills totals like $29,242 and qtys
function extractPrices(text) {
  const t = stripQuoted(text);
  const out = [];
  const push = (val, cur, raw, idx) => {
    const v = parseFloat(val);
    if (v > 0 && v <= SANE_MAX) out.push({ val: v, cur, raw: raw.trim(), idx });
  };
  let m;
  const usd = /(?:USD|US\$|\$)\s?(\d+(?:\.\d{1,2})?)(?![\d,])/gi;       // $1.50, USD 2.00 — not $29,242 totals
  while ((m = usd.exec(t))) push(m[1], 'USD', m[0], m.index);
  const zar = /\bR\s?(\d+(?:\.\d{1,2})?)\b/g;                           // R92, R 45.00 (case-sensitive R)
  while ((m = zar.exec(t))) push(m[1], 'ZAR', m[0], m.index);
  const perpc = /(?<![\d.$])(\d{1,3}(?:\.\d{1,2})?)\s*\/\s*(?:pc|pcs|piece|pair|prs|pr|unit)\b/gi; // 1.50/pc
  while ((m = perpc.exec(t))) push(m[1], '?', m[0], m.index);
  const bare = /\b(?:offer(?:ed)?|target|best(?:\s+is)?|pay|price(?:\s+is)?|at|take\s+all\s+for)\D{0,10}?(\d{1,3}\.\d{1,2})\b(?!\s*%)/gi; // "offered 45.00"
  while ((m = bare.exec(t))) push(m[1], '?', m[0], m.index);
  // de-dupe near-position same-value captures ("$1.50/pc" hits usd AND perpc;
  // "best is $2.50" hits usd AND the keyword-gated bare) — keep the known currency
  const merged = [];
  for (const p of out.sort((a, b) => a.idx - b.idx)) {
    const dup = merged.find((q) => q.val === p.val && Math.abs(q.idx - p.idx) < 30);
    if (!dup) { merged.push(p); continue; }
    if (dup.cur === '?' && p.cur !== '?') { dup.cur = p.cur; dup.raw = p.raw; }
  }
  return merged;
}

const AGREE_RE = /\b(ok(?:ay)?|yes|confirm(?:ed)?|agree(?:d)?|deal|accept(?:ed)?|fine|works|go ahead)\b/i;

// a counterparty message can carry TWO prices — theirs and ours quoted back
// ("Best is $2.50 that I want to pay … your offer $2.80"). THEIR number is the
// one anchored to commitment words; without an anchor, fall back to the last.
const INTENT_RE = /\b(best|pay|target|take|i can(?:\s+do)?|we can(?:\s+do)?|want(?:\s+to\s+pay)?|my price|our price|for all)\b/gi;
function pickTheirs(text, ps) {
  if (!ps.length) return null;
  if (ps.length === 1) return ps[0];
  const kws = []; let m; INTENT_RE.lastIndex = 0;
  while ((m = INTENT_RE.exec(text))) kws.push(m.index);
  if (!kws.length) return ps[ps.length - 1];
  return ps.reduce((best, p) => {
    const d = Math.min(...kws.map((k) => Math.abs(p.idx - k)));
    return !best || d < best.d ? { p, d } : best;
  }, null).p;
}

/**
 * classify one side's messages (asc by ts; each: {us, ts, text, counterparty?})
 * → { confirmed: {val,cur,when,by,viaAgreedAsk?}, ourAsk: {val,cur,when,pending} }
 */
function classify(msgs) {
  let confirmed = null, ourAsk = null;
  for (const m of msgs || []) {
    const text = stripQuoted(m.text || '');
    const ps = extractPrices(text);
    const last = ps[ps.length - 1];
    if (m.us) {
      if (last) ourAsk = { val: last.val, cur: last.cur, when: m.ts, pending: true };
    } else {
      const theirs = pickTheirs(text, ps);
      if (theirs) {
        confirmed = { val: theirs.val, cur: theirs.cur, when: m.ts, by: m.counterparty || '' };
        if (ourAsk) ourAsk.pending = false; // they moved past our ask with their own number
      } else if (ourAsk && ourAsk.pending && AGREE_RE.test(text)) {
        // they agreed to OUR ask without restating a number → ask becomes confirmed
        confirmed = { val: ourAsk.val, cur: ourAsk.cur, when: m.ts, by: m.counterparty || '', viaAgreedAsk: true };
        ourAsk.pending = false;
      } else if (ourAsk) {
        ourAsk.pending = false; // they replied (no number, no clear agree) — ask no longer hanging
      }
    }
  }
  return { confirmed, ourAsk };
}

const fmtP = (p) => p == null ? null : `${p.cur === 'ZAR' ? 'R' : p.cur === 'USD' ? '$' : '~'}${p.val}`;

// Sohan's margin rule: (sell − cost)/cost. Target 20%, floor 15%.
// Only computed across same/unknown currency — never R vs $ (FX parked).
function marginFlag(cost, sell) {
  if (!cost || !sell || !cost.val || !sell.val) return null;
  if (cost.cur !== sell.cur && cost.cur !== '?' && sell.cur !== '?') return null;
  const pct = Math.round(((sell.val - cost.val) / cost.val) * 100);
  if (pct > 200) return null; // >200% margin = a mis-parsed number, not a real deal — don't flag
  const flag = sell.val <= cost.val ? '⛔' : pct >= 20 ? '🟢' : pct >= 15 ? '🟡' : '🔴';
  return { pct, flag };
}

// exact-ref boundary match — DIS-26-3334 must NOT match inside DIS-26-33344
function refMatches(text, ref) {
  const esc = String(ref).toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(esc + '(?![0-9])', 'i').test(String(text || ''));
}

// ── DIS ↔ supplier-code reverse map, via the shared numeric core ──────────────
// The relay mints DIS-26-3964 from Gbest's GBT26-3964 (and SP10753-WL ↔
// DIS-10753-WL). Strip the vendor prefix → the remainder is the JOIN KEY.
const CODE_RE = /\b(DIS|GBT|SP|KG|SPR)[- ]?(\d{2,}(?:-\d+)*(?:-[A-Z]{1,4})?)/gi;
function core(ref) {
  return String(ref || '').toUpperCase().replace(/^(DIS|GBT|SP|KG|SPR)[- ]?/, '').replace(/[^0-9A-Z]/g, '');
}
function sameCore(a, b) { const x = core(a); return !!x && x === core(b); }
// the searchable suffix (with its dash) — appears in BOTH DIS and supplier subjects
function disSuffix(ref) { return String(ref || '').toUpperCase().replace(/^DIS[- ]?/, ''); }
// pull a supplier code (GBT/SP/KG…, NOT DIS) out of a subject line, same-core only
function supplierCodeIn(text, ref) {
  let m; CODE_RE.lastIndex = 0;
  while ((m = CODE_RE.exec(String(text || '')))) {
    const code = (m[1] + m[2]).toUpperCase();
    if (/^DIS/.test(code)) continue;
    if (!ref || sameCore(code, ref)) return code.replace(/^(GBT|SP|KG|SPR)/, '$1'); // normalize spacing only
  }
  return null;
}

module.exports = { stripQuoted, extractPrices, classify, refMatches, core, sameCore, disSuffix, supplierCodeIn, fmtP, marginFlag, AGREE_RE };

// ── self-test on the walked deals ────────────────────────────────────────────
if (require.main === module) {
  const T = (name, got, want) => console.log(`${JSON.stringify(got) === JSON.stringify(want) ? '✓' : '✗ FAIL'} ${name}: ${JSON.stringify(got)}${JSON.stringify(got) !== JSON.stringify(want) ? ' ≠ ' + JSON.stringify(want) : ''}`);

  // sweater DIS-26-3868 BUY: Cherry offers $1.50, no ask after → confirmed $1.50, no pending ask
  let r = classify([
    { us: true, ts: '1', text: 'Hi Cherry can you give best price for the sweaters' },
    { us: false, ts: '2', text: 'Dear Joyce $1.50/pc for all.Pls check Best Regards', counterparty: 'Cherry' },
  ]);
  T('sweater BUY confirmed', [r.confirmed.val, r.confirmed.cur], [1.5, 'USD']);
  T('sweater BUY no pending ask', !!(r.ourAsk && r.ourAsk.pending), false);

  // sweater SELL: Nomndeni offered 45.00 (bare, keyword), we ask $1.80, silence → confirmed 45, ask pending
  r = classify([
    { us: false, ts: '1', text: 'we can offer 45.00 for these', counterparty: 'Nomndeni' },
    { us: true, ts: '2', text: 'Hi Nomndeni we can do $1.80/pc clear all, please let us know' },
  ]);
  T('sweater SELL confirmed = their 45', r.confirmed.val, 45);
  T('sweater SELL our ask pending', [r.ourAsk.val, r.ourAsk.pending], [1.8, true]);

  // Sohan's canonical: supplier $10, we ask $8, silence → confirmed $10, ask pending
  r = classify([
    { us: false, ts: '1', text: 'our price is $10', counterparty: 'sup' },
    { us: true, ts: '2', text: 'can you do $8?' },
  ]);
  T('canonical supplier', [r.confirmed.val, r.ourAsk.val, r.ourAsk.pending], [10, 8, true]);

  // agreed ask: we ask $1.80, she says "ok that works" → confirmed $1.80 viaAgreedAsk
  r = classify([
    { us: false, ts: '1', text: 'target is $1.60', counterparty: 'Lecia' },
    { us: true, ts: '2', text: 'can we meet at $1.80?' },
    { us: false, ts: '3', text: 'ok that works for us', counterparty: 'Lecia' },
  ]);
  T('agreed ask → confirmed', [r.confirmed.val, !!r.confirmed.viaAgreedAsk], [1.8, true]);

  // vest: Lecia "Best is $ 2.50 that I want to pay" → confirmed 2.50
  r = classify([{ us: false, ts: '1', text: 'Best is $ 2.50 that I want to pay – what is the price? Can take all', counterparty: 'Lecia' }]);
  T('vest buyer firm', [r.confirmed.val, r.confirmed.cur], [2.5, 'USD']);

  // two prices in THEIR message — theirs is the intent-anchored one, not our quoted-back $2.80
  r = classify([{ us: false, ts: '1', text: 'Best is $ 2.50 that I want to pay – your offer says $2.80, what is the price?', counterparty: 'Lecia' }]);
  T('intent-anchored pick', r.confirmed.val, 2.5);

  // hoody: her "CAN TAKE them all at $1.64" beats the forward footer's listed $2.50
  r = classify([{ us: false, ts: '1', text: 'Lecia is interested. They said: "CAN TAKE them all at $ 1.64" Offer listed at $2.50 clear-all', counterparty: 'Lecia' }]);
  T('take-anchored beats footer', r.confirmed.val, 1.64);

  // R92 Parker lock (rand)
  T('R92 extract', extractPrices('Parker confirmed R92 per pc')[0].cur, 'ZAR');

  // junk immunity: totals + qty + quoted history
  T('total excluded', extractPrices('gap is $29,242 on the lot').length, 0);
  T('qty excluded', extractPrices('7500 pieces available').length, 0);
  T('quoted history cut', extractPrices('sounds good\nFrom: Joyce\nwe offered $2.50').length, 0);

  // ref boundary
  T('ref no-collision', refMatches('DIS-26-33344 · LADY\'S TOP', 'DIS-26-3334'), false);
  T('ref exact hit', refMatches('RE: DIS-26-3334 · LADY\'S PANTS', 'DIS-26-3334'), true);
  T('ref suffix ok', refMatches('DIS-80549-LLJ quilted', 'DIS-80549-LLJ'), true);

  // reverse map — the shared core
  T('core DIS==GBT', sameCore('DIS-26-3964', 'GBT26-3964'), true);
  T('core DIS==SP', sameCore('DIS-10753-WL', 'SP10753-WL'), true);
  T('core different', sameCore('DIS-26-3964', 'GBT26-3334'), false);
  T('core no 33344 bleed', sameCore('DIS-26-3334', 'GBT26-33344'), false);
  T('suffix searchable', disSuffix('DIS-26-3964'), '26-3964');
  T('supplier code extract', supplierCodeIn("GBT26-3964MEN'S PADDED VEST", 'DIS-26-3964'), 'GBT26-3964');
  T('supplier code SP', supplierCodeIn('Attached SP10753-WL kids shoes', 'DIS-10753-WL'), 'SP10753-WL');
  T('supplier code rejects DIS', supplierCodeIn('DIS-26-3964 offer', 'DIS-26-3964'), null);
  T('supplier code rejects wrong-core', supplierCodeIn('GBT26-9999 other', 'DIS-26-3964'), null);
}
