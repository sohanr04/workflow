#!/usr/bin/env node
'use strict';

/**
 * store.js — Winston's memory. The EA's notebook.
 *
 * Winston v2 is a deal-desk executive assistant: he takes ORDERS from Sohan,
 * never forgets them, and chases. The source of truth is what Sohan TELLS him
 * (clean input) — NOT a guess derived from messy supplier email (the v1 rot).
 *
 * This is a real structured store (node:sqlite — built into Node 22, zero
 * install, verified on Pro + Air). Three tables:
 *   orders — the spine: one row per thing Sohan told Winston to track/do/chase.
 *            `raw` holds his verbatim words so "the why" behind any chase is
 *            always his own instruction played back — never a black box.
 *   events — append-only audit: every touch (Sohan, an email assist, Winston).
 *   deals  — LIGHT entity a ref can hang on (product/buyer/supplier/ball). NOT
 *            the old auto-derived board; enriched only as orders reference it.
 *
 * Store: profiles/sohan/memory/winston.db   (WINSTON_DB overrides)
 *
 * CLI (run from profiles/sohan/):
 *   store.js init            # create/migrate the schema
 *   store.js stats           # census
 *   store.js orders [open]   # dump orders (default: all)
 *   store.js deals           # dump the light deal entities
 */

const path = require('path');

// node:sqlite is a built-in but flagged experimental — it prints one warning on
// require. Swallow ONLY that line so Winston's output/logs stay clean; every
// other warning still surfaces. Guarded so re-requiring can't stack wrappers.
if (!global.__winstonSqliteWarnPatched) {
  const _emitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, ...rest) => {
    if (String(warning).includes('SQLite is an experimental feature')) return;
    return _emitWarning(warning, ...rest);
  };
  global.__winstonSqliteWarnPatched = true;
}
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.WINSTON_DB || path.join(process.cwd(), 'memory', 'winston.db');
const now = () => new Date().toISOString();

const KINDS = new Set(['chase', 'remind', 'note', 'watch']);
const STATUSES = new Set(['open', 'done', 'snoozed', 'cancelled']);
const DUE_KINDS = new Set(['chase', 'remind']); // kinds that come due and get chased

// Normalize a due value coming through the TYPED api: must already be a real
// ISO date (order.js resolves fuzzy words to ISO before calling). Reject
// garbage like 'tomorrow' / '1' so it can never be stored and then either
// never fire or fire immediately with a NaN age.
function normDue(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})([T ]|$)/);
  if (!m) throw new Error(`due_at must be an ISO date, got "${s}"`);
  // validate the calendar date so 2026-02-30 is rejected, not silently rolled to Mar 2
  const [Y, Mo, D] = [+m[1], +m[2], +m[3]];
  const chk = new Date(Date.UTC(Y, Mo - 1, D));
  if (chk.getUTCFullYear() !== Y || chk.getUTCMonth() !== Mo - 1 || chk.getUTCDate() !== D) throw new Error(`not a real date "${s}"`);
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error(`invalid due_at "${s}"`);
  return d.toISOString();
}
function normCadence(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error('cadence_days must be an integer 1..365');
  return n;
}
// run a set of writes atomically so a state change and its audit event can't
// desync (crash/lock between them would otherwise leave a half-written record).
function tx(fn) {
  const d = db();
  d.exec('BEGIN');
  try { const r = fn(); d.exec('COMMIT'); return r; }
  catch (e) { try { d.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
}

let _db = null;
function db() {
  if (_db) return _db;
  const fs = require('fs');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  // The gateway and short-lived CLI invocations both open this same file. Give a
  // writer up to 5s to get the lock instead of failing instantly with
  // SQLITE_BUSY. (Deliberately NOT WAL — write volume is tiny, and plain
  // rollback-journal + busy_timeout avoids the WAL-reset corruption class.)
  _db.exec('PRAGMA busy_timeout = 5000;');
  migrate(_db);
  return _db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    TEXT NOT NULL,
      raw           TEXT NOT NULL,           -- Sohan's verbatim instruction
      kind          TEXT NOT NULL,           -- chase | remind | note | watch
      deal_ref      TEXT,                    -- e.g. GBT26-4212 (free-text ok)
      party         TEXT,                    -- who to chase (Cherry / Noma / Atila)
      detail        TEXT,                    -- the ask ("send PI", "confirm price")
      due_at        TEXT,                    -- ISO; when it's due to fire
      cadence_days  INTEGER,                 -- repeat interval after a chase (nullable)
      status        TEXT NOT NULL DEFAULT 'open',  -- open|done|snoozed|cancelled
      last_actioned_at TEXT,
      done_reason   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_orders_open ON orders(status, due_at);
    CREATE INDEX IF NOT EXISTS idx_orders_ref  ON orders(deal_ref);

    CREATE TABLE IF NOT EXISTS events (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ts        TEXT NOT NULL,
      order_id  INTEGER,
      deal_ref  TEXT,
      source    TEXT NOT NULL,               -- sohan | email | winston
      kind      TEXT,
      text      TEXT,
      msg_id    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_order ON events(order_id);

    CREATE TABLE IF NOT EXISTS deals (
      ref        TEXT PRIMARY KEY,
      product    TEXT,
      buyer      TEXT,
      supplier   TEXT,
      stage      TEXT,
      ball       TEXT,
      note       TEXT,
      updated_at TEXT
    );
  `);
  // schema version hook — future column adds branch on this instead of assuming
  // CREATE IF NOT EXISTS migrated an existing table (it doesn't).
  if (d.prepare('PRAGMA user_version').get().user_version === 0) d.exec('PRAGMA user_version = 1');
}

// ── orders ───────────────────────────────────────────────────────────────────

// Add an order. `o` = { raw (required), kind, deal_ref, party, detail, due_at,
// cadence_days }. Returns the stored row (with id). Also logs a 'created' event.
function addOrder(o) {
  if (!o || !o.raw || !String(o.raw).trim()) throw new Error('order needs raw text (what Sohan said)');
  const kind = o.kind || 'chase';
  if (!KINDS.has(kind)) throw new Error(`kind must be one of ${[...KINDS].join('|')}`);
  const created = now();
  const raw = String(o.raw).trim();
  const cadence = normCadence(o.cadence_days);
  // A chase/remind with no due date would otherwise be captured but NEVER fire
  // (dueForChase requires a due) — a silent loss. Default it to now so it
  // surfaces on the next chase run. notes/watch legitimately have no due.
  let due = normDue(o.due_at);
  if (!due && DUE_KINDS.has(kind)) due = created;
  return tx(() => {
    const info = db().prepare(
      `INSERT INTO orders (created_at, raw, kind, deal_ref, party, detail, due_at, cadence_days, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`
    ).run(created, raw, kind, o.deal_ref || null, o.party || null, o.detail || null, due, cadence);
    const id = Number(info.lastInsertRowid);
    logEvent({ order_id: id, deal_ref: o.deal_ref || null, source: 'sohan', kind: 'order_created', text: raw });
    return getOrder(id);
  });
}

function getOrder(id) {
  return db().prepare('SELECT * FROM orders WHERE id = ?').get(id) || null;
}

// All open orders, oldest-due first (undated last). status defaults to 'open'.
function listOpen(status = 'open') {
  return db().prepare(
    `SELECT * FROM orders WHERE status = ?
     ORDER BY (due_at IS NULL), due_at ASC, created_at ASC`
  ).all(status);
}

// Everything actionable RIGHT NOW: open chases/reminders whose due_at has passed.
// Most-overdue first. A note/watch never "comes due" — those aren't chases.
function dueForChase(atISO = now()) {
  // NULL-safe: a chase/remind with no due date surfaces immediately (never lost)
  // instead of being filtered out — self-heals any raw/legacy NULL-due row.
  return db().prepare(
    `SELECT * FROM orders
     WHERE status = 'open' AND kind IN ('chase','remind')
       AND (due_at IS NULL OR due_at <= ?)
     ORDER BY (due_at IS NULL) DESC, due_at ASC`
  ).all(atISO);
}

// Mark a chase acted-on. If it has a cadence, it REARMS (due_at pushed out) and
// stays open — a recurring nudge. Otherwise it closes.
function actionOrder(id, { reason, atISO = now(), source = 'winston' } = {}) {
  const o = getOrder(id);
  if (!o) throw new Error('no order ' + id);
  if (o.status !== 'open') throw new Error(`order ${id} is ${o.status}, not open`);
  if (!DUE_KINDS.has(o.kind)) throw new Error(`order ${id} is a ${o.kind}, not a chase/remind`);
  if (o.cadence_days) {
    // rearm from NOW (nudge again N days after this actual nudge). Recurring
    // nudge semantics, not a fixed calendar schedule.
    const next = new Date(new Date(atISO).getTime() + o.cadence_days * 864e5).toISOString();
    return tx(() => {
      // re-check status INSIDE the tx via the UPDATE's WHERE + rowcount: if a
      // concurrent close flipped it between the guard and here, 0 rows change →
      // throw → the whole tx (incl. the event) rolls back. No phantom 'chased'.
      const r = db().prepare('UPDATE orders SET due_at = ?, last_actioned_at = ? WHERE id = ? AND status = \'open\'').run(next, atISO, id);
      if (r.changes === 0) throw new Error(`order ${id} changed concurrently (no longer open)`);
      logEvent({ order_id: id, deal_ref: o.deal_ref, source, kind: 'chased', text: reason || 'chased; rearmed' });
      return getOrder(id);
    });
  }
  return closeOrder(id, { reason: reason || 'actioned', atISO, source });
}

function closeOrder(id, { reason, status = 'done', atISO = now(), source = 'sohan' } = {}) {
  if (!STATUSES.has(status)) throw new Error('bad status ' + status);
  const o = getOrder(id);
  if (!o) throw new Error('no order ' + id);
  return tx(() => {
    db().prepare('UPDATE orders SET status = ?, done_reason = ?, last_actioned_at = ? WHERE id = ?')
      .run(status, reason || null, atISO, id);
    logEvent({ order_id: id, deal_ref: o.deal_ref, source, kind: status, text: reason || '' });
    return getOrder(id);
  });
}

function snoozeOrder(id, untilISO) {
  const o = getOrder(id);
  if (!o) throw new Error('no order ' + id);
  if (o.status !== 'open') throw new Error(`order ${id} is ${o.status}, not open`);
  const until = normDue(untilISO);
  if (!until) throw new Error('snooze needs a due date');
  return tx(() => {
    // snoozing just moves the due date but keeps it open (still a live chase).
    // status re-checked inside the tx via WHERE + rowcount (see actionOrder).
    const r = db().prepare("UPDATE orders SET due_at = ?, last_actioned_at = ? WHERE id = ? AND status = 'open'").run(until, now(), id);
    if (r.changes === 0) throw new Error(`order ${id} changed concurrently (no longer open)`);
    logEvent({ order_id: id, deal_ref: o.deal_ref, source: 'sohan', kind: 'snoozed', text: 'until ' + until });
    return getOrder(id);
  });
}

// Open orders attached to a deal ref (for the assist layer: an email lands →
// which of Sohan's chases might this answer?).
function openOrdersForRef(ref) {
  if (!ref) return [];
  return db().prepare("SELECT * FROM orders WHERE status = 'open' AND deal_ref = ? ORDER BY due_at ASC").all(ref);
}

// ── events ───────────────────────────────────────────────────────────────────

function logEvent(e) {
  db().prepare(
    'INSERT INTO events (ts, order_id, deal_ref, source, kind, text, msg_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(now(), e.order_id || null, e.deal_ref || null, e.source || 'winston', e.kind || null, e.text || null, e.msg_id || null);
}

function eventsForOrder(id) {
  return db().prepare('SELECT * FROM events WHERE order_id = ? ORDER BY ts ASC').all(id);
}

// ── deals (light entity) ──────────────────────────────────────────────────────

// Upsert the light deal record. Only overwrites fields you pass (COALESCE keeps
// existing values), so an order that only knows the party doesn't wipe a product.
function upsertDeal(ref, f = {}) {
  if (!ref) throw new Error('deal needs a ref');
  // atomic upsert — no check-then-insert race. On conflict, COALESCE keeps any
  // existing value the caller didn't pass (a party-only update won't wipe product).
  db().prepare(`
    INSERT INTO deals (ref, product, buyer, supplier, stage, ball, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ref) DO UPDATE SET
      product = COALESCE(excluded.product, deals.product),
      buyer = COALESCE(excluded.buyer, deals.buyer),
      supplier = COALESCE(excluded.supplier, deals.supplier),
      stage = COALESCE(excluded.stage, deals.stage),
      ball = COALESCE(excluded.ball, deals.ball),
      note = COALESCE(excluded.note, deals.note),
      updated_at = excluded.updated_at`)
    .run(ref, f.product ?? null, f.buyer ?? null, f.supplier ?? null, f.stage ?? null, f.ball ?? null, f.note ?? null, now());
  return getDeal(ref);
}

function getDeal(ref) {
  return db().prepare('SELECT * FROM deals WHERE ref = ?').get(ref) || null;
}

module.exports = {
  DB_PATH, db, addOrder, getOrder, listOpen, dueForChase, actionOrder, closeOrder,
  snoozeOrder, openOrdersForRef, logEvent, eventsForOrder, upsertDeal, getDeal,
};

// ── CLI ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    if (cmd === 'init') { db(); console.log('winston.db ready → ' + DB_PATH); }
    else if (cmd === 'stats') {
      const o = db().prepare("SELECT status, COUNT(*) c FROM orders GROUP BY status").all();
      const due = dueForChase().length;
      const deals = db().prepare('SELECT COUNT(*) c FROM deals').get().c;
      console.log('# winston.db → ' + DB_PATH);
      console.log('orders: ' + (o.map((r) => `${r.status}=${r.c}`).join(' · ') || 'none') + `  |  due now: ${due}  |  deals: ${deals}`);
    } else if (cmd === 'orders') {
      const rows = a[0] ? listOpen(a[0]) : db().prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
      console.log(`# ${rows.length} order(s)`);
      for (const r of rows) console.log(`[${r.id}] ${r.status.padEnd(9)} ${r.kind.padEnd(6)} ${(r.deal_ref || '—').padEnd(14)} due=${(r.due_at || '—').slice(0, 16)} ${r.party ? '· ' + r.party + ' ' : ''}· "${r.raw.slice(0, 60)}"`);
    } else if (cmd === 'deals') {
      const rows = db().prepare('SELECT * FROM deals ORDER BY updated_at DESC').all();
      console.log(`# ${rows.length} deal(s)`);
      for (const r of rows) console.log(`${r.ref.padEnd(16)} ${(r.stage || '?').padEnd(10)} ball=${(r.ball || '?').padEnd(9)} ${r.product || ''} · ${r.buyer || '?'} ← ${r.supplier || '?'}`);
    } else {
      console.log('store.js — Winston memory. commands: init | stats | orders [open|done|snoozed] | deals');
    }
  } catch (e) { console.error('store.js: ' + e.message); process.exit(1); }
}
