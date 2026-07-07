#!/usr/bin/env node
'use strict';

/**
 * End-to-end test for gateway.js — no real Telegram, no real Claude.
 *
 * Spins up a mock Telegram API server and a fake `claude` binary, then runs
 * the actual gateway against them and asserts the full pipeline:
 * auth gate, reply flow, session resume, /new reset, and reminders.
 *
 *   node test/e2e.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const OWNER = 111;
const STRANGER = 999;

// --- fixture: temp profile with a fake claude ------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-e2e-'));
const assistantDir = path.join(tmp, 'assistant');
const profileDir = path.join(assistantDir, 'profiles', 'test');
fs.mkdirSync(profileDir, { recursive: true });
fs.copyFileSync(
  path.join(__dirname, '..', 'gateway.js'),
  path.join(assistantDir, 'gateway.js')
);
fs.cpSync(path.join(__dirname, '..', 'lib'), path.join(assistantDir, 'lib'), { recursive: true });

const fakeClaude = path.join(tmp, 'fake-claude');
fs.writeFileSync(
  fakeClaude,
  `#!/usr/bin/env node
'use strict';
const args = process.argv.slice(2);
const text = args[args.indexOf('-p') + 1];
const resumed = args.includes('--resume');
console.log(JSON.stringify({
  type: 'result',
  is_error: false,
  result: (resumed ? 'resumed:' : 'fresh:') + text,
  session_id: 'sess-e2e',
}));
`
);
fs.chmodSync(fakeClaude, 0o755);

fs.writeFileSync(
  path.join(profileDir, 'profile.json'),
  JSON.stringify({
    displayName: 'Test',
    botTokenEnv: 'TELEGRAM_BOT_TOKEN_TEST',
    allowedUserIds: [OWNER],
    claudeBin: fakeClaude,
    timeoutSeconds: 30,
    // Fires on the first scheduler tick; quietHours never match.
    heartbeat: { everyMinutes: 1, quietHours: ['00:00', '00:00'], prompt: 'HB_PATROL' },
  })
);

// A reminder that's already due: should fire on the first scheduler tick.
fs.writeFileSync(
  path.join(profileDir, 'reminders.json'),
  JSON.stringify([{ when: '2020-01-01T00:00', text: 'test reminder', repeat: 'none' }])
);

// --- mock Telegram API ------------------------------------------------------

const pendingUpdates = [];
const sent = []; // every sendMessage the gateway makes
let updateId = 1;

function queueMessage(fromId, text) {
  pendingUpdates.push({
    update_id: updateId++,
    message: { chat: { id: fromId }, from: { id: fromId }, text },
  });
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const method = req.url.split('/').pop();
    const params = body ? JSON.parse(body) : {};
    const reply = (result) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result }));
    };
    if (method === 'getMe') return reply({ username: 'e2e_test_bot' });
    if (method === 'getUpdates') return reply(pendingUpdates.splice(0));
    if (method === 'sendMessage') {
      sent.push(params);
      return reply({ message_id: sent.length });
    }
    if (method === 'sendChatAction') return reply(true);
    reply({});
  });
});

// --- helpers ----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(desc, pred, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await sleep(200);
  }
  throw new Error(`TIMEOUT waiting for: ${desc}`);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- run --------------------------------------------------------------------

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const gateway = spawn(process.execPath, [path.join(assistantDir, 'gateway.js'), 'test'], {
    env: {
      ...process.env,
      TELEGRAM_API_BASE: `http://127.0.0.1:${port}`,
      TELEGRAM_BOT_TOKEN_TEST: 'e2e-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let gatewayLog = '';
  gateway.stdout.on('data', (d) => (gatewayLog += d));
  gateway.stderr.on('data', (d) => (gatewayLog += d));

  try {
    // 1. stranger is ignored
    queueMessage(STRANGER, 'yo let me in');
    // 2. owner gets a reply from (fake) claude
    queueMessage(OWNER, 'hello');
    await waitFor('first reply', () => sent.some((m) => m.chat_id === OWNER));
    check('owner message answered', sent.some((m) => m.chat_id === OWNER && m.text === 'fresh:hello'),
      JSON.stringify(sent.find((m) => m.chat_id === OWNER)));
    check('stranger ignored', !sent.some((m) => m.chat_id === STRANGER));

    // 3. second message resumes the saved session
    queueMessage(OWNER, 'again');
    await waitFor('resumed reply', () => sent.some((m) => m.text === 'resumed:again'));
    check('session resumed on 2nd message', true);
    const sessions = JSON.parse(
      fs.readFileSync(path.join(profileDir, 'state', 'sessions.json'), 'utf8'));
    check('session id persisted', sessions[OWNER] === 'sess-e2e');

    // 4. /new resets the session
    queueMessage(OWNER, '/new');
    await waitFor('/new ack', () => sent.some((m) => /fresh start/i.test(m.text)));
    queueMessage(OWNER, 'after reset');
    await waitFor('fresh reply after /new', () => sent.some((m) => m.text === 'fresh:after reset'));
    check('/new starts a fresh session', true);

    // 5. due reminder fires on the scheduler tick (20s interval)
    await waitFor('reminder ping', () => sent.some((m) => m.text === '⏰ test reminder'), 30000);
    check('due reminder delivered', true);
    const remaining = JSON.parse(fs.readFileSync(path.join(profileDir, 'reminders.json'), 'utf8'));
    check('one-off reminder removed after firing', remaining.length === 0);

    // 6. heartbeat fires and delivers (fake claude echoes, so not suppressed)
    await waitFor('heartbeat delivery', () => sent.some((m) => m.text === 'fresh:HB_PATROL'), 30000);
    check('heartbeat patrol delivered when it has something to say', true);
  } catch (e) {
    check(e.message, false);
    console.error('\n--- gateway log ---\n' + gatewayLog);
  } finally {
    gateway.kill('SIGKILL');
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main();
