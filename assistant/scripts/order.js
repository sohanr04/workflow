#!/usr/bin/env node
'use strict';

/**
 * order.js — Winston takes an order and never forgets it.
 *
 * The "follows orders" surface. Sohan tells Winston something in plain words;
 * Winston (the LLM) turns it into these structured flags and calls `add`, then
 * ECHOES the captured record back so Sohan can confirm it landed right. The
 * verbatim instruction is always kept in `raw` — so the reason behind any future
 * chase is Sohan's own words, not a guess.
 *
 * Parsing (words → fields) is Winston's job; STORAGE here is deterministic.
 *
 * Commands (run from profiles/sohan/):
 *   order.js add "<what Sohan said>" [--kind chase|remind|note|watch]
 *            [--ref GBT26-4212] [--party Cherry] [--detail "confirm price"]
 *            [--due <when>] [--cadence <days>]
 *   order.js list [open|done|snoozed|cancelled|all]
 *   order.js get <id>
 *   order.js done <id> [reason...]
 *   order.js chase <id>              # mark chased (rearms if it has a cadence)
 *   order.js snooze <id> <when>
 *   order.js cancel <id> [reason...]
 *
 * <when>: ISO date, `now`, `today`, `tomorrow`, `+Nd`/`Nd`, `+Nh`/`Nh`.
 *   Fuzzy dates ("Monday", "next week") — Winston resolves to an ISO date and
 *   passes that; the CLI only handles the simple forms above.
 */

const store = require('./store');

const now = () => new Date().toISOString();
const HKT = 'Asia/Hong_Kong';
function die(m) { console.error('order.js: ' + m); process.exit(1); }
function flag(args, name) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined && !String(args[i + 1]).startsWith('--') ? args[i + 1] : undefined;
}

// strict due parser. Fuzzy words ("Monday") are NOT guessed — Winston resolves
// those to a real date first. Bare dates are read as HK time (Sohan's in HK), so
// "2026-08-01" means HK midnight, not UTC.
function parseDue(v) {
  if (!v) return null;
  if (v === 'now' || v === 'today') return now();
  if (v === 'tomorrow') return new Date(Date.now() + 864e5).toISOString();
  let m = String(v).match(/^\+?(\d+)\s*([dh])$/i);
  if (m) return new Date(Date.now() + (+m[1]) * (m[2].toLowerCase() === 'd' ? 864e5 : 36e5)).toISOString();
  m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); // date only → HKT midnight
  if (m) {
    const [Y, Mo, D] = [+m[1], +m[2], +m[3]];
    const chk = new Date(Date.UTC(Y, Mo - 1, D));
    if (chk.getUTCFullYear() !== Y || chk.getUTCMonth() !== Mo - 1 || chk.getUTCDate() !== D) die(`not a real date "${v}"`);
    return new Date(`${v}T00:00:00+08:00`).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(v))) { const d = new Date(v); if (!isNaN(d.getTime())) return d.toISOString(); } // full ISO
  die(`can't read due "${v}" — pass an ISO date (YYYY-MM-DD), now/today/tomorrow, or +Nd/+Nh`);
}

// display an ISO instant in HK time so due dates read the way Sohan lives them
function fmtHKT(iso) {
  if (!iso) return null;
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: HKT, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')} HKT`;
}

// strict positive-integer order id (rejects "12oops", floats, unsafe ints)
function pid(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || String(v).trim() !== String(n)) die(`bad order id "${v}"`);
  return n;
}

// Human-readable echo of a stored order — the confirm-back.
function show(o) {
  const bits = [
    `[${o.id}] ${o.kind}`,
    o.deal_ref ? `ref ${o.deal_ref}` : null,
    o.party ? `→ ${o.party}` : null,
    o.detail ? `(${o.detail})` : null,
    o.due_at ? `due ${fmtHKT(o.due_at)}` : 'no due date',
    o.cadence_days ? `every ${o.cadence_days}d` : null,
    o.status !== 'open' ? `[${o.status}]` : null,
  ].filter(Boolean);
  return bits.join(' · ') + `\n    "${o.raw}"`;
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'add') {
    const raw = args[0];
    if (!raw || raw.startsWith('--')) die('usage: add "<what Sohan said>" [--kind ..] [--ref ..] [--party ..] [--detail ..] [--due ..] [--cadence ..]');
    const rest = args.slice(1);
    const o = store.addOrder({
      raw,
      kind: flag(rest, 'kind') || 'chase',
      deal_ref: flag(rest, 'ref'),
      party: flag(rest, 'party'),
      detail: flag(rest, 'detail'),
      due_at: parseDue(flag(rest, 'due')),
      // pass raw — store.normCadence rejects non-integers (parseInt would silently
      // truncate "1.5" → 1). undefined when absent.
      cadence_days: flag(rest, 'cadence'),
    });
    // link a light deal entity if a ref was given, so "what's this deal" has a home
    if (o.deal_ref) store.upsertDeal(o.deal_ref, { supplier: undefined });
    console.log('✅ captured:\n' + show(o));
  } else if (cmd === 'list') {
    const which = args[0] || 'open';
    const rows = which === 'all'
      ? store.db().prepare('SELECT * FROM orders ORDER BY created_at DESC').all()
      : store.listOpen(which);
    console.log(`# ${rows.length} ${which} order(s)`);
    for (const o of rows) console.log(show(o) + '\n');
  } else if (cmd === 'get') {
    const o = store.getOrder(pid(args[0])); if (!o) die('no order ' + args[0]);
    console.log(show(o));
    const evs = store.eventsForOrder(o.id);
    if (evs.length) { console.log('  — history —'); for (const e of evs) console.log(`    ${fmtHKT(e.ts)} ${e.source}/${e.kind}: ${e.text || ''}`); }
  } else if (cmd === 'done') {
    const o = store.closeOrder(pid(args[0]), { reason: args.slice(1).join(' ') || undefined });
    console.log('done: ' + show(o));
  } else if (cmd === 'chase') {
    const o = store.actionOrder(pid(args[0]), { reason: args.slice(1).join(' ') || 'chased', source: 'sohan' });
    console.log((o.status === 'open' ? '↻ rearmed: ' : 'done: ') + show(o));
  } else if (cmd === 'snooze') {
    const when = parseDue(args[1]); if (!when) die('usage: snooze <id> <when>');
    const o = store.snoozeOrder(pid(args[0]), when);
    console.log('💤 snoozed: ' + show(o));
  } else if (cmd === 'cancel') {
    const o = store.closeOrder(pid(args[0]), { status: 'cancelled', reason: args.slice(1).join(' ') || undefined });
    console.log('cancelled: ' + show(o));
  } else {
    console.log('order.js — Winston takes orders. commands: add "<raw>" [flags] | list [open|all] | get <id> | done <id> | chase <id> | snooze <id> <when> | cancel <id>');
  }
} catch (e) { die(e.message); }
