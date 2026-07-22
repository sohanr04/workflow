'use strict';

/**
 * lifecycle.js — the single source of truth for a deal's real state.
 *
 * The engine births deals + tracks legs, but has no concept of natural death:
 * a ball-on-us deal silent for a month still reads is_urgent. We reclassify
 * from the HONEST counterparty clock (how long since the side we're waiting on
 * actually spoke — never our own nudge). Both deals.js (the reader) and
 * dealsheet.js (the Excel ledger) import this so they can never disagree.
 */

const HOT_MAX_H = 72;        // ball on us, they replied < 3d ago → act now
const COLD_MIN_H = 336;      // 14d counterparty silence → likely dead
const DORMANT_MIN_H = 720;   // 30d silence → dead backlog
const WAIT_CUST_H = 48;      // healthy quiet on a buyer
const WAIT_SUP_H = 48;       // healthy quiet on a supplier (Sohan's rule: 2-day window)

// Honest silence = hours since the RELEVANT counterparty last spoke.
// Ball on us → they spoke last, so top-level silent_hours IS honest.
// Ball on them → use the side's them_last_at (our nudges never reset it).
function themSilentHours(d, nowMs) {
  if (d.ball_in_court === 'us') return d.silent_hours;
  const side = d.ball_in_court === 'supplier' ? d.factory_side : d.buyer_side;
  const t = side && side.them_last_at ? new Date(side.them_last_at).getTime() : null;
  return t != null ? Math.round(((nowMs - t) / 3_600_000) * 10) / 10 : d.silent_hours;
}

//   hot / aging  = ball on us, actionable · chase_due = waiting on them, overdue
//   waiting = healthy · cold/dormant = likely dead · dropped/won = closed
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

const ACTIONABLE = new Set(['hot', 'aging', 'chase_due']);
const DEADish = new Set(['cold', 'dormant']);
const LC_TAG = { hot: '🔥hot', aging: '🟠aging', chase_due: '🟡chase', waiting: '🟢wait', cold: '🪦cold', dormant: '💀dormant', dropped: '⚰️dropped', won: '✅won' };
const LC_ORDER = ['hot', 'aging', 'chase_due', 'waiting', 'cold', 'dormant', 'won', 'dropped'];

module.exports = {
  HOT_MAX_H, COLD_MIN_H, DORMANT_MIN_H, WAIT_CUST_H, WAIT_SUP_H,
  themSilentHours, lifecycle, ACTIONABLE, DEADish, LC_TAG, LC_ORDER,
};
