/* The two admin switches end to end, against the real server.js in a child process: online food
   lookup and the Apple Health ingest are absent until an admin turns them on, the Health token
   writes one profile's body data and reads nothing, and deleting an account removes what its
   Shortcut delivered. Same harness as server-admin-delete.test.js. */
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
const ORIGIN = 'http://localhost:8080';
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const ADMIN = 'u_adm_1', ANN = 'u_ann_1', BOB = 'u_bob_1';
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json', Origin: ORIGIN });
const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-extras-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: ADMIN, name: 'Adminna', created: new Date().toISOString(), admin: true }, { id: ANN, name: 'Ann', created: new Date().toISOString() }, { id: BOB, name: 'Bob', created: new Date().toISOString() }],
    creds: [], subs: [], invites: []
  }));
  fs.writeFileSync(path.join(dataDir, `state-${ANN}.json`), JSON.stringify({ unit: 'kg', workouts: [], _rev: 3 }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', ...env }
  });
  const h = { api: `http://127.0.0.1:${port}`, log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${h.api}/api/health`)).ok; } catch { /* not up yet */ }
    if (!up) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(up, `server never came up:\n${h.log}`);
  h.req = async (method, route, { uid, body, headers } = {}) => {
    const r = await fetch(h.api + route, { method, headers: { ...(uid ? as(uid) : { 'Content-Type': 'application/json' }), ...(headers || {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let data = null;
    try { data = await r.json(); } catch { /* no body */ }
    return { status: r.status, body: data };
  };
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  return h;
}

test('both features are absent until an admin turns them on', async t => {
  const h = await startServer(t);
  const cfg = (await h.req('GET', '/api/config')).body;
  assert.equal('food' in cfg, false);
  assert.equal('health' in cfg, false);
  assert.deepEqual((await h.req('POST', '/api/food/barcode', { uid: ANN, body: { code: '4602014004683' } })), { status: 403, body: { error: 'disabled' } });
  assert.equal((await h.req('GET', '/api/healthkit', { uid: ANN })).status, 403);
  assert.equal((await h.req('POST', '/api/healthkit/token', { uid: ANN, body: {} })).status, 403);
  assert.equal((await h.req('POST', '/api/healthkit/ingest', { body: { weight: '80' }, headers: { Authorization: 'Bearer ogh_x' } })).status, 403);
  // and the data answers are exactly what they were before the feature existed
  assert.deepEqual((await h.req('GET', '/api/data/rev', { uid: ANN })).body, { rev: 3 });
});

test('only an admin can flip the switches, and every flip is audited', async t => {
  const h = await startServer(t);
  assert.equal((await h.req('GET', '/api/admin/extras', { uid: ANN })).status, 403);
  assert.equal((await h.req('POST', '/api/admin/extras', { uid: ANN, body: { food: { lookup: true } } })).status, 403);
  const before = (await h.req('GET', '/api/admin/extras', { uid: ADMIN })).body;
  assert.deepEqual(before.food, { lookup: false, contact: '', forcedOff: false, cache: { products: 0, searches: 0 } });
  assert.deepEqual(before.health, { enabled: false, shortcutUrl: '', users: 0, tokens: 0 });

  const after = await h.req('POST', '/api/admin/extras', { uid: ADMIN, body: { food: { lookup: true, contact: 'me@example.org' }, health: { enabled: true, shortcutUrl: 'https://www.icloud.com/shortcuts/abc' } } });
  assert.equal(after.status, 200);
  assert.equal(after.body.food.lookup, true);
  assert.equal(after.body.health.shortcutUrl, 'https://www.icloud.com/shortcuts/abc');
  const cfg = (await h.req('GET', '/api/config')).body;
  assert.deepEqual(cfg.food, { lookup: true });
  assert.equal(cfg.health, true);
  const audit = fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8');
  assert.match(audit, /"ev":"admin\.food\.lookup".*"msg":"on"/);
  assert.match(audit, /"ev":"admin\.health\.ingest".*"msg":"on"/);
  assert.equal(h.stackFrames(), 0, h.log);
});

test('FOOD_LOOKUP_DISABLED=1 wins over the dashboard', async t => {
  const h = await startServer(t, { FOOD_LOOKUP_DISABLED: '1' });
  const r = await h.req('POST', '/api/admin/extras', { uid: ADMIN, body: { food: { lookup: true } } });
  assert.equal(r.body.food.forcedOff, true);
  assert.equal('food' in (await h.req('GET', '/api/config')).body, false);
  assert.equal((await h.req('POST', '/api/food/search', { uid: ANN, body: { q: 'творог' } })).status, 403);
});

test('a Health token writes its own profile’s body data — and nothing else, and reads nothing', async t => {
  const h = await startServer(t);
  await h.req('POST', '/api/admin/extras', { uid: ADMIN, body: { health: { enabled: true } } });
  const made = await h.req('POST', '/api/healthkit/token', { uid: ANN, body: {} });
  assert.equal(made.status, 200);
  const bearer = { Authorization: 'Bearer ' + made.body.token };

  // The Shortcut's request: no cookie, no Origin, a body the way a Russian iPhone writes it.
  const sent = await h.req('POST', '/api/healthkit/ingest', { headers: bearer, body: { date: '2026-10-01T08:15:00+03:00', weight: '80,5 кг', bodyFat: '18 %' } });
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.body.accepted.map(a => [a.metric, a.v]), [['weight', 80.5], ['bodyFat', 18]]);

  // Ann sees it; the revision rides on the data answers; Bob sees nothing of hers.
  const mine = await h.req('GET', '/api/healthkit', { uid: ANN });
  assert.equal(mine.body.days['2026-10-01'].weight.v, 80.5);
  assert.equal(mine.body.tokens.length, 1);
  assert.equal('token' in mine.body.tokens[0], false);
  assert.deepEqual((await h.req('GET', '/api/data/rev', { uid: ANN })).body, { rev: 3, health: 1 });
  assert.deepEqual((await h.req('GET', '/api/healthkit', { uid: BOB })).body.days, {});

  // The token is not a session: every other route treats it as nobody.
  for (const route of ['/api/data', '/api/me', '/api/healthkit', '/api/pool']) {
    assert.equal((await h.req('GET', route, { headers: bearer })).status, 401, route);
  }
  assert.equal((await h.req('PUT', '/api/data', { headers: bearer, body: { state: { unit: 'kg' } } })).status, 401);
  // And a session is not a token: the ingest door does not open for a cookie.
  assert.equal((await h.req('POST', '/api/healthkit/ingest', { uid: ANN, body: { weight: '80' } })).status, 401);
  // Nor did the delivery touch the profile's own state file.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${ANN}.json`), 'utf8')), { unit: 'kg', workouts: [], _rev: 3 });

  const revoked = await h.req('POST', '/api/healthkit/token/revoke', { uid: ANN, body: { id: made.body.id } });
  assert.deepEqual(revoked.body.tokens, []);
  assert.equal((await h.req('POST', '/api/healthkit/ingest', { headers: bearer, body: { weight: '80' } })).status, 401);
  assert.equal(h.stackFrames(), 0, h.log);
});

test('deleting an account removes what its Shortcut delivered and kills its tokens', async t => {
  const h = await startServer(t);
  await h.req('POST', '/api/admin/extras', { uid: ADMIN, body: { health: { enabled: true } } });
  const made = await h.req('POST', '/api/healthkit/token', { uid: ANN, body: {} });
  const bearer = { Authorization: 'Bearer ' + made.body.token };
  await h.req('POST', '/api/healthkit/ingest', { headers: bearer, body: { weight: '80' } });
  const file = path.join(h.dataDir, 'health', ANN + '.json');
  assert.ok(fs.existsSync(file));
  assert.equal((await h.req('POST', '/api/admin/user/delete', { uid: ADMIN, body: { id: ANN } })).status, 200);
  assert.equal(fs.existsSync(file), false);
  assert.equal((await h.req('POST', '/api/healthkit/ingest', { headers: bearer, body: { weight: '80' } })).status, 401);
  assert.equal((await h.req('GET', '/api/admin/extras', { uid: ADMIN })).body.health.tokens, 0);
});

test('an oversized delivery is refused before it is read', async t => {
  const h = await startServer(t);
  await h.req('POST', '/api/admin/extras', { uid: ADMIN, body: { health: { enabled: true } } });
  const r = await h.req('POST', '/api/healthkit/ingest', { headers: { Authorization: 'Bearer ogh_x' }, body: { weight: 'x'.repeat(70000) } });
  assert.equal(r.status, 413);
});
