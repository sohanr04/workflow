#!/usr/bin/env node
'use strict';

/**
 * Personal assistant gateway: Telegram <-> Claude Code (headless).
 *
 * One process per person. Each profile gets its own Telegram bot, persona
 * (CLAUDE.md), memory files, and session state.
 *
 *   node gateway.js <profile>        e.g. node gateway.js sohan
 *
 * Requires: Node 18+, Claude Code CLI installed and logged in (`claude login`).
 * Zero npm dependencies.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const ROOT = __dirname;
const profileName = process.argv[2];
if (!profileName) {
  console.error('Usage: node gateway.js <profile>   (a directory under profiles/)');
  process.exit(1);
}

const profileDir = path.join(ROOT, 'profiles', profileName);
const profilePath = path.join(profileDir, 'profile.json');
if (!fs.existsSync(profilePath)) {
  console.error(`No profile found at ${profilePath}`);
  process.exit(1);
}
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

// Load .env (repo-level) without any dependency. Existing env vars win.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv(path.join(ROOT, '.env'));

const token = process.env[profile.botTokenEnv];
if (!token) {
  console.error(`Missing bot token: set ${profile.botTokenEnv} in assistant/.env`);
  process.exit(1);
}
// Overridable for tests (test/e2e.js points this at a local mock).
const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const API = `${API_BASE}/bot${token}`;

// Per-chat Claude session ids so conversations have continuity.
const stateDir = path.join(profileDir, 'state');
fs.mkdirSync(stateDir, { recursive: true });
const sessionsFile = path.join(stateDir, 'sessions.json');
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8')); } catch { /* fresh start */ }
const saveSessions = () =>
  fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));

const log = (...args) =>
  console.log(new Date().toISOString(), `[${profileName}]`, ...args);

// Optional per-profile MCP servers (e.g. Gmail): if profiles/<p>/mcp.json
// exists it's passed to claude, and its servers are auto-allowlisted.
const mcpConfigPath = path.join(profileDir, 'mcp.json');
let mcpToolAllow = [];
if (fs.existsSync(mcpConfigPath)) {
  try {
    const servers = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8')).mcpServers || {};
    mcpToolAllow = Object.keys(servers).map((n) => `mcp__${n}`);
    log('mcp servers enabled:', Object.keys(servers).join(', ') || '(none)');
  } catch (e) {
    log('WARNING: could not parse mcp.json, skipping it:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Telegram helpers
// ---------------------------------------------------------------------------

async function tg(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description}`);
  return data.result;
}

// Telegram messages cap at 4096 chars; send as plain text (Claude's markdown
// often has unbalanced entities that break Telegram's parsers).
async function send(chatId, text) {
  const body = text && text.trim() ? text : '(no response)';
  for (let i = 0; i < body.length; i += 4000) {
    await tg('sendMessage', { chat_id: chatId, text: body.slice(i, i + 4000) });
  }
}

// Keep the "typing..." indicator alive while Claude thinks.
function typing(chatId) {
  const tick = () => tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  tick();
  const timer = setInterval(tick, 5000);
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------
// Claude Code (headless)
// ---------------------------------------------------------------------------

function runClaude(userText, sessionId) {
  return new Promise((resolve) => {
    const args = [
      '-p', userText,
      '--output-format', 'json',
      '--permission-mode', profile.permissionMode || 'acceptEdits',
    ];
    const allowedTools = [...(profile.allowedTools || []), ...mcpToolAllow];
    if (allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
    if (mcpToolAllow.length) args.push('--mcp-config', mcpConfigPath);
    if (profile.model) args.push('--model', profile.model);
    if (sessionId) args.push('--resume', sessionId);

    // cwd = profile dir, so this person's CLAUDE.md (persona + memory) loads.
    const child = spawn(profile.claudeBin || 'claude', args, {
      cwd: profileDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, (profile.timeoutSeconds || 300) * 1000);

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `failed to launch claude: ${e.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(out);
        if (data.is_error) {
          resolve({ ok: false, error: data.result || 'claude returned an error' });
        } else {
          resolve({ ok: true, text: data.result, sessionId: data.session_id });
        }
      } catch {
        resolve({
          ok: false,
          error: `claude exited (${code}): ${(err || out || 'no output').slice(0, 500)}`,
        });
      }
    });
  });
}

async function ask(chatId, userText) {
  const prior = sessions[chatId];
  let res = await runClaude(userText, prior);
  // A stale/expired session id makes --resume fail; retry once fresh.
  if (!res.ok && prior) {
    log(`resume failed for chat ${chatId}, retrying fresh:`, res.error);
    delete sessions[chatId];
    saveSessions();
    res = await runClaude(userText, undefined);
  }
  if (res.ok && res.sessionId) {
    sessions[chatId] = res.sessionId;
    saveSessions();
  }
  return res;
}

// ---------------------------------------------------------------------------
// Proactive: reminders + scheduled prompts (morning briefing, weekly review)
// ---------------------------------------------------------------------------

// In a Telegram DM, chat id == user id, so the first allowlisted user is
// where proactive messages go.
const ownerChatId = () => (profile.allowedUserIds || [])[0];

// The assistant sets reminders by writing profiles/<p>/reminders.json:
//   [{"when": "2026-07-08T09:00", "text": "Call the bank", "repeat": "none"}]
// "when" is laptop-local time; repeat is "none" | "daily" | "weekly".
const remindersFile = path.join(profileDir, 'reminders.json');

const toLocalISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
  `${String(d.getDate()).padStart(2, '0')}T` +
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function checkReminders() {
  const chatId = ownerChatId();
  if (!chatId || !fs.existsSync(remindersFile)) return;
  let items;
  try { items = JSON.parse(fs.readFileSync(remindersFile, 'utf8')); } catch { return; }
  if (!Array.isArray(items)) return;

  const now = new Date();
  let changed = false;
  const keep = [];
  for (const r of items) {
    const due = new Date(r.when);
    if (isNaN(due) || due > now) { keep.push(r); continue; }
    send(chatId, `⏰ ${r.text}`).catch((e) => log('reminder send failed:', e.message));
    changed = true;
    if (r.repeat === 'daily' || r.repeat === 'weekly') {
      const next = new Date(due);
      do {
        next.setDate(next.getDate() + (r.repeat === 'daily' ? 1 : 7));
      } while (next <= now);
      keep.push({ ...r, when: toLocalISO(next) });
    }
  }
  if (changed) fs.writeFileSync(remindersFile, JSON.stringify(keep, null, 2));
}

// profile.json "scheduled": [{"time": "07:30", "days": ["sun"], "prompt": "..."}]
// Times are laptop-local; omit "days" for every day. Each run is a fresh
// Claude session (persona + memory still load via CLAUDE.md).
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
let lastScheduleMinute = '';

function checkSchedules() {
  const chatId = ownerChatId();
  const scheduled = profile.scheduled || [];
  if (!chatId || !scheduled.length) return;

  const now = new Date();
  const hhmm =
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const minuteStamp = `${now.toDateString()} ${hhmm}`;
  if (minuteStamp === lastScheduleMinute) return; // fire at most once per minute
  lastScheduleMinute = minuteStamp;

  for (const s of scheduled) {
    if (s.time !== hhmm) continue;
    if (Array.isArray(s.days) &&
        !s.days.map((d) => String(d).toLowerCase().slice(0, 3)).includes(DAY_NAMES[now.getDay()])) {
      continue;
    }
    log('firing scheduled prompt at', s.time);
    enqueue(chatId, async () => {
      const stopTyping = typing(chatId);
      try {
        const res = await runClaude(s.prompt, undefined);
        await send(chatId, res.ok ? res.text : `Scheduled task failed: ${res.error}`);
      } finally {
        stopTyping();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

// One message at a time per chat; extras queue up in order.
const queues = new Map();

function enqueue(chatId, fn) {
  const prev = queues.get(chatId) || Promise.resolve();
  const next = prev.then(fn).catch((e) => log('handler error:', e.message));
  queues.set(chatId, next);
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const fromId = msg.from && msg.from.id;
  const text = (msg.text || '').trim();
  if (!text) return;

  const allowed = profile.allowedUserIds || [];
  if (allowed.length === 0) {
    // Setup mode: tell the owner their id so they can allowlist themselves.
    await send(
      chatId,
      `Hey! I'm not activated yet. Your Telegram user id is ${fromId}.\n\n` +
      `Add it to "allowedUserIds" in profiles/${profileName}/profile.json and restart me.`
    );
    return;
  }
  if (!allowed.includes(fromId)) {
    log(`ignoring message from unauthorized user ${fromId}`);
    return;
  }

  if (text === '/start' || text === '/help') {
    await send(
      chatId,
      `Hi ${profile.displayName}! I'm your assistant.\n\n` +
      `Just talk to me normally. Commands:\n` +
      `/new — start a fresh conversation\n` +
      `/id — show your Telegram user id`
    );
    return;
  }
  if (text === '/id') {
    await send(chatId, `Your Telegram user id: ${fromId}`);
    return;
  }
  if (text === '/new') {
    delete sessions[chatId];
    saveSessions();
    await send(chatId, 'Fresh start — what’s up?');
    return;
  }

  const stopTyping = typing(chatId);
  try {
    const res = await ask(chatId, text);
    await send(chatId, res.ok ? res.text : `Something went wrong: ${res.error}`);
  } finally {
    stopTyping();
  }
}

// ---------------------------------------------------------------------------
// Long-poll loop
// ---------------------------------------------------------------------------

async function main() {
  const me = await tg('getMe');
  log(`gateway up for ${profile.displayName} — bot @${me.username}`);
  if ((profile.allowedUserIds || []).length === 0) {
    log('SETUP MODE: no allowedUserIds yet. Message the bot to get your id.');
  }

  // Reminders + scheduled check-ins tick every 20s.
  setInterval(() => {
    try {
      checkReminders();
      checkSchedules();
    } catch (e) {
      log('scheduler error:', e.message);
    }
  }, 20000);

  let offset = 0;
  for (;;) {
    try {
      const updates = await tg('getUpdates', {
        offset,
        timeout: 50,
        allowed_updates: ['message'],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) enqueue(u.message.chat.id, () => handleMessage(u.message));
      }
    } catch (e) {
      log('poll error (retrying in 5s):', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
