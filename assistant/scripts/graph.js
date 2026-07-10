#!/usr/bin/env node
'use strict';

/**
 * graph.js — Winston's read-only Outlook reader (app-only, no login).
 *
 * Uses the company's Microsoft Graph app registration (the SAME one the
 * stock relay uses) with client-credentials auth. That app holds an
 * APPLICATION Mail.Read permission, so this reads ANY grand-empire mailbox
 * with no interactive sign-in, no token that expires on the user — exactly
 * like the relay does. READ ONLY: there is no send/delete/modify command
 * here by design.
 *
 * Creds (put in assistant/.env — reuse the relay's values, never commit):
 *   MS_GRAPH_CLIENT_ID, MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_SECRET
 *
 * The 3 mailboxes Winston watches:
 *   spr    = spr@grandempirehk.com              (the human deal desk)
 *   china  = empire-chinastocks@grandempirehk.com  (supplier offers in)
 *   dis    = empire-districtstock@grandempirehk.com (relay outbound / buyers)
 *
 * Usage:
 *   node ../../scripts/graph.js boxes
 *   node ../../scripts/graph.js recent <box> [n]
 *   node ../../scripts/graph.js search <box> "<KQL query>" [n]
 *   node ../../scripts/graph.js thread <style-code>      # across ALL 3 boxes
 *   node ../../scripts/graph.js get <box> <messageId>
 *
 * <box> is spr | china | dis (or a full mailbox address).
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const BOXES = {
  spr: 'spr@grandempirehk.com',
  china: 'empire-chinastocks@grandempirehk.com',
  dis: 'empire-districtstock@grandempirehk.com',
};

// Creds: prefer env (assistant/.env). If absent, self-source them from the
// relay's .env.local — it's on the same machine and holds the same MS_GRAPH_*
// values, so Winston works with ZERO manual .env setup (just git pull +
// restart). Never writes/copies the secret anywhere; reads it in-memory only.
function fromRelayEnv(key) {
  const home = os.homedir();
  const paths = [
    process.env.RELAY_ENV_PATH,
    path.join(home, 'Projects/grand-empire-stock-inventory-matching/.env.local'),
    path.join(home, 'workflow/../grand-empire-stock-inventory-matching/.env.local'),
    path.join(home, 'grand-empire-stock-inventory-matching/.env.local'),
  ].filter(Boolean);
  for (const p of paths) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* try next */ }
  }
  return undefined;
}
const CID = process.env.MS_GRAPH_CLIENT_ID || process.env.MS365_MCP_CLIENT_ID || fromRelayEnv('MS_GRAPH_CLIENT_ID');
const TID = process.env.MS_GRAPH_TENANT_ID || process.env.MS365_MCP_TENANT_ID || fromRelayEnv('MS_GRAPH_TENANT_ID');
const SECRET = process.env.MS_GRAPH_CLIENT_SECRET || process.env.MS365_MCP_CLIENT_SECRET || fromRelayEnv('MS_GRAPH_CLIENT_SECRET');

function die(msg) { console.error('graph.js: ' + msg); process.exit(1); }
function resolveBox(b) {
  if (!b) die('missing mailbox (spr | china | dis)');
  return BOXES[b] || (b.includes('@') ? b : die(`unknown mailbox "${b}" (use spr|china|dis or a full address)`));
}

async function getToken() {
  if (!CID || !TID || !SECRET) {
    die('missing creds — set MS_GRAPH_CLIENT_ID / MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_SECRET in assistant/.env (same values as the relay)');
  }
  const cache = path.join(os.tmpdir(), 'winston-graph-token.json');
  try {
    const c = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (c.exp > Date.now() + 60000 && c.cid === CID) return c.tok;
  } catch { /* no cache */ }
  const res = await fetch(`https://login.microsoftonline.com/${TID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CID, client_secret: SECRET,
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    }),
  });
  const j = await res.json();
  if (!j.access_token) die('token request failed: ' + JSON.stringify(j).slice(0, 300));
  try { fs.writeFileSync(cache, JSON.stringify({ tok: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000, cid: CID })); } catch { /* ignore */ }
  return j.access_token;
}

async function graph(pathAndQuery, token) {
  const res = await fetch('https://graph.microsoft.com/v1.0' + pathAndQuery, {
    headers: { Authorization: 'Bearer ' + token, ConsistencyLevel: 'eventual' },
  });
  const j = await res.json();
  if (j.error) die(`graph error (${res.status}): ${j.error.code} — ${j.error.message}`);
  return j;
}

const line = (m) => `${(m.receivedDateTime || '').slice(0, 16).replace('T', ' ')} | ${((m.from && m.from.emailAddress && m.from.emailAddress.address) || '?').padEnd(28)} | ${m.subject || '(no subject)'}`;

async function recent(box, n) {
  const mb = resolveBox(box); const tok = await getToken();
  const j = await graph(`/users/${mb}/messages?$select=subject,from,receivedDateTime,bodyPreview&$top=${n || 15}`, tok);
  console.log(`# ${mb} — ${(j.value || []).length} recent`);
  for (const m of j.value || []) console.log(line(m));
}

async function search(box, q, n) {
  const mb = resolveBox(box); const tok = await getToken();
  const j = await graph(`/users/${mb}/messages?$search=${encodeURIComponent('"' + q + '"')}&$select=subject,from,receivedDateTime,bodyPreview&$top=${n || 25}`, tok);
  console.log(`# ${mb} — search "${q}" — ${(j.value || []).length} hits`);
  for (const m of j.value || []) console.log(line(m));
}

// The deal-tracking primitive: pull a style code across ALL 3 boxes, sorted in time.
async function thread(code) {
  if (!code) die('missing style code, e.g. SP80499 or DIS-80553');
  const tok = await getToken();
  const rows = [];
  for (const [key, mb] of Object.entries(BOXES)) {
    const j = await graph(`/users/${mb}/messages?$search=${encodeURIComponent('"' + code + '"')}&$select=subject,from,receivedDateTime,bodyPreview&$top=50`, tok);
    for (const m of j.value || []) rows.push({ box: key, ...m });
  }
  rows.sort((a, b) => (a.receivedDateTime || '').localeCompare(b.receivedDateTime || ''));
  console.log(`# thread "${code}" across all boxes — ${rows.length} messages (oldest first)`);
  for (const m of rows) {
    const who = (m.from && m.from.emailAddress && m.from.emailAddress.address) || '?';
    console.log(`${(m.receivedDateTime || '').slice(0, 16).replace('T', ' ')} [${m.box}] ${who}\n    ${m.subject}\n    ${(m.bodyPreview || '').replace(/\s+/g, ' ').slice(0, 160)}`);
  }
}

async function get(box, id) {
  const mb = resolveBox(box); if (!id) die('missing messageId'); const tok = await getToken();
  const m = await graph(`/users/${mb}/messages/${id}?$select=subject,from,toRecipients,receivedDateTime,body`, tok);
  const to = (m.toRecipients || []).map((r) => r.emailAddress.address).join(', ');
  console.log(`Subject: ${m.subject}\nFrom: ${m.from && m.from.emailAddress.address}\nTo: ${to}\nDate: ${m.receivedDateTime}\n---`);
  console.log((m.body && m.body.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, 4000));
}

(async () => {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    if (cmd === 'boxes') { console.log(Object.entries(BOXES).map(([k, v]) => `${k.padEnd(6)} ${v}`).join('\n')); return; }
    if (cmd === 'recent') return await recent(a[0], parseInt(a[1], 10));
    if (cmd === 'search') return await search(a[0], a[1], parseInt(a[2], 10));
    if (cmd === 'thread') return await thread(a[0]);
    if (cmd === 'get') return await get(a[0], a[1]);
    console.log('commands: boxes | recent <box> [n] | search <box> "<q>" [n] | thread <code> | get <box> <id>\nboxes: spr | china | dis');
  } catch (e) { die(e.message); }
})();
