'use strict';

/**
 * Shared core for all channels (Telegram, WhatsApp): profile loading,
 * Claude Code headless runner with session continuity, and the proactive
 * scheduler (reminders + timed prompts). Channels stay thin transports.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Profile + env
// ---------------------------------------------------------------------------

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function loadProfile(rootDir, profileName) {
  if (!profileName) {
    console.error('Usage: node <channel>.js <profile>   (a directory under profiles/)');
    process.exit(1);
  }
  const profileDir = path.join(rootDir, 'profiles', profileName);
  const profilePath = path.join(profileDir, 'profile.json');
  if (!fs.existsSync(profilePath)) {
    console.error(`No profile found at ${profilePath}`);
    process.exit(1);
  }
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  loadEnv(path.join(rootDir, '.env'));
  fs.mkdirSync(path.join(profileDir, 'state'), { recursive: true });
  return { profile, profileDir, profileName };
}

const makeLog = (tag) => (...args) =>
  console.log(new Date().toISOString(), `[${tag}]`, ...args);

// ---------------------------------------------------------------------------
// Claude Code (headless) with per-chat session continuity
// ---------------------------------------------------------------------------

function createClaude({ profile, profileDir, sessionsFileName = 'sessions.json', log = console.log }) {
  const sessionsFile = path.join(profileDir, 'state', sessionsFileName);
  let sessions = {};
  try { sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8')); } catch { /* fresh */ }
  const saveSessions = () =>
    fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));

  // Optional per-profile MCP servers (e.g. Gmail): auto-passed + allowlisted.
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
      // Extra directories the agent may read/write (e.g. ~/.gmail-mcp for
      // OAuth key files). "~" expands to the home directory.
      for (const d of profile.addDirs || []) {
        args.push('--add-dir', d.replace(/^~(?=$|\/)/, os.homedir()));
      }
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

      const timer = setTimeout(() => child.kill('SIGKILL'), (profile.timeoutSeconds || 300) * 1000);

      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, error: `failed to launch claude: ${e.message}` });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(out);
          if (data.is_error) {
            let error = data.result || 'claude returned an error';
            if (/401|invalid.*(auth|api key)|authenticate/i.test(error)) {
              error += ' — fix on this machine: run `claude` then /login with your ' +
                'subscription account, and make sure no stale ANTHROPIC_API_KEY env var is set.';
            }
            resolve({ ok: false, error });
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

  async function ask(chatKey, userText) {
    const prior = sessions[chatKey];
    let res = await runClaude(userText, prior);
    // A stale/expired session id makes --resume fail; retry once fresh.
    if (!res.ok && prior) {
      log(`resume failed for ${chatKey}, retrying fresh:`, res.error);
      delete sessions[chatKey];
      saveSessions();
      res = await runClaude(userText, undefined);
    }
    if (res.ok && res.sessionId) {
      sessions[chatKey] = res.sessionId;
      saveSessions();
    }
    return res;
  }

  function resetSession(chatKey) {
    delete sessions[chatKey];
    saveSessions();
  }

  return { runClaude, ask, resetSession };
}

// ---------------------------------------------------------------------------
// Proactive scheduler: reminders + timed prompts
// ---------------------------------------------------------------------------

const toLocalISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
  `${String(d.getDate()).padStart(2, '0')}T` +
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * sendToOwner(text)    — deliver a reminder ping to the profile owner
 * runScheduled(prompt) — execute a timed prompt and deliver the result
 * Both may be async; failures are logged, never fatal.
 */
function startScheduler({ profile, profileDir, log, sendToOwner, runScheduled }) {
  const remindersFile = path.join(profileDir, 'reminders.json');
  let lastScheduleMinute = '';

  // Heartbeat: profile.json "heartbeat" = {everyMinutes, quietHours, prompt}.
  // Runs the prompt on an interval; the persona decides whether anything
  // deserves an unprompted message and answers HEARTBEAT_OK to stay silent.
  const hb = profile.heartbeat;
  const hbStateFile = path.join(profileDir, 'state', 'heartbeat.json');
  let lastHb = 0;
  try { lastHb = JSON.parse(fs.readFileSync(hbStateFile, 'utf8')).last || 0; } catch { /* first run */ }

  function inQuietHours(now) {
    const [qs, qe] = (hb && hb.quietHours) || ['23:00', '07:30'];
    const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const cur = now.getHours() * 60 + now.getMinutes();
    const s = toMin(qs);
    const e = toMin(qe);
    return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
  }

  function checkHeartbeat() {
    if (!hb || !hb.prompt) return;
    const now = new Date();
    if (Date.now() - lastHb < (hb.everyMinutes || 30) * 60000) return;
    if (inQuietHours(now)) return;
    lastHb = Date.now();
    fs.writeFileSync(hbStateFile, JSON.stringify({ last: lastHb }));
    log('heartbeat patrol');
    Promise.resolve(runScheduled(hb.prompt, { suppressIf: 'HEARTBEAT_OK', silentErrors: true }))
      .catch((e) => log('heartbeat failed:', e.message));
  }

  function checkReminders() {
    if (!fs.existsSync(remindersFile)) return;
    let items;
    try { items = JSON.parse(fs.readFileSync(remindersFile, 'utf8')); } catch { return; }
    if (!Array.isArray(items)) return;

    const now = new Date();
    let changed = false;
    const keep = [];
    for (const r of items) {
      const due = new Date(r.when);
      if (isNaN(due) || due > now) { keep.push(r); continue; }
      Promise.resolve(sendToOwner(`⏰ ${r.text}`))
        .catch((e) => log('reminder send failed:', e.message));
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

  function checkSchedules() {
    const scheduled = profile.scheduled || [];
    if (!scheduled.length) return;

    const now = new Date();
    const hhmm =
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const minuteStamp = `${now.toDateString()} ${hhmm}`;
    if (minuteStamp === lastScheduleMinute) return; // at most once per minute
    lastScheduleMinute = minuteStamp;

    for (const s of scheduled) {
      if (s.time !== hhmm) continue;
      if (Array.isArray(s.days) &&
          !s.days.map((d) => String(d).toLowerCase().slice(0, 3)).includes(DAY_NAMES[now.getDay()])) {
        continue;
      }
      log('firing scheduled prompt at', s.time);
      Promise.resolve(runScheduled(s.prompt))
        .catch((e) => log('scheduled prompt failed:', e.message));
    }
  }

  // Announce what proactive features are armed, so silence is diagnosable.
  if (hb && hb.prompt) {
    log(`heartbeat armed: patrol every ${hb.everyMinutes || 30}m (quiet ${(hb.quietHours || ['23:00','07:30']).join('-')})`);
  } else {
    log('heartbeat NOT configured for this profile');
  }
  log(`${(profile.scheduled || []).length} scheduled check-in(s) loaded`);

  const timer = setInterval(() => {
    try {
      checkReminders();
      checkSchedules();
      checkHeartbeat();
    } catch (e) {
      log('scheduler error:', e.message);
    }
  }, 20000);
  return () => clearInterval(timer);
}

module.exports = { loadEnv, loadProfile, makeLog, createClaude, startScheduler, toLocalISO };
