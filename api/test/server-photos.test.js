/* The photo store end to end, against the real server.js in a child process: absent until an
   admin turns it on, a member's pictures reachable by that member and by nobody else — the
   admin included — with camera metadata gone from what lands on disk, a revision the other
   devices can see, deletion that works even after the feature is switched off again, and an
   account's photos leaving with the account. Same harness as server-extras.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { jpeg, webp, PNG, b64 } from './photo-fixtures.mjs';

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
const today = () => new Date().toISOString().slice(0, 10);

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-photos-srv-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: ADMIN, name: 'Adminna', created: new Date().toISOString(), admin: true }, { id: ANN, name: 'Ann', created: new Date().toISOString() }, { id: BOB, name: 'Bob', created: new Date().toISOString() }],
    creds: [], subs: [], invites: []
  }));
  fs.writeFileSync(path.join(dataDir, `state-${ANN}.json`), JSON.stringify({ unit: 'kg', workouts: [], _rev: 3 }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost' }
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
  // The picture route answers bytes, not JSON.
  h.raw = async (route, { uid, headers } = {}) => {
    const r = await fetch(h.api + route, { headers: { ...(uid ? as(uid) : {}), ...(headers || {}) } });
    return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
  };
  h.on = () => h.req('POST', '/api/admin/extras', { uid: ADMIN, body: { photos: { enabled: true } } });
  h.upload = (uid, over = {}) => h.req('POST', '/api/photos', { uid, body: { kind: 'body', d: today(), pose: 'front', image: b64(jpeg()), w: 1200, h: 1600, ...over } });
  h.dir = uid => path.join(dataDir, 'photos', uid);
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  return h;
}

test('absent until an admin turns it on, and the data answers are what they always were', async t => {
  const h = await startServer(t);
  assert.equal('photos' in (await h.req('GET', '/api/config')).body, false);
  assert.deepEqual(await h.req('GET', '/api/photos', { uid: ANN }), { status: 403, body: { error: 'disabled' } });
  assert.deepEqual(await h.upload(ANN), { status: 403, body: { error: 'disabled' } });
  assert.equal((await h.raw('/api/photo?id=' + 'a'.repeat(24), { uid: ANN })).status, 403);
  assert.deepEqual((await h.req('GET', '/api/data/rev', { uid: ANN })).body, { rev: 3 });
  assert.equal(fs.existsSync(path.join(h.dataDir, 'photos')), false, 'nothing was created');

  // only an admin flips it, and the flip is on the record
  assert.equal((await h.req('POST', '/api/admin/extras', { uid: ANN, body: { photos: { enabled: true } } })).status, 403);
  const before = (await h.req('GET', '/api/admin/extras', { uid: ADMIN })).body.photos;
  assert.deepEqual(before, { enabled: false, quotaMb: 500, mealDays: 0, users: 0, files: 0, bytes: 0 });
  const after = await h.req('POST', '/api/admin/extras', { uid: ADMIN, body: { photos: { enabled: true, quotaMb: 200, mealDays: 90, junk: 1 } } });
  assert.deepEqual(after.body.photos, { enabled: true, quotaMb: 200, mealDays: 90, users: 0, files: 0, bytes: 0 });
  assert.equal((await h.req('GET', '/api/config')).body.photos, true);
  assert.match(fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8'), /"ev":"admin\.photos\.store".*"msg":"on"/);
  // numbers out of range are not taken
  const odd = await h.req('POST', '/api/admin/extras', { uid: ADMIN, body: { photos: { quotaMb: 1, mealDays: -5 } } });
  assert.deepEqual([odd.body.photos.quotaMb, odd.body.photos.mealDays], [200, 90]);
  assert.equal(h.stackFrames(), 0, h.log);
});

test('a member keeps a photo, sees it, and nobody else can — not another member, not the admin', async t => {
  const h = await startServer(t);
  await h.on();
  assert.equal((await h.req('POST', '/api/photos', { body: { kind: 'body', d: today(), image: b64(jpeg()) } })).status, 401, 'no session');

  const up = await h.upload(ANN, { pose: 'side', thumb: b64(jpeg({ body: 8 })) });
  assert.equal(up.status, 200);
  const id = up.body.photo.id;
  assert.equal(up.body.photo.thumb, true);

  // what is on disk: the picture, its thumbnail and the index — and no camera metadata in any
  const files = fs.readdirSync(h.dir(ANN)).sort();
  assert.deepEqual(files, ['index.json', id + '.jpg', id + '.t.jpg'].sort());
  for (const f of files) assert.ok(!fs.readFileSync(path.join(h.dir(ANN), f)).toString('latin1').includes('GPS'), f + ' carries a position');
  // the profile's own state was not touched
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${ANN}.json`), 'utf8')), { unit: 'kg', workouts: [], _rev: 3 });

  // the list, and the revision other devices watch
  const mine = await h.req('GET', '/api/photos', { uid: ANN });
  assert.deepEqual(mine.body.items.map(i => [i.id, i.kind, i.pose, i.mime, i.thumb]), [[id, 'body', 'side', 'image/jpeg', true]]);
  assert.equal(mine.body.quota, 500 * 1024 * 1024);
  assert.deepEqual((await h.req('GET', '/api/data/rev', { uid: ANN })).body, { rev: 3, photos: 1 });
  assert.equal((await h.req('GET', '/api/data', { uid: ANN })).body.photos, 1);
  assert.deepEqual((await h.req('GET', '/api/data/rev', { uid: BOB })).body, { rev: 0 });

  // the picture itself
  const pic = await h.raw('/api/photo?id=' + id, { uid: ANN });
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get('content-type'), 'image/jpeg');
  assert.equal(pic.headers.get('cache-control'), 'private, no-cache');
  assert.equal(pic.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(pic.headers.get('etag'), `"${id}"`);
  assert.deepEqual(pic.buf, jpeg({ exif: false, iptc: false, comment: false }));
  const small = await h.raw(`/api/photo?id=${id}&thumb=1`, { uid: ANN });
  assert.equal(small.headers.get('etag'), `"${id}-t"`);
  assert.ok(small.buf.length < pic.buf.length);
  // unchanged: asked again, not sent again
  const again = await h.raw('/api/photo?id=' + id, { uid: ANN, headers: { 'If-None-Match': `"${id}"` } });
  assert.deepEqual([again.status, again.buf.length], [304, 0]);

  // everybody else
  for (const [who, uid] of [['another member', BOB], ['the admin', ADMIN]]) {
    assert.equal((await h.raw('/api/photo?id=' + id, { uid })).status, 404, who);
    assert.equal((await h.raw(`/api/photo?id=${id}&thumb=1`, { uid })).status, 404, who);
    assert.deepEqual((await h.req('GET', '/api/photos', { uid })).body.items, [], who);
    assert.equal((await h.req('POST', '/api/photos/delete', { uid, body: { ids: [id] } })).body.removed, 0, who);
  }
  assert.equal((await h.raw('/api/photo?id=' + id)).status, 401, 'no session');
  for (const bad of ['', '../' + ANN + '/' + id, id + '.jpg', 'index.json', '%2e%2e%2fdb']) assert.equal((await h.raw('/api/photo?id=' + bad, { uid: ANN })).status, 404, bad);
  // the dashboard knows that there is one, and how big — not which, not whose picture
  const dash = await h.req('GET', '/api/admin/extras', { uid: ADMIN });
  assert.deepEqual([dash.body.photos.users, dash.body.photos.files], [1, 1]);
  assert.ok(!JSON.stringify(dash.body).includes(id));
  assert.ok(!JSON.stringify((await h.req('GET', '/api/admin/user?id=' + ANN, { uid: ADMIN })).body).includes(id));
  assert.equal(h.stackFrames(), 0, h.log);
});

test('only pictures get in: a PNG, a page of text and an oversized upload are refused', async t => {
  const h = await startServer(t);
  await h.on();
  assert.equal((await h.upload(ANN, { image: b64(PNG) })).body.code, 'badimage');
  assert.equal((await h.upload(ANN, { image: Buffer.from('<html><script>alert(1)</script></html>').toString('base64') })).body.code, 'badimage');
  assert.equal((await h.upload(ANN, { kind: 'x' })).body.code, 'bad-kind');
  assert.equal((await h.upload(ANN, { d: 'yesterday' })).body.code, 'bad-date');
  const big = await h.upload(ANN, { image: b64(Buffer.concat([jpeg(), Buffer.alloc(3 * 1024 * 1024, 1)])) });
  assert.deepEqual([big.status, big.body.code], [413, 'toolarge']);
  assert.equal((await h.upload(ANN, { kind: 'meal', m: 1, image: b64(webp()) })).body.photo.mime, 'image/webp');
  // with a retention set, a meal photo for a day already past it is refused up front
  await h.req('POST', '/api/admin/extras', { uid: ADMIN, body: { photos: { mealDays: 30 } } });
  const old = await h.upload(ANN, { kind: 'meal', d: '2026-01-05' });
  assert.deepEqual([old.status, old.body.code, old.body.days], [400, 'expired', 30]);
  assert.equal((await h.req('GET', '/api/photos', { uid: ANN })).body.items.length, 1);
  assert.equal(h.stackFrames(), 0, h.log);
});

test('deleting works, also once the feature is off again; clearing is on the record', async t => {
  const h = await startServer(t);
  await h.on();
  const a = (await h.upload(ANN)).body.photo.id;
  const b = (await h.upload(ANN)).body.photo.id;
  const c = (await h.upload(ANN)).body.photo.id;
  const del = await h.req('POST', '/api/photos/delete', { uid: ANN, body: { ids: [a] } });
  assert.deepEqual([del.body.removed, del.body.rev], [1, 4]);
  assert.equal(fs.existsSync(path.join(h.dir(ANN), a + '.jpg')), false);

  await h.req('POST', '/api/admin/extras', { uid: ADMIN, body: { photos: { enabled: false } } });
  assert.equal((await h.req('GET', '/api/photos', { uid: ANN })).status, 403);
  assert.equal((await h.raw('/api/photo?id=' + b, { uid: ANN })).status, 403);
  assert.deepEqual((await h.req('GET', '/api/data/rev', { uid: ANN })).body, { rev: 3 }, 'no revision is advertised while off');
  // switched off does not mean stranded: the files are still there, the app is told how many
  // (on the one answer it reads at every start), and they are still the member's to remove
  assert.ok(fs.existsSync(path.join(h.dir(ANN), b + '.jpg')));
  assert.equal((await h.req('GET', '/api/data', { uid: ANN })).body.photosKept, 2);
  assert.equal('photosKept' in (await h.req('GET', '/api/data', { uid: BOB })).body, false, 'nobody else is told anything');
  assert.equal((await h.req('POST', '/api/photos/delete', { uid: ANN, body: { ids: [b] } })).body.removed, 1);
  assert.equal((await h.req('GET', '/api/data', { uid: ANN })).body.photosKept, 1);
  assert.equal((await h.req('POST', '/api/photos/clear', { uid: ANN, body: {} })).status, 200);
  assert.deepEqual(fs.readdirSync(h.dir(ANN)), ['index.json'], 'no picture left, ' + c + ' included');
  assert.equal('photosKept' in (await h.req('GET', '/api/data', { uid: ANN })).body, false);
  // switched on again later: the revision carried on rather than starting over
  await h.on();
  assert.deepEqual((await h.req('GET', '/api/data/rev', { uid: ANN })).body, { rev: 3, photos: 6 });
  assert.match(fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8'), /"ev":"auth\.photos\.clear"/);
  assert.equal(h.stackFrames(), 0, h.log);
});

test('an account\'s photos leave with the account', async t => {
  const h = await startServer(t);
  await h.on();
  await h.upload(ANN);
  const bobs = (await h.upload(BOB)).body.photo.id;
  assert.ok(fs.existsSync(h.dir(ANN)));
  assert.equal((await h.req('POST', '/api/admin/user/delete', { uid: ADMIN, body: { id: ANN } })).status, 200);
  assert.equal(fs.existsSync(h.dir(ANN)), false);
  assert.equal((await h.raw('/api/photo?id=' + bobs, { uid: BOB })).status, 200, 'bob keeps his');
  assert.equal(h.stackFrames(), 0, h.log);
});
