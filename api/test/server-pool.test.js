/* The moderator role and the shared exercise pool, against the real server.js in a child.
 *
 * Two things are being pinned and they are the two that matter to the person running the box:
 * what a moderator can reach (the pool and their own invite codes — and nothing else on the
 * dashboard), and what one member's suggestion turns into on everybody else's device (the
 * exercise, once approved, and never who suggested it). Same harness as
 * server-admin-delete.test.js.
 */
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
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const ADMIN = 'u_adm', MOD = 'u_mod', ANN = 'u_ann', BOB = 'u_bob';
const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-pool-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: ADMIN, name: 'Adminna', created: now, admin: true },
      { id: MOD, name: 'Modest', created: now },
      { id: ANN, name: 'Ann', created: now },
      { id: BOB, name: 'Bob', created: now }
    ],
    creds: [], subs: [],
    invites: [{ code: 'ADMINCODE1', note: 'from the admin', createdBy: ADMIN, created: now, usedBy: BOB, usedAt: now }]
  }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
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
  h.call = async (uid, method, url, body) => {
    const r = await fetch(h.api + url, {
      method,
      headers: { ...(uid ? { Cookie: `gymsid=${mintSession(uid)}` } : {}), 'Content-Type': 'application/json', Origin: 'http://localhost:8080' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: r.status, body: await r.json() };
  };
  h.get = (uid, url) => h.call(uid, 'GET', url);
  h.post = (uid, url, body) => h.call(uid, 'POST', url, body || {});
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  h.audit = () => { try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch { return []; } };
  return h;
}

const exercise = (over = {}) => ({
  id: 'cmine1', n: 'Reverse Nordic on rings', bp: 'upper legs', eq: 'body weight', tg: 'quadriceps',
  primaries: ['quadriceps'], secondaries: ['abs', 'quadriceps', 'wings'], muscleGroups: ['quadriceps', 'abs'], sm: ['abs'],
  desc: 'Kneel, lean back.', custom: true, secretNote: 'must not travel', ...over
});

test('a moderator is made by an admin, and the grant is what /api/me reports', async t => {
  const h = await startServer(t);
  assert.deepEqual((await h.get(MOD, '/api/me')).body.user, { id: MOD, name: 'Modest', admin: false, mod: false });
  assert.deepEqual((await h.get(ADMIN, '/api/me')).body.user, { id: ADMIN, name: 'Adminna', admin: true, mod: true });

  // Only an admin grants it — not a member, and not the future moderator themselves.
  assert.equal((await h.post(ANN, '/api/admin/user/role', { id: ANN, role: 'moderator' })).status, 403);
  assert.equal((await h.post(MOD, '/api/admin/user/role', { id: MOD, role: 'moderator' })).status, 403);
  assert.equal((await h.post(null, '/api/admin/user/role', { id: MOD, role: 'moderator' })).status, 401);
  assert.equal((await h.post(ADMIN, '/api/admin/user/role', { id: 'nobody', role: 'moderator' })).status, 404);
  assert.equal((await h.post(ADMIN, '/api/admin/user/role', { id: ADMIN, role: 'moderator' })).status, 400);

  let r = await h.post(ADMIN, '/api/admin/user/role', { id: MOD, role: 'moderator' });
  assert.deepEqual([r.status, r.body.moderator], [200, true]);
  assert.equal(h.db().users.find(u => u.id === MOD).role, 'moderator');
  assert.equal((await h.get(MOD, '/api/me')).body.user.mod, true);
  assert.equal((await h.get(MOD, '/api/me')).body.user.admin, false);
  const row = (await h.get(ADMIN, '/api/admin/users')).body.users.find(u => u.id === MOD);
  assert.equal(row.moderator, true);
  assert.ok(h.audit().some(e => e.ev === 'admin.user.role' && e.tgt === MOD && e.msg === 'moderator'));

  // …and taken back the same way, effective on the next request.
  r = await h.post(ADMIN, '/api/admin/user/role', { id: MOD, role: null });
  assert.equal(r.body.moderator, false);
  assert.equal('role' in h.db().users.find(u => u.id === MOD), false);
  assert.equal((await h.get(MOD, '/api/mod/pool')).status, 403);
});

test('a moderator reaches the pool and their own invites — and nothing else on the dashboard', async t => {
  const h = await startServer(t);
  await h.post(ADMIN, '/api/admin/user/role', { id: MOD, role: 'moderator' });

  for (const url of ['/api/admin/users', `/api/admin/user?id=${ANN}`, '/api/admin/audit', '/api/admin/coach']) {
    assert.equal((await h.get(MOD, url)).status, 403, url);
  }
  assert.equal((await h.post(MOD, '/api/admin/user/disable', { id: ANN, disabled: true })).status, 403);
  assert.equal((await h.post(MOD, '/api/admin/user/delete', { id: ANN })).status, 403);
  assert.equal((await h.post(MOD, '/api/admin/audit/clear')).status, 403);
  assert.equal(h.db().users.length, 4);

  // Invites: a moderator makes codes, and sees and revokes only those.
  assert.equal((await h.get(ANN, '/api/admin/invites')).status, 403);
  assert.deepEqual((await h.get(MOD, '/api/admin/invites')).body.invites, []);          // the admin's code names Bob
  const made = await h.post(MOD, '/api/admin/invites/new', { note: 'for a friend' });
  assert.equal(made.status, 200);
  const code = made.body.invite.code;
  assert.deepEqual((await h.get(MOD, '/api/admin/invites')).body.invites.map(i => i.code), [code]);
  assert.equal((await h.get(ADMIN, '/api/admin/invites')).body.invites.length, 2);       // the admin sees both
  assert.equal((await h.post(MOD, '/api/admin/invites/revoke', { code: 'ADMINCODE1' })).status, 404); // "no such code", not "not yours"
  assert.equal((await h.post(MOD, '/api/admin/invites/revoke', { code })).status, 200);
  assert.deepEqual(h.db().invites.map(i => i.code), ['ADMINCODE1']);

  assert.equal((await h.get(MOD, '/api/mod/pool')).status, 200);
  assert.equal((await h.get(ANN, '/api/mod/pool')).status, 403);
  assert.ok(!/\n\s+at /.test(h.log), h.log);
});

test('suggest → approve: the exercise reaches everyone, the suggester\'s name reaches nobody', async t => {
  const h = await startServer(t);
  await h.post(ADMIN, '/api/admin/user/role', { id: MOD, role: 'moderator' });

  // Nothing shared yet: the data calls answer exactly as they did before the pool existed.
  assert.deepEqual((await h.get(ANN, '/api/data/rev')).body, { rev: 0 });
  assert.deepEqual((await h.get(ANN, '/api/pool')).body, { rev: 0, items: [], mine: [] });
  assert.equal((await h.get(null, '/api/pool')).status, 401);
  assert.equal((await h.get(null, '/api/config')).body.pool, true);

  let r = await h.post(ANN, '/api/pool/submit', { exercise: exercise() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.mine, [{ id: 'cmine1', status: 'pending' }]);
  // Waiting is not shared: Bob sees nothing, and no revision moved.
  assert.deepEqual((await h.get(BOB, '/api/pool')).body, { rev: 0, items: [], mine: [] });
  assert.deepEqual((await h.get(BOB, '/api/data/rev')).body, { rev: 0 });

  // The queue names the suggester (a moderator has to know whom to ask) and holds an allowlist.
  const queue = (await h.get(MOD, '/api/mod/pool')).body.items;
  assert.equal(queue.length, 1);
  assert.equal(queue[0].byName, 'Ann');
  assert.equal(queue[0].secretNote, undefined);
  assert.equal(queue[0].custom, undefined);
  assert.deepEqual(queue[0].primaries, ['quadriceps']);
  assert.deepEqual(queue[0].secondaries, ['abs']);          // not a primary again, not a muscle that does not exist

  // Approved, with the moderator's correction to the name.
  r = await h.post(MOD, '/api/mod/pool/review', { id: 'cmine1', action: 'approve', edits: { ...exercise(), n: 'Reverse Nordic (rings)' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const seen = (await h.get(BOB, '/api/pool')).body;
  assert.equal(seen.rev, 1);
  assert.deepEqual(seen.mine, []);
  assert.deepEqual(Object.keys(seen.items[0]).sort(), ['bp', 'desc', 'eq', 'id', 'muscleGroups', 'n', 'primaries', 'secondaries', 'sm', 'tg']);
  assert.equal(seen.items[0].n, 'Reverse Nordic (rings)');
  assert.ok(!JSON.stringify(seen).includes('Ann') && !JSON.stringify(seen).includes(ANN));
  assert.deepEqual((await h.get(BOB, '/api/data/rev')).body, { rev: 0, pool: 1 });
  assert.equal((await h.get(BOB, '/api/data')).body.pool, 1);
  assert.deepEqual((await h.get(ANN, '/api/pool')).body.mine, [{ id: 'cmine1', status: 'approved' }]);
  assert.ok(h.audit().some(e => e.ev === 'admin.pool.approve' && e.uid === MOD));

  // Shared is shared: it cannot be suggested again, taken back, or decided twice.
  assert.equal((await h.post(ANN, '/api/pool/submit', { exercise: exercise() })).body.code, 'shared');
  assert.equal((await h.post(ANN, '/api/pool/withdraw', { id: 'cmine1' })).body.code, 'shared');
  assert.equal((await h.post(MOD, '/api/mod/pool/review', { id: 'cmine1', action: 'reject' })).body.code, 'decided');

  // Retired: still served, so history keeps resolving; flagged, so clients stop offering it.
  r = await h.post(MOD, '/api/mod/pool/retire', { id: 'cmine1' });
  assert.equal(r.status, 200);
  const after = (await h.get(BOB, '/api/pool')).body;
  assert.equal(after.rev, 2);
  assert.equal(after.items[0].retired, true);
  assert.equal((await h.post(MOD, '/api/mod/pool/retire', { id: 'cmine1', retired: false })).status, 200);
  assert.equal((await h.get(BOB, '/api/pool')).body.items[0].retired, undefined);

  // A correction after the fact keeps the id.
  r = await h.post(MOD, '/api/mod/pool/update', { id: 'cmine1', exercise: { ...exercise(), id: 'something-else', n: 'Reverse Nordic curl' } });
  assert.equal(r.status, 200);
  assert.deepEqual((await h.get(BOB, '/api/pool')).body.items.map(i => [i.id, i.n]), [['cmine1', 'Reverse Nordic curl']]);
  assert.ok(!/\n\s+at /.test(h.log), h.log);
});

test('decline, resubmit, withdraw', async t => {
  const h = await startServer(t);
  await h.post(ADMIN, '/api/admin/user/role', { id: MOD, role: 'moderator' });
  await h.post(ANN, '/api/pool/submit', { exercise: exercise() });

  let r = await h.post(MOD, '/api/mod/pool/review', { id: 'cmine1', action: 'reject', note: 'Same as the built-in sissy squat.' });
  assert.equal(r.status, 200);
  assert.deepEqual((await h.get(ANN, '/api/pool')).body.mine, [{ id: 'cmine1', status: 'rejected', note: 'Same as the built-in sissy squat.' }]);
  assert.deepEqual((await h.get(BOB, '/api/pool')).body, { rev: 0, items: [], mine: [] });   // a declined one is nobody else's business

  // Corrected and sent again → waiting again, the old note gone.
  r = await h.post(ANN, '/api/pool/submit', { exercise: exercise({ n: 'Ring reverse nordic', desc: 'Different after all.' }) });
  assert.deepEqual(r.body.mine, [{ id: 'cmine1', status: 'pending' }]);

  // Somebody else cannot touch it, by suggestion or by withdrawal.
  assert.equal((await h.post(BOB, '/api/pool/submit', { exercise: exercise() })).body.code, 'taken');
  assert.equal((await h.post(BOB, '/api/pool/withdraw', { id: 'cmine1' })).status, 404);

  r = await h.post(ANN, '/api/pool/withdraw', { id: 'cmine1' });
  assert.deepEqual(r.body.mine, []);
  assert.equal((await h.get(MOD, '/api/mod/pool')).body.items.length, 0);
});

test('what cannot be suggested', async t => {
  const h = await startServer(t);
  const submit = over => h.post(ANN, '/api/pool/submit', { exercise: exercise(over) });
  assert.equal((await h.post(null, '/api/pool/submit', { exercise: exercise() })).status, 401);
  assert.equal((await submit({ id: '../etc' })).body.code, 'id');
  assert.equal((await submit({ id: '__proto__' })).body.code, 'id');
  assert.equal((await submit({ n: '   ' })).body.code, 'name');
  assert.equal((await submit({ bp: 'torso' })).body.code, 'bp');
  assert.equal((await submit({ eq: 'custom' })).body.code, 'eq');                       // an imported exercise nobody gave equipment to
  assert.equal((await submit({ id: '0025' })).body.code, 'builtin');                    // would override the barbell bench press for everyone
  assert.equal((await submit({ n: 'Barbell Bench Press' })).body.code, 'name');         // the library has it
  assert.equal((await h.post(ANN, '/api/pool/submit', {})).status, 400);

  // Ten waiting is the limit; the eleventh is refused, a correction to one of the ten is not.
  for (let i = 0; i < 10; i++) assert.equal((await submit({ id: 'c' + i, n: 'Odd lift ' + i })).status, 200);
  const over = await submit({ id: 'c10', n: 'Odd lift 10' });
  assert.deepEqual([over.status, over.body.code], [429, 'cap']);
  assert.equal((await submit({ id: 'c3', n: 'Odd lift three' })).status, 200);

  // Two people, one name: the second to be approved is told.
  await h.post(ADMIN, '/api/mod/pool/review', { id: 'c0', action: 'approve' });
  assert.equal((await h.post(BOB, '/api/pool/submit', { exercise: exercise({ id: 'cbob', n: 'odd LIFT 0' }) })).body.code, 'name');
  assert.ok(!/\n\s+at /.test(h.log), h.log);
});

test('deleting an account takes its waiting suggestions and unsigns what it shared', async t => {
  const h = await startServer(t);
  await h.post(ANN, '/api/pool/submit', { exercise: exercise({ id: 'c-shared', n: 'Shared one' }) });
  await h.post(ANN, '/api/pool/submit', { exercise: exercise({ id: 'c-waiting', n: 'Waiting one' }) });
  await h.post(ADMIN, '/api/mod/pool/review', { id: 'c-shared', action: 'approve' });

  assert.equal((await h.post(ADMIN, '/api/admin/user/delete', { id: ANN })).status, 200);
  const all = (await h.get(ADMIN, '/api/mod/pool')).body.items;
  assert.deepEqual(all.map(i => [i.id, i.status, i.by, i.byName]), [['c-shared', 'approved', null, null]]);
  assert.equal((await h.get(BOB, '/api/pool')).body.items.length, 1);
  // The pool survives a restart of nothing in particular: it is on disk.
  const disk = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'pool.json'), 'utf8'));
  assert.equal(disk.items.length, 1);
});
