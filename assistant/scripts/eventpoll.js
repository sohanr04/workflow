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
const { getToken, BOXES, graph } = require('./graph');
const { core, supplierCodeIn } = require('./prices');

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

// ── SUPPLIER-side watcher (the other half) ───────────────────────────────────
// Buyer replies land in buyer_events. SUPPLIER emails (Scott/Cherry saying "sold",
// a price, a counter) do NOT — they arrive in spr@/china@ under the SP/GBT code.
// This polls those boxes, maps the code → the DIS deal by shared core, and flags
// KILLs ("sold", "no stock") so a factory killing stock fires instantly instead
// of waiting for Sohan to tell Winston.
const SUP_DOMAINS = new Set(['stockpapa.cn', 'gbestgarment.com', 'tailormax.com', 'bentagarment.com', 'wintopstock.com', 'royalgarment.cn', 'wellroyalgarment.com', 'hpromise.cn', 'yeletrading.com']);
const isSupplierAddr = (a) => { const d = String(a || '').toLowerCase().split('@')[1] || ''; return d && (SUP_DOMAINS.has(d) || d.endsWith('.cn')); };
// plain \bsold\b catches "Sold," / "is sold" / "been sold"; no trailing \b (it
// breaks after a comma). Supplier "sold" ≈ always a kill; Winston verifies the thread.
const SUP_KILL = /\bsold\b|sold\s?out|stock (is )?gone|no (more )?stock|out of stock|cancell?ed|cannot supply|not available|no longer available/i;

function openRefsFrom(bookFile) {
  try { const b = JSON.parse(fs.readFileSync(bookFile, 'utf8')); return Object.entries(b.deals || {}).filter(([, d]) => !d.closed).map(([r]) => r); }
  catch { return []; }
}

// new supplier emails since `sinceISO` mapped to a tracked DIS deal, oldest first
async function newSupplierEvents(sinceISO, bookFile) {
  const openRefs = openRefsFrom(bookFile);
  const byCore = new Map(); for (const r of openRefs) byCore.set(core(r), r);
  const tok = await getToken();
  const out = [];
  for (const box of [BOXES.spr, BOXES.china].filter(Boolean)) {
    let j;
    try { j = await graph(`/users/${box}/messages?$select=subject,from,receivedDateTime,bodyPreview&$top=30&$orderby=receivedDateTime desc`, tok); }
    catch { continue; }
    for (const m of j.value || []) {
      if (!m.receivedDateTime || m.receivedDateTime <= sinceISO) continue;
      const from = m.from?.emailAddress?.address || '';
      if (!isSupplierAddr(from)) continue;
      const code = supplierCodeIn(m.subject || '', null);
      if (!code) continue;
      const dis = byCore.get(core(code));
      if (!dis) continue; // supplier email for a deal we're not tracking → skip
      const text = `${m.subject || ''} ${m.bodyPreview || ''}`;
      out.push({ ref: dis, supplierCode: code, from, snippet: (m.bodyPreview || '').replace(/\s+/g, ' ').trim().slice(0, 200), kill: SUP_KILL.test(text), at: m.receivedDateTime });
    }
  }
  // de-dupe (spr + china may both hold it) by ref+at
  const seen = new Set();
  return out.filter((e) => { const k = e.ref + '|' + e.at; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.at || '').localeCompare(b.at || ''));
}

// start the poll loop. `source(sinceISO)` → events with `.at`; onEvent(ev) → the
// gateway spawns a Winston turn + sends. Used for BOTH buyer and supplier watchers.
function startEventPoller({ intervalMs = 60000, stateFile, source, onEvent, log = console.log, label = 'event-poller' }) {
  const readCk = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).since || null; } catch { return null; } };
  const writeCk = (iso) => { try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ since: iso })); } catch { /* best effort */ } };
  let since = readCk();
  if (!since) { since = new Date().toISOString(); writeCk(since); log(`${label}: first run — watching after ${since} (backlog skipped)`); }
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const evs = await source(since);
      for (const ev of evs) {
        try { await onEvent(ev); } catch (e) { log(`${label}: handler failed for ` + ev.ref + ': ' + (e.message || '').slice(0, 60)); }
        if (ev.at > since) { since = ev.at; writeCk(since); } // advance only past handled events
      }
      if (evs.length) log(`${label}: fired ${evs.length} update(s)`);
    } catch (e) { log(`${label}: tick failed — ` + (e.message || '').slice(0, 80)); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(timer);
}

module.exports = { newBuyerEvents, newSupplierEvents, startEventPoller, extractRef };

// ── CLI dry-run — prints what it WOULD fire, sends nothing ───────────────────
//   node eventpoll.js --since <iso>              # buyer replies
//   node eventpoll.js --supplier <bookFile> [--since <iso>]  # supplier emails
if (require.main === module) {
  const i = process.argv.indexOf('--since');
  const since = i >= 0 ? process.argv[i + 1] : new Date(Date.now() - 2 * 864e5).toISOString();
  const si = process.argv.indexOf('--supplier');
  if (si >= 0) {
    newSupplierEvents(since, process.argv[si + 1] || path.join(process.cwd(), 'memory', 'book.json')).then((evs) => {
      console.log(`# DRY-RUN (supplier) — ${evs.length} supplier email(s) since ${since} mapped to a tracked deal:\n`);
      for (const e of evs) console.log(`  ${e.at.slice(0, 16)} · ${e.supplierCode} → ${e.ref} · ${e.from}${e.kill ? ' · ⚠️KILL' : ''} · "${e.snippet.slice(0, 70)}"`);
    }).catch((e) => { console.error('dry-run failed:', e.message); process.exit(1); });
    return;
  }
  newBuyerEvents(since, 30).then((evs) => {
    console.log(`# DRY-RUN — ${evs.length} buyer repl${evs.length === 1 ? 'y' : 'ies'} since ${since} (would each fire an instant Winston update):\n`);
    for (const e of evs) console.log(`  ${e.at.slice(0, 16)} · ${e.ref} · ${e.buyer} · [${e.replyType}] "${e.snippet.slice(0, 80)}"`);
  }).catch((e) => { console.error('dry-run failed:', e.message); process.exit(1); });
}
