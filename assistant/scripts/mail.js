#!/usr/bin/env node
'use strict';

/**
 * mail.js — Winston's RELIABLE mail feed, read from the relay's Supabase.
 *
 * Why this exists: graph.js reads Outlook directly via Microsoft Graph, which
 * intermittently times out from the Air (the network can't reach Microsoft's
 * endpoints — the relay works only because it runs on Railway). The relay
 * already ingests every email reliably and writes the buyer replies into
 * Supabase (`buyer_events`), which IS reachable. So Winston reads the relay's
 * work instead of re-fetching from Microsoft himself. Same data, a road that's
 * actually open.
 *
 * This is his PRIMARY ingestion feed. graph.js stays as the richer fallback
 * (full multi-box threads) for when Microsoft is reachable.
 *
 * Creds self-source from the relay .env.local (same as deals.js).
 *
 * Usage (from profiles/sohan/):
 *   node ../../scripts/mail.js recent [n]     # recent real buyer replies — the deal signal
 *   node ../../scripts/mail.js since <hours>  # replies in the last N hours (patrol: what's new)
 *   node ../../scripts/mail.js thread <ref>   # one deal's buyer-side history from Supabase
 *   node ../../scripts/mail.js company <name>
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { retryFetch } = require('./_net');

function relay(k) {
  for (const p of [
    process.env.RELAY_ENV_PATH,
    path.join(os.homedir(), 'Projects/grand-empire-stock-deals/.env.local'),
    path.join(os.homedir(), 'Projects/grand-empire-stock-inventory-matching/.env.local'),
  ].filter(Boolean)) {
    try { const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + k + '=(.*)$', 'm')); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); } catch { /* next */ }
  }
}
const URL = (process.env.SUPABASE_URL || relay('SUPABASE_URL') || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || relay('SUPABASE_SERVICE_ROLE_KEY');
const die = (m) => { console.error('mail.js: ' + m); process.exit(1); };

// Real buyer replies only — reply_type buy|question is an actual person biting
// on an offer (the deal-birth / deal-moved signal). Ignore blasts (no reply).
const REPLIED = 'reply_type=in.(buy,question)&reply_at=not.is.null';
const COLS = 'buyer_email,buyer_name,company,offer_subject,normalized_subject,categories,supplier_price,sent_at,reply_type,reply_at,reply_text';

async function q(qs) {
  if (!URL || !KEY) die('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (self-sourced from the relay .env.local)');
  let res;
  try { res = await retryFetch(`${URL}/rest/v1/buyer_events?${qs}`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }); }
  catch (e) { die(`Supabase query failed: ${e.message}${e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''}`); }
  if (!res.ok) die(`Supabase HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const ago = (iso) => { const h = (Date.now() - new Date(iso).getTime()) / 3.6e6; return h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`; };
function show(e) {
  const who = e.buyer_name || e.buyer_email || '?';
  const co = e.company ? ` (${e.company})` : '';
  const cost = e.supplier_price ? ` · our cost ${e.supplier_price}` : '';
  console.log(`\n▶ ${String(e.reply_at).slice(0, 16)} · ${ago(e.reply_at)} ago · [${e.reply_type}] ${who}${co}`);
  console.log(`  offer: ${clean(e.offer_subject) || clean(e.normalized_subject)}${cost}`);
  const t = clean(e.reply_text);
  if (t) console.log(`  they said: ${t.slice(0, 300)}${t.length > 300 ? '…' : ''}`);
}

(async () => {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'recent') {
    const n = parseInt(a[0], 10) || 15;
    const rows = await q(`${REPLIED}&select=${COLS}&order=reply_at.desc&limit=${n}`);
    console.log(`# RECENT BUYER REPLIES — ${rows.length} (the relay's live feed, newest first)`);
    rows.forEach(show);
  } else if (cmd === 'since') {
    const hrs = parseInt(a[0], 10) || 24;
    const cut = new Date(Date.now() - hrs * 3.6e6).toISOString();
    const rows = await q(`${REPLIED}&reply_at=gte.${cut}&select=${COLS}&order=reply_at.desc&limit=100`);
    console.log(`# NEW BUYER REPLIES in the last ${hrs}h — ${rows.length}`);
    rows.forEach(show);
  } else if (cmd === 'thread') {
    if (!a[0]) die('usage: thread <ref/style>');
    const ref = encodeURIComponent(a.join(' '));
    const rows = await q(`or=(offer_subject.ilike.*${ref}*,normalized_subject.ilike.*${ref}*)&select=${COLS}&order=reply_at.desc.nullslast&limit=40`);
    if (!rows.length) { console.log(`# no buyer events matching "${a.join(' ')}" in Supabase — try graph.js thread (Outlook) if Microsoft is reachable`); return; }
    console.log(`# BUYER-SIDE HISTORY ~ "${a.join(' ')}" — ${rows.length} (from the relay's ingest)`);
    rows.filter((e) => e.reply_at).reverse().forEach(show);
  } else if (cmd === 'company') {
    if (!a[0]) die('usage: company <name>');
    const rows = await q(`${REPLIED}&company=ilike.*${encodeURIComponent(a[0])}*&select=${COLS}&order=reply_at.desc&limit=40`);
    console.log(`# ${rows.length} replies ~ company "${a[0]}"`);
    rows.forEach(show);
  } else {
    console.log('mail.js (relay Supabase feed) — commands: recent [n] | since <hours> | thread <ref> | company <name>');
  }
})().catch((e) => die(e.message));
