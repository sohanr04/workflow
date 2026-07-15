#!/usr/bin/env node
'use strict';

/**
 * dealsheet.js — Winston's Excel ledger of EVERY deal he tracks.
 *
 * Pulls the whole board, classifies each deal's real lifecycle (shared
 * lifecycle.js), and writes a clean .xlsx: one row per deal, sorted hottest
 * first, with a colour-coded health column and a summary header. Winston
 * refreshes it on each patrol / brief so there's always a live master sheet
 * Sohan (or the team) can open.
 *
 * Usage (from profiles/sohan/):
 *   node ../../scripts/dealsheet.js                 # → memory/GE-Deals.xlsx
 *   node ../../scripts/dealsheet.js ~/Downloads/GE-Deals.xlsx
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { retryFetch } = require('./_net');
const { themSilentHours, lifecycle, LC_TAG, LC_ORDER } = require('./lifecycle');

function fromRelayEnv(key) {
  const home = os.homedir();
  const paths = [
    process.env.RELAY_ENV_PATH,
    path.join(home, 'Projects/grand-empire-stock-deals/.env.local'),
    path.join(home, 'Projects/grand-empire-stock-inventory-matching/.env.local'),
  ].filter(Boolean);
  for (const p of paths) {
    try { const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm')); if (m) return m[1].trim().replace(/^["']|["']$/g, ''); } catch { /* next */ }
  }
  return undefined;
}
const URL = (process.env.SUPABASE_URL || fromRelayEnv('SUPABASE_URL') || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fromRelayEnv('SUPABASE_SERVICE_ROLE_KEY');
const die = (m) => { console.error('dealsheet.js: ' + m); process.exit(1); };

const COLS = 'deal_key,stage,current_leg,ball_in_court,silent_hours,is_urgent,is_stalled,negotiation_rounds,buyer_email,buyer_name,company,supplier_name,supplier_price,supplier_domain,style,qty,offer_subject,intent,opened_at,buyer_side,factory_side';

async function board() {
  if (!URL || !KEY) die('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (self-sourced from the relay .env.local)');
  const res = await retryFetch(`${URL}/rest/v1/deals?select=${COLS}&limit=2000`, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  if (!res.ok) die(`board query HTTP ${res.status}`);
  return res.json();
}

const HEALTH_FILL = { hot: 'FFFCE9D6', aging: 'FFF6E7CE', chase_due: 'FFFBF3D2', waiting: 'FFE7F0E4', cold: 'FFEDEAE4', dormant: 'FFE4E0DA', won: 'FFDDEBDD', dropped: 'FFEFE1DE' };
const fmtSilent = (h) => h == null ? '' : (h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
const subjOf = (d) => d.offer_subject || (d.deal_key || '').split('::').slice(1).join('::') || d.deal_key;

async function main() {
  const out = path.resolve(process.argv[2] || path.join(process.cwd(), 'memory', 'GE-Deals.xlsx'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const nowMs = Date.now();
  const rows = (await board()).map((d) => ({ d, lc: lifecycle(d, nowMs), ts: themSilentHours(d, nowMs) }));
  rows.sort((a, b) => LC_ORDER.indexOf(a.lc) - LC_ORDER.indexOf(b.lc) || (a.ts ?? 0) - (b.ts ?? 0));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Winston'; wb.created = new Date(nowMs);
  const ws = wb.addWorksheet('Deals', { views: [{ state: 'frozen', ySplit: 3 }] });

  // title + summary
  const live = rows.filter((r) => !['dropped', 'won'].includes(r.lc));
  const act = live.filter((r) => ['hot', 'aging', 'chase_due'].includes(r.lc)).length;
  const dead = live.filter((r) => ['cold', 'dormant'].includes(r.lc)).length;
  ws.mergeCells('A1:N1');
  ws.getCell('A1').value = `Grand Empire — Deal Ledger`;
  ws.getCell('A1').font = { size: 15, bold: true, name: 'Georgia' };
  ws.mergeCells('A2:N2');
  ws.getCell('A2').value = `${live.length} live · ${act} actionable · ${dead} cold/dead · updated ${new Date(nowMs).toLocaleString()}`;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF8B8175' } };

  const headers = ['Health', 'Ref', 'Product', 'Qty', 'Buyer', 'Company', 'Supplier', 'Stage', 'Ball', 'Silent', 'Supplier $', 'Rounds', 'Opened', 'Deal key'];
  const hr = ws.addRow(headers);
  hr.font = { bold: true, size: 10 }; hr.alignment = { vertical: 'middle' };
  hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE7DC' } }; c.border = { bottom: { style: 'thin', color: { argb: 'FFD6CDBD' } } }; });

  for (const { d, lc, ts } of rows) {
    const r = ws.addRow([
      LC_TAG[lc] || lc,
      (subjOf(d).match(/\b(?:DIS|GBT|SP|KG)[0-9-]+/i) || [''])[0] || '',
      subjOf(d).replace(/\s*·.*$/, '').slice(0, 60),
      d.qty || '',
      d.buyer_name || d.buyer_email || '',
      d.company || '',
      d.supplier_name || '',
      d.stage || '',
      d.ball_in_court || '',
      fmtSilent(ts),
      d.supplier_price || '',
      d.negotiation_rounds || 0,
      d.opened_at ? new Date(d.opened_at).toLocaleDateString() : '',
      d.deal_key || '',
    ]);
    const fill = HEALTH_FILL[lc];
    if (fill) r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    r.getCell(1).font = { size: 10, bold: ['hot', 'aging', 'chase_due'].includes(lc) };
    r.alignment = { vertical: 'middle' };
  }

  ws.columns = [
    { width: 11 }, { width: 15 }, { width: 40 }, { width: 9 }, { width: 20 }, { width: 18 },
    { width: 18 }, { width: 13 }, { width: 10 }, { width: 8 }, { width: 11 }, { width: 8 }, { width: 12 }, { width: 30 },
  ];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } };

  await wb.xlsx.writeFile(out);
  console.log(`wrote ${rows.length} deals → ${out}  (${act} actionable, ${dead} cold/dead)`);
}
main().catch((e) => die(e.message));
