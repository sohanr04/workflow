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
const COLS = 'deal_key,stage,current_leg,ball_in_court,last_actor,silent_hours,is_urgent,is_stalled,negotiation_rounds,buyer_email,buyer_name,company,supplier_name,supplier_domain,style,qty,offer_subject,intent,opened_at';

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
function line(d) {
  const flag = d.is_urgent ? '🔴URGENT' : d.is_stalled ? '🟡stalled' : '·';
  const h = d.silent_hours != null ? `${Math.round(d.silent_hours)}h` : '?';
  const who = d.company || d.buyer_name || d.buyer_email || '?';
  const leg = d.ball_in_court ? `ball=${d.ball_in_court}` : '';
  return `${flag}  ${(d.stage || '?').padEnd(11)} ${leg.padEnd(12)} ${h.padStart(5)}  ${who} — ${subjOf(d)}`;
}

async function list(qs, title) {
  const rows = await q(`${qs}&select=${COLS}`);
  console.log(`# ${title} — ${rows.length}`);
  for (const d of rows) console.log(line(d));
}

(async () => {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    switch (cmd) {
      case 'today':
      case 'mine':
        return await list(`${LIVE}&ball_in_court=eq.us&order=is_urgent.desc,silent_hours.desc&limit=60`, 'BALL ON US (work queue)');
      case 'urgent':
        return await list(`${LIVE}&is_urgent=eq.true&order=silent_hours.desc&limit=60`, 'URGENT (ball on us, past clock)');
      case 'stalled':
        return await list(`${LIVE}&is_stalled=eq.true&order=silent_hours.desc&limit=60`, 'STALLED (waiting on them, past threshold)');
      case 'board': {
        const n = parseInt(a[0], 10) || 40;
        return await list(`${LIVE}&order=is_urgent.desc,is_stalled.desc,silent_hours.desc&limit=${n}`, 'LIVE BOARD (hottest first)');
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
        return console.log(JSON.stringify(rows[0], null, 2));
      }
      case 'count': {
        const rows = await q(`${LIVE}&select=stage`);
        const by = {};
        for (const d of rows) by[d.stage] = (by[d.stage] || 0) + 1;
        console.log(`# ${rows.length} live deals`);
        for (const s of Object.keys(by).sort()) console.log(`${String(by[s]).padStart(4)}  ${s}`);
        return;
      }
      case 'pending': {
        // Bare integer = the heartbeat GATE signal: FRESH, ball-on-us, urgent
        // deals inside the actionable window (silent < 14d). Prints only a
        // number so the gate can't be fooled by digits inside deal codes.
        const maxH = parseInt(a[0], 10) || 336; // 14 days
        const rows = await q(`${LIVE}&ball_in_court=eq.us&is_urgent=eq.true&silent_hours=lt.${maxH}&select=deal_key`);
        console.log(rows.length);
        return;
      }
      default:
        console.log('commands: today | urgent | stalled | board [n] | company <name> | stage <s> | get <deal_key> | count | pending');
    }
  } catch (e) { die(e.message); }
})();
