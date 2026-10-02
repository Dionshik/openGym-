/* A member's own reminders against the real server.js in a child process: one that is due fires
   once, a restart inside the window does not send it again, a second reminder on the same day
   still fires, "skip if already logged" stays quiet, and a list that is garbage costs neither
   the process nor the workout-day reminder that shares the tick. Same harness as
   server-reminder.test.js — the clock is real, so "now" is written into the state file. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const UID = 'u_test_1';
const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});
const wait = ms => new Promise(r => setTimeout(r, ms));
// loopback: PUSH_AGENT refuses it, so the send that follows fails locally and nothing leaves
const sub = { userId: UID, endpoint: 'https://localhost/x', keys: { p256dh: 'p', auth: 'a' }, created: new Date().toISOString() };

function newData(subs = [sub]) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-custom-rem-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: UID, name: 'One', created: new Date().toISOString() }], creds: [], subs, invites: [] }));
  return dataDir;
}
async function boot(t, dataDir) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', REMINDER_TICK_MS: '300' }
  });
  const h = { api: `http://127.0.0.1:${port}`, dataDir, child, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => child.kill('SIGKILL'));
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${h.api}/api/health`)).ok; } catch { /* not up yet */ }
    if (!up) await wait(100);
  }
  assert.ok(up, `server never came up:\n${h.log}`);
  return h;
}
const utc = (d, opts) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', hour12: false, ...opts }).formatToParts(d);
  return type => parts.find(p => p.type === type)?.value;
};
const minus = m => {
  const d = new Date(Date.now() - m * 60000);
  const g = utc(d, { hour: '2-digit', minute: '2-digit' });
  return { hhmm: `${g('hour')}:${g('minute')}`, sameDay: d.getUTCDate() === new Date().getUTCDate() };
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const reminder = (id, time, over = {}) => ({ id, text: 'Log your food', time, days: [], on: true, link: null, skipIfLogged: false, t: 1, ...over });
const state = (reminders, over = {}) => JSON.stringify({ lang: 'en', reminder: { on: false, time: '08:00', tz: 'UTC' }, reminders, workouts: [], routines: [], ...over });
const sent = (log, id) => (log.match(new RegExp(`custom-reminder sent ${UID} ${id}\\b`, 'g')) || []).length;
const until = async (cond, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end && !cond()) await wait(200); };

test('a due reminder fires once; a second one the same day fires too; a restart sends neither again', async t => {
  const a = minus(3), b = minus(1);
  if (!a.sameDay || !b.sameDay) return t.skip('just after midnight UTC — a same-day window cannot be set up');
  const dataDir = newData();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), state([reminder('food', a.hhmm, { link: 'nutrition' }), reminder('scale', b.hhmm), reminder('later', '00:00', { on: false })]));

  const h = await boot(t, dataDir);
  await until(() => sent(h.log, 'food') && sent(h.log, 'scale'));
  assert.equal(sent(h.log, 'food'), 1, h.log);
  assert.equal(sent(h.log, 'scale'), 1, h.log);
  await wait(1500);                                     // several more ticks inside the window
  assert.equal(sent(h.log, 'food'), 1, 'sent again inside the window');
  assert.equal(sent(h.log, 'later'), 0);
  const log = JSON.parse(fs.readFileSync(path.join(dataDir, 'reminder-log.json'), 'utf8'));
  assert.equal(log[UID].d, today());
  assert.deepEqual(log[UID].keys.sort(), [`food@${a.hhmm}`, `scale@${b.hhmm}`].sort());
  // the workout-day marker is a different thing and was not touched
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8')).users[0].lastReminder, undefined);

  h.child.kill('SIGKILL');
  const again = await boot(t, dataDir);
  await wait(2000);
  assert.equal(sent(again.log, 'food'), 0, `a restart must not send it twice:\n${again.log}`);
  assert.equal(sent(again.log, 'scale'), 0);
});

test('"skip if already logged" stays quiet on a day with a diary entry, and speaks on one without', async t => {
  const late = minus(2);
  if (!late.sameDay) return t.skip('just after midnight UTC — a same-day window cannot be set up');
  const dataDir = newData();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const file = path.join(dataDir, `state-${UID}.json`);
  const list = [reminder('food', late.hhmm, { link: 'nutrition', skipIfLogged: true })];
  fs.writeFileSync(file, state(list, { nutrition: { v: 1, log: [{ id: 'e1', d: today(), m: 0, n: 'Oats', k: 300 }], days: {}, foods: [], del: {} } }));
  const h = await boot(t, dataDir);
  await wait(1800);
  assert.equal(sent(h.log, 'food'), 0, `a logged day must stay silent:\n${h.log}`);
  assert.equal(fs.existsSync(path.join(dataDir, 'reminder-log.json')), false, 'nothing sent, nothing marked');
  // the entry is deleted while the window is still open: now it is owed
  fs.writeFileSync(file, state(list, { nutrition: { v: 1, log: [], days: {}, foods: [], del: {} } }));
  await until(() => sent(h.log, 'food'));
  assert.equal(sent(h.log, 'food'), 1, h.log);
});

test('a reminders list that is garbage costs nothing: no crash, no send, and the workout reminder still fires', async t => {
  const late = minus(2);
  if (!late.sameDay) return t.skip('just after midnight UTC — a same-day window cannot be set up');
  const dataDir = newData();
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), JSON.stringify({
    reminder: { on: true, time: late.hhmm, tz: 'UTC' },
    reminders: [null, 7, { id: 'x' }, { id: 'y', on: true, time: 'soon' }, 'nope'],
    routines: [{ id: 'r1', name: 'Full body', ex: [] }], week: { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' }, workouts: []
  }));
  const h = await boot(t, dataDir);
  await until(() => /reminder firing u_test_1 r1/.test(h.log));
  assert.match(h.log, /reminder firing u_test_1 r1/, h.log);
  assert.doesNotMatch(h.log, /custom-reminder sent/);
  assert.doesNotMatch(h.log, /custom reminders failed/);
  assert.equal(h.child.exitCode, null);

  // and the other way round: a profile whose reminders is not a list at all
  fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), JSON.stringify({ reminders: { a: 1 }, reminder: 'x', workouts: [], routines: [] }));
  await wait(1200);
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200);
  assert.doesNotMatch(h.log, /custom reminders failed/);
});

test('a profile with no push subscription, or a disabled one, is never sent to', async t => {
  const late = minus(2);
  if (!late.sameDay) return t.skip('just after midnight UTC — a same-day window cannot be set up');
  const dataDir = newData([]);
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), state([reminder('food', late.hhmm)]));
  const h = await boot(t, dataDir);
  await wait(1500);
  assert.equal(sent(h.log, 'food'), 0, 'no subscription, no send');
  h.child.kill('SIGKILL');

  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  db.subs = [sub]; db.users[0].disabled = true;
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));
  const again = await boot(t, dataDir);
  await wait(1500);
  assert.equal(sent(again.log, 'food'), 0, 'a disabled account gets nothing');
});
