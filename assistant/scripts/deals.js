#!/usr/bin/env node
'use strict';

/**
 * deals.js — Winston's read-only view of the DEALS BOARD.
 *
 * The relay's deals-engine derives every live deal into a Supabase `deals`
 * table every 3 min — with stage, ball_in_court, is_urgent, is_stalled,
 * silent_hours already computed. THIS IS THE PIPELINE. Winston reads it here
 * instead of re-deriving deals from raw email (which he got wrong). He acts
 * on the board — chases, drafts, decisions — and records those in deals.md.
 *
 * READ ONLY: only GETs the deals table. No write/update anywhere.
 *
 * Creds (self-sourced from the relay's .env.local, same as graph.js — or set
 * in assistant/.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage (run from profiles/sohan/, exact command — no cd, no abs path):
 *   node ../../scripts/deals.js today            # ball on US, live — the work queue
 *   node ../../scripts/deals.js urgent           # ball on us, past the short clock
 *   node ../../scripts/deals.js stalled          # waiting on them, past threshold
 *   node ../../scripts/deals.js board [n]        # all live deals, hottest first
 *   node ../../scripts/deals.js company <name>   # one account's deals
 *   node ../../scripts/deals.js stage <stage>    # interested|sourcing|quoted|negotiating
 *   node ../../scripts/deals.js get <deal_key>   # full detail of one deal
 *   node ../../scripts/deals.js count            # live deal count by stage
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { retryFetch } = require('./_net'); // Happy-Eyeballs + retry hardening

function fromRelayEnv(key) {
  const home = os.homedir();
  const paths = [
    process.env.RELAY_ENV_PATH,
    path.join(home, 'Projects/grand-empire-stock-deals/.env.local'),
    path.join(home, 'Projects/grand-empire-stock-inventory-matching/.env.local'),
    path.join(home, 'grand-empire-stock-deals/.env.local'),
    path.join(home, 'workflow/../grand-empire-stock-deals/.env.local'),
  ].filter(Boolean);
  for (const p of paths) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* next */ }
  }
  return undefined;
}
const URL = (process.env.SUPABASE_URL || fromRelayEnv('SUPABASE_URL') || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fromRelayEnv('SUPABASE_SERVICE_ROLE_KEY');

function die(m) { console.error('deals.js: ' + m); process.exit(1); }

// Live = not closed. Winston works the open pipeline.
const LIVE = 'stage=not.in.(closed_won,closed_lost)';
const COLS = 'deal_key,stage,current_leg,ball_in_court,last_actor,silent_hours,is_urgent,is_stalled,negotiation_rounds,buyer_email,buyer_name,company,supplier_name,supplier_domain,style,qty,offer_subject,intent,opened_at,buyer_side,factory_side';

// ── LIFECYCLE MODEL — knows birth, death, and when to nudge ──────────────────
// The engine births a deal well and tracks legs, but it has NO concept of
// natural death: a ball-on-us deal silent for 700h (a MONTH) still shows
// 🔴URGENT. That's a corpse, not urgent. We reclassify from the HONEST
// counterparty clock — how long since the side we're waiting on actually spoke
// — never our own nudge (the engine's top-level silent_hours resets when WE
// send, so it lies about true silence on the waiting-on-them legs).
const HOT_MAX_H = 72;        // ball on us, they replied < 3d ago → act now
const COLD_MIN_H = 336;      // 14d counterparty silence → likely dead, review/ask, DON'T nag
const DORMANT_MIN_H = 720;   // 30d silence → dead backlog, batch only
const WAIT_CUST_H = 48;      // healthy quiet on a buyer (engine's threshold)
const WAIT_SUP_H = 24;       // healthy quiet on a supplier

// Honest silence = hours since the RELEVANT counterparty last spoke.
// Ball on us → they spoke last, so top-level silent_hours IS honest.
// Ball on them → use the side's them_last_at (our nudges never reset it).
function themSilentHours(d, nowMs) {
  if (d.ball_in_court === 'us') return d.silent_hours;
  const side = d.ball_in_court === 'supplier' ? d.factory_side : d.buyer_side;
  const t = side && side.them_last_at ? new Date(side.them_last_at).getTime() : null;
  return t != null ? Math.round(((nowMs - t) / 3_600_000) * 10) / 10 : d.silent_hours;
}

// The single source of truth for a deal's real state.
//   hot       ball on us, fresh reply waiting        → nudge, act now
//   aging     ball on us, 3–14d, still worth a move  → nudge, getting old
//   chase_due waiting on them, past healthy, < 14d   → chase draft ready
//   waiting   waiting on them, within healthy window → leave it, healthy
//   cold      14–30d counterparty silence            → likely dead: re-read + ASK, never nag
//   dormant   30d+ silence                           → dead backlog, batch count only
//   dropped   explicitly ended                       → off the board
function lifecycle(d, nowMs) {
  if (d.stage === 'closed_lost') return 'dropped';
  if (d.stage === 'closed_won') return 'won';
  const ts = themSilentHours(d, nowMs);
  if (ts == null) return 'waiting';
  if (ts >= DORMANT_MIN_H) return 'dormant';
  if (ts >= COLD_MIN_H) return 'cold';
  if (d.ball_in_court === 'us') return ts <= HOT_MAX_H ? 'hot' : 'aging';
  const legThresh = d.ball_in_court === 'supplier' ? WAIT_SUP_H : WAIT_CUST_H;
  return ts <= legThresh ? 'waiting' : 'chase_due';
}
const ACTIONABLE = new Set(['hot', 'aging', 'chase_due']); // the real nudge queue
const DEADish = new Set(['cold', 'dormant']);              // never nag; batch/ask
const LC_TAG = { hot: '🔥hot', aging: '🟠aging', chase_due: '🟡chase', waiting: '🟢wait', cold: '🪦cold', dormant: '💀dormant', dropped: '⚰️dropped', won: '✅won' };

async function q(qs) {
  if (!URL || !KEY) die('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (self-sourced from the relay .env.local, or set in assistant/.env)');
  if (typeof fetch === 'undefined') die(`no global fetch — Node too old (need 18+). node ${process.version}`);
  let res;
  try {
    res = await retryFetch(`${URL}/rest/v1/deals?${qs}`, {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
    });
  } catch (e) {
    const c = e && e.cause ? ` (cause: ${e.cause.code || e.cause.message || e.cause})` : '';
    die(`board query failed after retries: ${e.message}${c} — check network/DNS. node ${process.version}`);
  }
  if (!res.ok) die(`board query HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// buyer::subject deal_key — the subject usually carries the DIS ref + product
// + qty, so surface it even when the denormalised columns are null.
function subjOf(d) {
  if (d.offer_subject) return d.offer_subject;
  const k = d.deal_key || '';
  return k.includes('::') ? k.split('::').slice(1).join('::') : k;
}
function fmtH(h) {
  if (h == null) return '?';
  if (h < 24) return `${Math.round(h)}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}
function line(d, nowMs) {
  const lc = lifecycle(d, nowMs);
  const ts = themSilentHours(d, nowMs);
  const who = d.company || d.buyer_name || d.buyer_email || '?';
  const leg = d.ball_in_court ? `ball=${d.ball_in_court}` : '';
  // silence shown is the HONEST counterparty clock, not the engine's reset-on-us one
  return `${(LC_TAG[lc] || lc).padEnd(9)} ${(d.stage || '?').padEnd(11)} ${leg.padEnd(12)} ${fmtH(ts).padStart(4)} silent  ${who} — ${subjOf(d)}`;
}

// Fetch live deals, classify, and split into the real nudge queue vs the dead
// backlog. Everything downstream reads from this one honest pass.
async function classified() {
  const nowMs = Date.now();
  const rows = await q(`${LIVE}&select=${COLS}&limit=1000`);
  for (const d of rows) { d._lc = lifecycle(d, nowMs); d._ts = themSilentHours(d, nowMs); }
  return { nowMs, rows };
}
function bySilenceAsc(a, b) { return (a._ts ?? 0) - (b._ts ?? 0); } // freshest reply first
function bySilenceDesc(a, b) { return (b._ts ?? 0) - (a._ts ?? 0); } // most overdue first

async function list(qs, title) {
  const nowMs = Date.now();
  const rows = await q(`${qs}&select=${COLS}`);
  console.log(`# ${title} — ${rows.length}`);
  for (const d of rows) console.log(line(d, nowMs));
}

(async () => {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'today':
      case 'mine': {
        // THE WORK QUEUE — ball on us, genuinely actionable (hot + aging),
        // corpses excluded, FRESHEST REPLY FIRST (act on the newest, not the
        // deadest). Cold ball-on-us is summarised at the bottom, never nagged.
        const { nowMs, rows } = await classified();
        const mine = rows.filter(d => d.ball_in_court === 'us');
        const act = mine.filter(d => ACTIONABLE.has(d._lc)).sort(bySilenceAsc);
        const dead = mine.filter(d => DEADish.has(d._lc));
        console.log(`# BALL ON US — ${act.length} actionable (fresh first)${dead.length ? ` · ${dead.length} cold (buried)` : ''}`);
        for (const d of act) console.log(line(d, nowMs));
        if (dead.length) console.log(`\n# ${dead.length} cold/dead ball-on-us (>14d silent) — say "cold" for the list; not nagged.`);
        return;
      }
      case 'chase': {
        // Waiting on THEM, past the healthy window but not yet dead — the real
        // chase list, most-overdue first. Uses the honest counterparty clock.
        const { nowMs, rows } = await classified();
        const due = rows.filter(d => d._lc === 'chase_due').sort(bySilenceDesc);
        console.log(`# CHASE DUE (waiting on them, overdue, not dead) — ${due.length}`);
        for (const d of due) console.log(line(d, nowMs));
        return;
      }
      case 'cold':
      case 'backlog': {
        // The graveyard — 14d+ counterparty silence. Batch view, never nudged
        // one-by-one. This is where the engine's "urgent" corpses actually live.
        const { nowMs, rows } = await classified();
        const dead = rows.filter(d => DEADish.has(d._lc)).sort(bySilenceDesc);
        const byBall = {};
        for (const d of dead) byBall[d.ball_in_court || '?'] = (byBall[d.ball_in_court || '?'] || 0) + 1;
        console.log(`# COLD BACKLOG (>14d silent, likely dead) — ${dead.length}  {${Object.entries(byBall).map(([k, v]) => `${k}:${v}`).join(' ')}}`);
        const show = a[0] === 'all' ? dead : dead.slice(0, 30);
        for (const d of show) console.log(line(d, nowMs));
        if (dead.length > show.length) console.log(`… +${dead.length - show.length} more (say "cold all")`);
        return;
      }
      case 'urgent':
        return await list(`${LIVE}&is_urgent=eq.true&order=silent_hours.desc&limit=60`, 'ENGINE-URGENT (raw is_urgent — includes corpses; prefer `today`)');
      case 'stalled':
        return await list(`${LIVE}&is_stalled=eq.true&order=silent_hours.desc&limit=60`, 'ENGINE-STALLED (raw; prefer `chase`)');
      case 'board': {
        // Lifecycle census + hottest live deals first.
        const { nowMs, rows } = await classified();
        const n = parseInt(a[0], 10) || 40;
        const order = ['hot', 'aging', 'chase_due', 'waiting', 'cold', 'dormant'];
        const census = {};
        for (const d of rows) census[d._lc] = (census[d._lc] || 0) + 1;
        console.log(`# LIVE BOARD — ${rows.length}  {${order.filter(k => census[k]).map(k => `${LC_TAG[k]}:${census[k]}`).join(' ')}}`);
        const ranked = rows.slice().sort((x, y) => order.indexOf(x._lc) - order.indexOf(y._lc) || bySilenceAsc(x, y)).slice(0, n);
        for (const d of ranked) console.log(line(d, nowMs));
        return;
      }
      case 'company':
        if (!a[0]) die('usage: company <name>');
        return await list(`${LIVE}&company=ilike.*${encodeURIComponent(a[0])}*&order=silent_hours.desc&limit=60`, `COMPANY ~ "${a[0]}"`);
      case 'stage':
        if (!a[0]) die('usage: stage <interested|sourcing|quoted|negotiating>');
        return await list(`stage=eq.${encodeURIComponent(a[0])}&order=silent_hours.desc&limit=60`, `STAGE = ${a[0]}`);
      case 'get': {
        if (!a[0]) die('usage: get <deal_key>');
        const rows = await q(`deal_key=eq.${encodeURIComponent(a.join(' '))}&select=*`);
        if (!rows.length) die('no deal with that key');
        const d = rows[0];
        console.log(`# lifecycle: ${lifecycle(d, Date.now())} · honest silence: ${fmtH(themSilentHours(d, Date.now()))}\n`);
        return console.log(JSON.stringify(d, null, 2));
      }
      case 'count': {
        // Lifecycle census — the honest health of the pipeline, not just stages.
        const { rows } = await classified();
        const byStage = {}, byLc = {};
        for (const d of rows) { byStage[d.stage] = (byStage[d.stage] || 0) + 1; byLc[d._lc] = (byLc[d._lc] || 0) + 1; }
        const order = ['hot', 'aging', 'chase_due', 'waiting', 'cold', 'dormant'];
        console.log(`# ${rows.length} live deals`);
        console.log(`# by health: ${order.filter(k => byLc[k]).map(k => `${LC_TAG[k]} ${byLc[k]}`).join(' · ')}`);
        const act = (byLc.hot || 0) + (byLc.aging || 0) + (byLc.chase_due || 0);
        const dead = (byLc.cold || 0) + (byLc.dormant || 0);
        console.log(`# ${act} actually actionable · ${dead} cold/dead backlog`);
        for (const s of Object.keys(byStage).sort()) console.log(`${String(byStage[s]).padStart(4)}  ${s}`);
        return;
      }
      case 'pending': {
        // Bare integer for the heartbeat GATE: count of GENUINELY actionable
        // deals (hot/aging ball-on-us + chase-due) — corpses excluded, so a
        // dead pipeline correctly reads 0 and the patrol stays silent.
        const { rows } = await classified();
        console.log(rows.filter(d => ACTIONABLE.has(d._lc)).length);
        return;
      }
      default:
        console.log('commands: today | chase | cold [all] | board [n] | company <name> | stage <s> | get <deal_key> | count | pending  (urgent/stalled = raw engine)');
    }
  } catch (e) { die(e.message); }
})();
