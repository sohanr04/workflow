#!/usr/bin/env node
'use strict';

/**
 * book.js — WINSTON'S OWN deal book. His system, his truth.
 *
 * Winston does NOT read the deals-engine board. He reads the actual email
 * threads (graph.js) and maintains this book himself — using his own judgment
 * to match a message to a deal, set who owes the next move, and record prices.
 * That's more robust than the engine's fuzzy matching, and it's his: one JSON
 * file in his memory, in git-managed logic, no external service to break.
 *
 * Lifecycle is computed from the honest clock HE keeps: `ball` (who owes the
 * move) + `since` (when the ball last moved into that court). No snapshot aged
 * blindly — Winston updates `since` from the real last message each time he
 * reads a thread, so a deal's death is visible, not guessed.
 *
 * Store: profiles/sohan/memory/book.json  (WINSTON_BOOK overrides)
 *
 * Commands (run from profiles/sohan/):
 *   book.js add  <ref> --product "..." --qty 5000 --buyer "Lecia/Choice" --supplier "Cherry/Gbest" \
 *                      --ball us|buyer|supplier --stage quoting --sell 3.20 --buy 2.45 --note "born from DIS blast"
 *   book.js set  <ref> --ball supplier --since now --buy 1.80 --stage negotiating --next "chase Cherry $1.80"
 *   book.js note <ref> "Cherry came back at $2.45"
 *   book.js get  <ref>
 *   book.js today                 # actionable queue from HIS book (hot/aging/chase), fresh first
 *   book.js list [hot|chase|cold|all]
 *   book.js stats                 # health census
 *   book.js close <ref> --outcome won|lost --reason "gap wouldn't close"
 *   book.js sheet [path]          # export the book → Excel (default memory/GE-Deals.xlsx)
 *
 * READING WRITES (the Militia-scar fix):
 *   book.js signal  <ref> --kind accept|drop --phrase "..." --from Joyce --when 2026-07-21
 *                                 # a decisive state-change READ in a body, made STICKY.
 *                                 # Persists until resolved so a patrol/brief can't forget it.
 *                                 # Never auto-closes; auto-books an unbooked ref (confirmed
 *                                 # order that fell out of the book gets tracked on read).
 *   book.js signals               # the "YOUR MOVE" queue — every unresolved state-change
 *   book.js resolve <ref>         # signal handled (acted on / Sohan decided) — clears the flag
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const BOOK = process.env.WINSTON_BOOK || path.join(process.cwd(), 'memory', 'book.json');
const now = () => new Date().toISOString();
const nowMs = () => Date.now();

function load() { try { return JSON.parse(fs.readFileSync(BOOK, 'utf8')); } catch { return { deals: {} }; } }
function save(b) { fs.mkdirSync(path.dirname(BOOK), { recursive: true }); fs.writeFileSync(BOOK, JSON.stringify(b, null, 2)); }
function die(m) { console.error('book.js: ' + m); process.exit(1); }

function flag(args, name) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; }
function tsOf(v) { if (!v) return undefined; if (v === 'now') return now(); const d = new Date(v); return isNaN(d) ? now() : d.toISOString(); }

// ── lifecycle — Winston's honest clock (ball + since), same thresholds as everything ──
const HOT = 72, COLD = 336, DORMANT = 720, WAIT_C = 48, WAIT_S = 24;
function lifecycle(d) {
  if (d.closed) return d.outcome === 'won' ? 'won' : 'dropped';
  const h = (nowMs() - new Date(d.since || d.opened_at || now()).getTime()) / 3_600_000;
  if (h >= DORMANT) return 'dormant';
  if (h >= COLD) return 'cold';
  if (d.ball === 'us') return h <= HOT ? 'hot' : 'aging';
  const t = d.ball === 'supplier' ? WAIT_S : WAIT_C;
  return h <= t ? 'waiting' : 'chase_due';
}
function silentH(d) { return Math.round(((nowMs() - new Date(d.since || d.opened_at || now()).getTime()) / 3_600_000) * 10) / 10; }
const TAG = { hot: '🔥hot', aging: '🟠aging', chase_due: '🟡chase', waiting: '🟢wait', cold: '🪦cold', dormant: '💀dormant', won: '✅won', dropped: '⚰️dropped' };
const ORDER = ['hot', 'aging', 'chase_due', 'waiting', 'cold', 'dormant', 'won', 'dropped'];
const ACTION = new Set(['hot', 'aging', 'chase_due']);
const fmtH = (h) => h == null ? '?' : (h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);

// spread if both legs known
function spread(d) { const b = parseFloat(d.buy), s = parseFloat(d.sell), q = parseFloat(d.qty); if (b && s && q) return Math.round((s - b) * q); return null; }

function applyFields(d, args) {
  const set = (k, v) => { if (v !== undefined) d[k] = v; };
  set('product', flag(args, 'product')); set('qty', flag(args, 'qty'));
  set('buyer', flag(args, 'buyer')); set('company', flag(args, 'company')); set('buyer_email', flag(args, 'buyer-email'));
  set('supplier', flag(args, 'supplier')); set('supplier_domain', flag(args, 'supplier-domain'));
  set('stage', flag(args, 'stage')); set('next', flag(args, 'next'));
  const buy = flag(args, 'buy'), sell = flag(args, 'sell'), bt = flag(args, 'buy-target'), st = flag(args, 'sell-target');
  set('buy', buy); set('sell', sell); set('buy_target', bt); set('sell_target', st);
  const ball = flag(args, 'ball');
  if (ball) { if (!['us', 'buyer', 'supplier'].includes(ball)) die('ball must be us|buyer|supplier'); if (ball !== d.ball) d.since = tsOf(flag(args, 'since')) || now(); d.ball = ball; }
  const since = flag(args, 'since'); if (since) d.since = tsOf(since);
}

// an unresolved signal is a state-change READ but not yet acted on — it must be
// impossible to miss, so it rides on every line until resolved.
function sigTag(d) {
  if (!d.signal || d.signal.resolved) return '';
  const k = d.signal.kind === 'accept' ? '🟢ACCEPT' : '🔴DROP';
  return `  ⚠️${k}:"${(d.signal.phrase || '').slice(0, 30)}"`;
}
function line(ref, d) {
  const lc = lifecycle(d);
  const sp = spread(d);
  return `${(TAG[lc] || lc).padEnd(9)} ${(d.stage || '?').padEnd(11)} ball=${(d.ball || '?').padEnd(9)} ${fmtH(silentH(d)).padStart(4)}  ${ref} · ${(d.product || '').slice(0, 34)}${d.qty ? ' · ' + d.qty : ''}${sp ? `  ($${sp.toLocaleString()})` : ''}${d.next ? `  → ${d.next}` : ''}${sigTag(d)}`;
}

async function sheet(outArg) {
  const ExcelJS = require('exceljs');
  const b = load();
  const out = path.resolve(outArg || path.join(process.cwd(), 'memory', 'GE-Deals.xlsx'));
  const rows = Object.entries(b.deals).map(([ref, d]) => ({ ref, d, lc: lifecycle(d) })).sort((a, x) => ORDER.indexOf(a.lc) - ORDER.indexOf(x.lc) || silentH(a.d) - silentH(x.d));
  const wb = new ExcelJS.Workbook(); wb.creator = 'Winston';
  const ws = wb.addWorksheet('Deals', { views: [{ state: 'frozen', ySplit: 3 }] });
  const live = rows.filter((r) => !['won', 'dropped'].includes(r.lc));
  const act = live.filter((r) => ACTION.has(r.lc)).length;
  ws.mergeCells('A1:M1'); ws.getCell('A1').value = "Grand Empire — Winston's Deal Book"; ws.getCell('A1').font = { size: 15, bold: true, name: 'Georgia' };
  ws.mergeCells('A2:M2'); ws.getCell('A2').value = `${live.length} live · ${act} actionable · updated ${new Date().toLocaleString()}`; ws.getCell('A2').font = { size: 10, color: { argb: 'FF8B8175' } };
  const H = ['Health', 'Ref', 'Product', 'Qty', 'Buyer', 'Supplier', 'Stage', 'Ball', 'Silent', 'Buy', 'Sell', 'Spread', 'Next'];
  const hr = ws.addRow(H); hr.font = { bold: true, size: 10 };
  hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE7DC' } }; });
  const FILL = { hot: 'FFFCE9D6', aging: 'FFF6E7CE', chase_due: 'FFFBF3D2', waiting: 'FFE7F0E4', cold: 'FFEDEAE4', dormant: 'FFE4E0DA', won: 'FFDDEBDD', dropped: 'FFEFE1DE' };
  for (const { ref, d, lc } of rows) {
    const r = ws.addRow([TAG[lc] || lc, ref, (d.product || '').slice(0, 50), d.qty || '', d.buyer || '', d.supplier || '', d.stage || '', d.ball || '', fmtH(silentH(d)), d.buy || '', d.sell || '', spread(d) || '', d.next || '']);
    if (FILL[lc]) r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[lc] } };
  }
  ws.columns = [{ width: 11 }, { width: 15 }, { width: 40 }, { width: 8 }, { width: 20 }, { width: 18 }, { width: 12 }, { width: 9 }, { width: 8 }, { width: 8 }, { width: 8 }, { width: 10 }, { width: 32 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: H.length } };
  await wb.xlsx.writeFile(out);
  console.log(`book → ${out} (${rows.length} deals, ${act} actionable)`);
}

const [cmd, ...args] = process.argv.slice(2);
const ref = args[0];

if (cmd === 'add') {
  if (!ref) die('usage: add <ref> --product ... --ball us|buyer|supplier ...');
  const b = load();
  const d = b.deals[ref] || { opened_at: now(), history: [] };
  applyFields(d, args.slice(1));
  if (!d.ball) { d.ball = 'us'; d.since = now(); }
  if (!d.since) d.since = now();
  const nt = flag(args.slice(1), 'note'); if (nt) d.history.push({ ts: now(), text: nt });
  b.deals[ref] = d; save(b);
  console.log('added/updated ' + ref + '  [' + TAG[lifecycle(d)] + ']');
} else if (cmd === 'set') {
  if (!ref) die('usage: set <ref> --field val');
  const b = load(); const d = b.deals[ref]; if (!d) die('no deal ' + ref + ' (use add)');
  const before = { ball: d.ball, stage: d.stage, buy: d.buy, sell: d.sell };
  applyFields(d, args.slice(1));
  const chg = Object.entries(before).filter(([k, v]) => d[k] !== v).map(([k]) => `${k}→${d[k]}`);
  if (chg.length) (d.history = d.history || []).push({ ts: now(), text: chg.join(', ') });
  const nt = flag(args.slice(1), 'note'); if (nt) (d.history = d.history || []).push({ ts: now(), text: nt });
  save(b); console.log('updated ' + ref + '  [' + TAG[lifecycle(d)] + ']' + (chg.length ? '  ' + chg.join(', ') : ''));
} else if (cmd === 'note') {
  const b = load(); const d = b.deals[ref]; if (!d) die('no deal ' + ref);
  (d.history = d.history || []).push({ ts: now(), text: args.slice(1).join(' ') }); save(b); console.log('noted.');
} else if (cmd === 'get') {
  const b = load(); const d = b.deals[ref]; if (!d) die('no deal ' + ref);
  // OVERLAY only — the ball/tier/prices below are a STALE CACHE. For live state
  // (ball, price, whose move) run: status.js desk <ref>. Trust the thread, not this.
  console.log(`# ${ref} — OVERLAY (signals/notes/history). ⚠️ For live ball/price run: status.js desk ${ref}`);
  const overlay = { signal: d.signal, stage: d.stage, closed: d.closed, outcome: d.outcome, next: d.next, buyer: d.buyer, supplier: d.supplier, history: d.history };
  console.log(JSON.stringify(overlay, null, 2));
} else if (cmd === 'close') {
  const b = load(); const d = b.deals[ref]; if (!d) die('no deal ' + ref);
  d.closed = true; d.outcome = flag(args.slice(1), 'outcome') || 'lost';
  if (d.signal && !d.signal.resolved) { d.signal.resolved = true; d.signal.resolved_at = now(); } // closing actions the signal
  (d.history = d.history || []).push({ ts: now(), text: `closed ${d.outcome}: ${flag(args.slice(1), 'reason') || ''}` });
  save(b); console.log(`closed ${ref} (${d.outcome}).`);
} else if (cmd === 'signal') {
  // READING WRITES: a decisive state-change (accept / drop) read in a message
  // body, made STICKY so the next patrol or morning brief can never forget it.
  // This is the fix for the Militia scar — Winston notified once, then forgot,
  // because reading a body wrote nothing. A signal persists until `resolve`d.
  // It NEVER auto-closes (Sohan's floor: only `close` on an explicit drop) — it
  // flags "your move". Auto-creates the deal if unbooked, so a confirmed order
  // that was never in the book gets booked the instant it's read.
  if (!ref) die('usage: signal <ref> --kind accept|drop --phrase "..." [--when date] [--from who]');
  const kind = flag(args.slice(1), 'kind');
  if (!['accept', 'drop'].includes(kind)) die('kind must be accept|drop');
  const b = load();
  const existed = !!b.deals[ref];
  const d = b.deals[ref] || { opened_at: now(), history: [] };
  const sig = { kind, phrase: flag(args.slice(1), 'phrase') || '', when: tsOf(flag(args.slice(1), 'when')) || now(), from: flag(args.slice(1), 'from') || '', ts: now(), resolved: false };
  // idempotent: re-reading the same message on the next patrol must not churn
  if (d.signal && !d.signal.resolved && d.signal.kind === kind && d.signal.phrase === sig.phrase) {
    console.log(`signal unchanged on ${ref} (${kind})`); process.exit(0);
  }
  d.signal = sig;
  if (kind === 'accept' && d.stage !== 'order') d.stage = 'order'; // an accept ADVANCES the deal (not a close)
  (d.history = d.history || []).push({ ts: now(), text: `signal:${kind} "${sig.phrase}"${sig.from ? ' from ' + sig.from : ''}` });
  if (!existed) { d.ball = 'us'; d.since = now(); } // a fresh signal-born deal: we owe the next move
  b.deals[ref] = d; save(b);
  console.log(`⚠️ SIGNAL ${kind.toUpperCase()} on ${ref}${existed ? '' : ' (auto-booked)'}${sig.from ? ' from ' + sig.from : ''}: "${sig.phrase}" — YOUR MOVE (persisted, unresolved)`);
} else if (cmd === 'resolve') {
  const b = load(); const d = b.deals[ref]; if (!d) die('no deal ' + ref);
  if (!d.signal || d.signal.resolved) die('no unresolved signal on ' + ref);
  const k = d.signal.kind; d.signal.resolved = true; d.signal.resolved_at = now();
  (d.history = d.history || []).push({ ts: now(), text: `signal resolved (${k})` });
  save(b); console.log(`resolved ${k} signal on ${ref}.`);
} else if (cmd === 'signals') {
  const b = load();
  const rows = Object.entries(b.deals).filter(([, d]) => d.signal && !d.signal.resolved && !d.closed)
    .sort((a, x) => (a[1].signal.when || '').localeCompare(x[1].signal.when || ''));
  console.log(`# SIGNALS — ${rows.length} unresolved state-changes (YOUR MOVE — read, not yet acted on)`);
  for (const [ref, d] of rows) {
    const k = d.signal.kind === 'accept' ? '🟢ACCEPT' : '🔴DROP ';
    console.log(`${k} ${ref} · ${(d.product || '?').slice(0, 30)}${d.qty ? ' ' + d.qty : ''} · ${d.signal.from || '?'} ${(d.signal.when || '').slice(0, 10)}: "${d.signal.phrase}"`);
  }
} else if (cmd === 'today' || cmd === 'list' || cmd === 'stats') {
  // DECOMMISSIONED: these read stored ball/tier/spread = a STALE CACHE, which is
  // the recurring "the book was wrong again" bug. State lives in the live threads.
  console.error(`book.js ${cmd} is retired — it served a stale cache.\n→ Live board:   node ../../scripts/status.js desk\n→ Factory list: node ../../scripts/status.js desk fty\n→ One deal:     node ../../scripts/status.js desk <ref>\nbook.js is now overlay-only: signal | signals | resolve | note | close | sheet | get(overlay).`);
  process.exit(2);
} else if (cmd === 'sheet') {
  sheet(ref).catch((e) => die(e.message));
} else {
  console.log("book.js — OVERLAY store (registry + signals/notes/closes). STATE is live: status.js desk. commands: signal | signals | resolve | note | close | get(overlay) | add | set | sheet  ·  (today/list/stats retired → status.js desk)");
}
