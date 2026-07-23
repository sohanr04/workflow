'use strict';

/**
 * eventpoll.js — Phase 5: the event poller. "On fire, not every 30 min."
 *
 * The Air can't receive Graph webhooks (no public URL), so instead of waiting
 * for the 30-min patrol, this polls the relay's Supabase `buyer_events` table
 * every ~60s for NEW buyer replies (reply_at past a checkpoint) and hands each
 * one to the gateway, which spawns a scoped Winston turn: read that ONE deal's
 * live thread and text Sohan the context + whose move it is. Not a re-scan of
 * the board — a single-deal update per email.
 *
 * A buyer reply stamps reply_type + reply_text + reply_at onto its buyer_events
 * row (relay lib/buyers.ts recordBuyerReply), so reply_at > checkpoint = new.
 *
 * Safety: first run checkpoints at NOW (never blasts the backlog); the checkpoint
 * only advances past an event after it's handled; a failed handler is logged and
 * skipped (the patrol backstop still catches it) — never a retry-spam loop.
 *
 * CLI dry-run (prints what it WOULD fire, sends nothing):
 *   node eventpoll.js --since 2026-07-22T00:00:00Z
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { retryFetch } = require('./_net');

function relayEnv(k) {
  const home = os.homedir();
  for (const p of [process.env.RELAY_ENV_PATH,
    path.join(home, 'Projects/grand-empire-stock-inventory-matching/.env.local'),
    path.join(home, 'grand-empire-stock-inventory-matching/.env.local')].filter(Boolean)) {
    try { const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); } catch { /* next */ }
  }
}

const extractRef = (s) => {
  const m = String(s || '').match(/\b(?:DIS|GBT|SP|KG)[- ]?\d[\d-]*[A-Z]*/i);
  return m ? m[0].toUpperCase().replace(/\s/g, '') : null;
};

// new buyer replies since `sinceISO` (strictly after), oldest first
async function newBuyerEvents(sinceISO, limit = 15) {
  const URL = (process.env.SUPABASE_URL || relayEnv('SUPABASE_URL') || '').replace(/\/$/, '');
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || relayEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!URL || !KEY) throw new Error('missing Supabase creds');
  const cut = encodeURIComponent(sinceISO);
  const res = await retryFetch(`${URL}/rest/v1/buyer_events?reply_at=gt.${cut}&reply_type=not.is.null&select=offer_subject,normalized_subject,buyer_email,reply_type,reply_text,reply_at&order=reply_at.asc&limit=${limit}`,
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  if (!res.ok) throw new Error('buyer_events HTTP ' + res.status);
  const rows = await res.json();
  return (rows || []).map((r) => ({
    ref: extractRef(r.offer_subject || r.normalized_subject),
    buyer: r.buyer_email || '?',
    replyType: r.reply_type || '',
    snippet: (r.reply_text || '').replace(/\s+/g, ' ').trim().slice(0, 220),
    at: r.reply_at,
  })).filter((e) => e.ref && e.at);
}

// start the poll loop. onEvent(ev) → the gateway spawns a Winston turn + sends.
function startEventPoller({ intervalMs = 60000, stateFile, onEvent, log = console.log }) {
  const readCk = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).since || null; } catch { return null; } };
  const writeCk = (iso) => { try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ since: iso })); } catch { /* best effort */ } };
  let since = readCk();
  if (!since) { since = new Date().toISOString(); writeCk(since); log(`event-poller: first run — watching for replies after ${since} (backlog skipped)`); }
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const evs = await newBuyerEvents(since, 15);
      for (const ev of evs) {
        try { await onEvent(ev); } catch (e) { log('event-poller: handler failed for ' + ev.ref + ': ' + (e.message || '').slice(0, 60)); }
        if (ev.at > since) { since = ev.at; writeCk(since); } // advance only past handled events
      }
      if (evs.length) log(`event-poller: fired ${evs.length} reply update(s)`);
    } catch (e) { log('event-poller: tick failed — ' + (e.message || '').slice(0, 80)); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(timer);
}

module.exports = { newBuyerEvents, startEventPoller, extractRef };

// ── CLI dry-run — prints what it WOULD fire, sends nothing ───────────────────
if (require.main === module) {
  const i = process.argv.indexOf('--since');
  const since = i >= 0 ? process.argv[i + 1] : new Date(Date.now() - 2 * 864e5).toISOString();
  newBuyerEvents(since, 30).then((evs) => {
    console.log(`# DRY-RUN — ${evs.length} buyer repl${evs.length === 1 ? 'y' : 'ies'} since ${since} (would each fire an instant Winston update):\n`);
    for (const e of evs) console.log(`  ${e.at.slice(0, 16)} · ${e.ref} · ${e.buyer} · [${e.replyType}] "${e.snippet.slice(0, 80)}"`);
  }).catch((e) => { console.error('dry-run failed:', e.message); process.exit(1); });
}
