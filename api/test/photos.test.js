/* The photo store (photos.js) without a server: what it accepts, what it cuts out of a picture
   before keeping it, who can read what, and what the quota, the rate limit and the meal-photo
   retention do. server-photos.test.js walks the same module through real HTTP. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPhotos, sniff, stripJpegMeta, stripWebpMeta, readImage, MAX_PHOTO_BYTES, MAX_THUMB_BYTES, UPLOADS_PER_HOUR } from '../photos.js';
import { jpeg, webp, seg, PNG, GPS, JFIF, SCAN, b64 } from './photo-fixtures.mjs';

const atomicWrite = (file, content, mode) => { fs.writeFileSync(file + '.tmp', content, mode ? { mode } : undefined); fs.renameSync(file + '.tmp', file); };
const TODAY = '2026-10-02';
const NOON = Date.parse(TODAY + 'T12:00:00Z');

function store(t, conf = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-photos-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const h = { dataDir, clock: NOON, conf: { enabled: true, quotaMb: 500, mealDays: 0, ...conf } };
  h.photos = createPhotos({ dataDir, atomicWrite, settings: { get: () => ({ photos: h.conf }) }, now: () => h.clock });
  h.dir = uid => path.join(dataDir, 'photos', uid);
  h.files = uid => { try { return fs.readdirSync(h.dir(uid)).sort(); } catch { return []; } };
  h.add = (uid, over = {}) => h.photos.add(uid, { kind: 'body', d: TODAY, pose: 'front', image: b64(jpeg()), w: 1200, h: 1600, ...over });
  return h;
}

/* ---------- reading the container ---------- */

test('sniff: JPEG and WebP by their own first bytes, nothing else', () => {
  assert.equal(sniff(jpeg()), 'image/jpeg');
  assert.equal(sniff(webp()), 'image/webp');
  assert.equal(sniff(PNG), null);
  assert.equal(sniff(Buffer.from('GIF89a' + 'x'.repeat(20))), null);
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniff(Buffer.alloc(4)), null);
  assert.equal(sniff('not a buffer'), null);
});

test('a JPEG loses EXIF, IPTC and comments — and nothing else', () => {
  const out = stripJpegMeta(jpeg());
  const text = out.toString('latin1');
  assert.ok(!text.includes('GPS'), 'the position is gone');
  assert.ok(!text.includes('Exif') && !text.includes('iPhone') && !text.includes('Moscow') && !text.includes('shot at home'));
  assert.ok(out.includes(JFIF), 'the JFIF header stays');
  assert.ok(out.subarray(out.length - SCAN.length).equals(SCAN), 'the picture data is byte for byte what it was');
  assert.deepEqual(out, jpeg({ exif: false, iptc: false, comment: false }));
  // one that has none is returned whole
  const clean = jpeg({ exif: false, iptc: false, comment: false });
  assert.deepEqual(stripJpegMeta(clean), clean);
  // fill bytes before a marker are legal and survive
  assert.ok(stripJpegMeta(jpeg({ fill: 3 })).subarray(-SCAN.length).equals(SCAN));
});

/* Metadata is not only at the front. A progressive JPEG has several scans with ordinary segments
   between them, and phones append whole second images after the end marker (a motion photo, a
   depth or gain map), each with EXIF of its own. Stopping at the first scan kept all of that. */
test('metadata between the scans of a progressive JPEG goes too, and the scans survive intact', () => {
  const SOI = Buffer.from([0xff, 0xd8]), EOI = Buffer.from([0xff, 0xd9]);
  const scan1 = Buffer.concat([seg(0xda, Buffer.from([1, 2, 3])), Buffer.from('first-\xff\x00-scan-\xff\xd3-restart-\xff\xff', 'latin1')]);
  const scan2 = Buffer.concat([seg(0xda, Buffer.from([4, 5, 6])), Buffer.from('second-scan-data', 'latin1')]);
  const table = seg(0xc4, Buffer.alloc(20, 3));
  const late = seg(0xe1, 'Exif\0\0' + GPS + ' hidden after the first scan');
  const out = stripJpegMeta(Buffer.concat([SOI, JFIF, seg(0xdb, Buffer.alloc(16, 7)), scan1, late, table, seg(0xfe, 'a late comment'), scan2, EOI]));
  assert.ok(!out.toString('latin1').includes('GPS') && !out.toString('latin1').includes('late comment'));
  assert.deepEqual(out, Buffer.concat([SOI, JFIF, seg(0xdb, Buffer.alloc(16, 7)), scan1, table, scan2, EOI]), 'both scans, the table between them, byte for byte');
});

test('whatever is appended after the end of the image is not kept', () => {
  const second = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, 'Exif\0\0' + GPS + ' of the embedded picture'), SCAN]);
  const out = stripJpegMeta(Buffer.concat([jpeg(), second, Buffer.from('trailing bytes with ' + GPS, 'latin1')]));
  assert.deepEqual(out, jpeg({ exif: false, iptc: false, comment: false }));
  assert.ok(!out.toString('latin1').includes('GPS'));
});

test('a picture cut short after its scan began is kept as far as it goes; one with no scan at all is not a picture', () => {
  const whole = jpeg({ exif: false, iptc: false, comment: false });
  const cut = whole.subarray(0, whole.length - 2);                 // the end marker is missing
  assert.deepEqual(stripJpegMeta(cut), cut);
  assert.equal(stripJpegMeta(Buffer.concat([Buffer.from([0xff, 0xd8]), JFIF, seg(0xdb, Buffer.alloc(16, 7)), Buffer.from([0xff, 0xd9])])), null);
});

test('hostile input ends, and never grows', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 3000; i++) {
    const body = Buffer.alloc(1 + Math.floor(rnd() * 300));
    for (let j = 0; j < body.length; j++) body[j] = rnd() < 0.3 ? 0xff : rnd() < 0.2 ? [0xd8, 0xd9, 0xda, 0xe1, 0x00, 0xd0][Math.floor(rnd() * 6)] : Math.floor(rnd() * 256);
    const input = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), body, Buffer.alloc(12)]);
    const out = stripJpegMeta(input);
    assert.ok(out === null || out.length <= input.length, 'input ' + i);
  }
});

test('a JPEG whose segments do not add up is refused, not half-read', () => {
  const good = jpeg();
  assert.equal(stripJpegMeta(good.subarray(0, 30)), null, 'cut off inside a segment');
  assert.equal(stripJpegMeta(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), Buffer.alloc(20)])), null, 'a length that runs past the end');
  assert.equal(stripJpegMeta(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]), Buffer.alloc(20)])), null, 'a length shorter than itself');
  assert.equal(stripJpegMeta(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('garbage-garbage-garbage')])), null);
  assert.equal(stripJpegMeta(Buffer.concat([Buffer.from([0xff, 0xd8]), JFIF, Buffer.alloc(8)])), null, 'no marker where one must be');
  assert.equal(stripJpegMeta(Buffer.concat([Buffer.from([0xff, 0xd8]), JFIF, Buffer.alloc(12, 0xff)])), null, 'never reaches a picture');
  assert.equal(stripJpegMeta(webp()), null);
});

test('a WebP loses its EXIF and XMP chunks, and its header stops announcing them', () => {
  const out = stripWebpMeta(webp());
  assert.ok(!out.toString('latin1').includes('GPS') && !out.toString('latin1').includes('xmpmeta'));
  assert.equal(out.readUInt32LE(4), out.length - 8, 'the container size is right again');
  assert.equal(out.toString('latin1', 12, 16), 'VP8X');
  assert.equal(out[20] & 0x0c, 0, 'EXIF and XMP flags cleared');
  assert.equal(out[20] & 0x10, 0x10, 'the other flags kept');
  assert.deepEqual(out, (() => { const w = webp({ exif: false, xmp: false }); w[20] = 0x10; return w; })());
  const clean = webp({ exif: false, xmp: false });
  assert.equal(stripWebpMeta(clean), clean, 'one without metadata is returned as it came');
  // an odd-sized chunk is padded; the walk must step over the pad byte
  assert.ok(stripWebpMeta(webp({ body: 62 })));
});

test('a WebP container that does not parse is refused', () => {
  const w = webp();
  const lying = Buffer.from(w); lying.writeUInt32LE(0xffffff, 16);          // first chunk claims to be huge
  assert.equal(stripWebpMeta(lying), null);
  assert.equal(stripWebpMeta(w.subarray(0, 12)), null, 'a header and nothing else');
  assert.equal(stripWebpMeta(jpeg()), null);
});

test('readImage: base64 in, a clean picture out — or nothing', () => {
  const ok = readImage(b64(jpeg()), MAX_PHOTO_BYTES);
  assert.equal(ok.mime, 'image/jpeg');
  assert.ok(!ok.buf.toString('latin1').includes('GPS'));
  assert.equal(readImage(b64(webp()), MAX_PHOTO_BYTES).mime, 'image/webp');
  assert.equal(readImage(b64(PNG), MAX_PHOTO_BYTES), null, 'a PNG — what Safari returns for a WebP it cannot encode');
  assert.equal(readImage('data:image/jpeg;base64,' + b64(jpeg()), MAX_PHOTO_BYTES), null, 'not bare base64');
  assert.equal(readImage('', MAX_PHOTO_BYTES), null);
  assert.equal(readImage(null, MAX_PHOTO_BYTES), null);
  assert.equal(readImage({ length: 5 }, MAX_PHOTO_BYTES), null);
  assert.equal(readImage(b64(jpeg({ body: 60000 })), 1000), null, 'over the limit it was given');
});

/* ---------- the store ---------- */

test('off by default-style config: nothing is accepted', t => {
  const h = store(t, { enabled: false });
  assert.deepEqual(h.add('u1'), { status: 403, body: { error: 'disabled' } });
  assert.deepEqual(h.files('u1'), []);
});

test('a body photo is stored as a file with an index entry, without the camera metadata', t => {
  const h = store(t);
  const r = h.add('u1', { pose: 'side' });
  assert.equal(r.status, 200);
  const p = r.body.photo;
  assert.match(p.id, /^[a-f0-9]{24}$/);
  assert.deepEqual({ ...p, id: 'x' }, { id: 'x', kind: 'body', d: TODAY, pose: 'side', mime: 'image/jpeg', w: 1200, h: 1600, bytes: jpeg({ exif: false, iptc: false, comment: false }).length, at: NOON, thumb: false });
  assert.equal(r.body.rev, 1);
  assert.equal(r.body.used, p.bytes);
  assert.deepEqual(h.files('u1'), ['index.json', p.id + '.jpg'].sort());
  const onDisk = fs.readFileSync(path.join(h.dir('u1'), p.id + '.jpg'));
  assert.ok(!onDisk.toString('latin1').includes(GPS.slice(0, 8)), 'no position on disk');
  assert.ok(!fs.readFileSync(path.join(h.dir('u1'), 'index.json'), 'utf8').includes('GPS'));
  assert.equal(h.photos.rev('u1'), 1);
  assert.equal(h.photos.rev('nobody'), 0);
});

test('a meal photo carries its day and meal; a WebP is kept as a WebP', t => {
  const h = store(t);
  const r = h.add('u1', { kind: 'meal', m: 2, image: b64(webp()), d: '2026-09-30' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.photo.kind, r.body.photo.d, r.body.photo.m, r.body.photo.mime, 'pose' in r.body.photo], ['meal', '2026-09-30', 2, 'image/webp', false]);
  assert.deepEqual(h.files('u1'), ['index.json', r.body.photo.id + '.webp'].sort());
  // a meal slot that does not exist is the first one, a pose that does not exist is the front
  assert.equal(h.add('u1', { kind: 'meal', m: 9 }).body.photo.m, 0);
  assert.equal(h.add('u1', { pose: 'upside-down' }).body.photo.pose, 'front');
});

test('what is refused, and why', t => {
  const h = store(t);
  assert.equal(h.add('u1', { kind: 'selfie' }).body.code, 'bad-kind');
  for (const d of ['2026-13-01', '2026-02-30', '02.10.2026', '', null, 20261002, '1999-12-31', '2026-10-09']) assert.equal(h.add('u1', { d }).body.code, 'bad-date', String(d));
  assert.equal(h.add('u1', { d: '2026-10-03' }).status, 200, 'the phone can be a day ahead of the server');
  assert.equal(h.add('u1', { image: b64(PNG) }).body.code, 'badimage');
  assert.equal(h.add('u1', { image: 'not base64 !!' }).body.code, 'badimage');
  assert.equal(h.add('u1', { image: undefined }).body.code, 'badimage');
  const big = h.add('u1', { image: b64(jpeg({ body: 65000 })).repeat(40) });
  assert.deepEqual([big.status, big.body.code], [413, 'toolarge']);
  assert.equal(h.photos.list('u1').items.length, 1);
});

test('a thumbnail is kept when it is a picture too, and quietly dropped when it is not', t => {
  const h = store(t);
  const withThumb = h.add('u1', { thumb: b64(jpeg({ body: 8 })) }).body.photo;
  assert.equal(withThumb.thumb, true);
  assert.deepEqual(h.files('u1'), ['index.json', withThumb.id + '.jpg', withThumb.id + '.t.jpg'].sort());
  const small = h.photos.file('u1', withThumb.id, true);
  const full = h.photos.file('u1', withThumb.id, false);
  assert.ok(small.buf.length < full.buf.length);
  assert.equal(small.etag, `"${withThumb.id}-t"`);
  assert.equal(full.etag, `"${withThumb.id}"`);
  assert.ok(!small.buf.toString('latin1').includes('GPS'), 'the thumbnail is cleaned too');

  const noThumb = h.add('u1', { thumb: b64(PNG) }).body.photo;
  assert.equal(noThumb.thumb, false);
  // asked for a thumbnail that does not exist: the picture itself
  assert.equal(h.photos.file('u1', noThumb.id, true).etag, `"${noThumb.id}"`);
  const tooBig = h.add('u1', { thumb: b64(jpeg({ body: 60000 })).repeat(3) }).body.photo;
  assert.equal(tooBig.thumb, false);
  assert.ok(MAX_THUMB_BYTES < MAX_PHOTO_BYTES);
});

test('a photo can be read by the member it belongs to and by nobody else', t => {
  const h = store(t);
  const id = h.add('ann').body.photo.id;
  assert.ok(h.photos.file('ann', id, false));
  assert.equal(h.photos.file('bob', id, false), null);
  assert.equal(h.photos.file('admin', id, false), null);
  for (const bad of ['../ann/' + id, id + '.jpg', '', null, undefined, 'index', '../../db', id.toUpperCase()]) assert.equal(h.photos.file('ann', bad, false), null, String(bad));
  assert.deepEqual(h.photos.list('bob').items, []);
});

test('the quota counts pictures and thumbnails, and says how full it is', t => {
  const h = store(t, { quotaMb: 0.001 });                       // about a kilobyte
  const first = h.add('u1');
  assert.equal(first.status, 200);
  const size = first.body.used;
  let n = 1;
  while (h.add('u1').status === 200) n++;
  assert.equal(n, Math.floor(1048.576 / size));
  const full = h.add('u1');
  assert.deepEqual([full.status, full.body.code], [409, 'quota']);
  assert.equal(full.body.used, n * size);
  assert.equal(full.body.quota, Math.round(0.001 * 1024 * 1024 * 1000) / 1000);
  // someone else's quota is their own
  assert.equal(h.add('u2').status, 200);
  // deleting makes room
  h.photos.remove('u1', [h.photos.list('u1').items[0].id]);
  assert.equal(h.add('u1').status, 200);
});

test('no more than the hourly number of uploads; the hour moves on', t => {
  const h = store(t);
  const tiny = b64(jpeg({ exif: false, iptc: false, comment: false, body: 2 }));
  for (let i = 0; i < UPLOADS_PER_HOUR; i++) assert.equal(h.add('u1', { image: tiny }).status, 200, 'upload ' + i);
  assert.equal(h.add('u1', { image: tiny }).status, 429);
  assert.equal(h.add('u2', { image: tiny }).status, 200, 'counted per member');
  h.clock += 3600001;
  assert.equal(h.add('u1', { image: tiny, d: TODAY }).status, 200);
});

test('deleting removes the entry and both files, bumps the revision, and ignores ids that are not ours', t => {
  const h = store(t);
  const a = h.add('ann', { thumb: b64(jpeg({ body: 8 })) }).body.photo.id;
  const b = h.add('ann').body.photo.id;
  const bobs = h.add('bob').body.photo.id;
  const r = h.photos.remove('ann', [a, bobs, 'nonsense', 42, null]);
  assert.equal(r.removed, 1);
  assert.equal(r.rev, 3);
  assert.deepEqual(h.files('ann'), ['index.json', b + '.jpg'].sort());
  assert.equal(h.photos.list('bob').items.length, 1, 'bob still has his');
  assert.equal(h.photos.remove('ann', 'not a list').removed, 0);
  assert.equal(h.photos.rev('ann'), 3, 'nothing removed, nothing changed');
});

test('dropUser removes the whole directory, and only that one', t => {
  const h = store(t);
  h.add('ann'); h.add('bob');
  h.photos.dropUser('ann');
  assert.equal(fs.existsSync(h.dir('ann')), false);
  assert.equal(h.photos.rev('ann'), 0);
  assert.equal(h.photos.list('bob').items.length, 1);
  // a uid that is all path characters must not resolve to the photo root itself
  for (const evil of ['..', '../..', '/', '', '././']) h.photos.dropUser(evil);
  assert.equal(h.photos.list('bob').items.length, 1);
  assert.ok(fs.existsSync(path.join(h.dataDir, 'photos')));
  h.photos.dropUser('nobody');                                   // nothing there: not an error
});

test('meal photos past the retention go on the next look; body photos never do', t => {
  const h = store(t);
  const oldMeal = h.add('u1', { kind: 'meal', d: '2026-08-20' }).body.photo.id;
  const newMeal = h.add('u1', { kind: 'meal', d: '2026-09-20' }).body.photo.id;
  const oldBody = h.add('u1', { kind: 'body', d: '2026-01-05' }).body.photo.id;
  h.conf.mealDays = 30;                                          // the admin sets a retention afterwards
  const list = h.photos.list('u1');
  assert.deepEqual(list.items.map(i => i.id).sort(), [newMeal, oldBody].sort());
  assert.equal(list.rev, 4, 'the removal is a change other devices must hear about');
  assert.equal(fs.existsSync(path.join(h.dir('u1'), oldMeal + '.jpg')), false);
  // with no retention set, everything stays
  const keep = store(t, { mealDays: 0 });
  keep.add('u1', { kind: 'meal', d: '2020-01-01' });
  assert.equal(keep.photos.list('u1').items.length, 1);
});

test('a meal photo for a day the retention has already passed is refused, not saved and then deleted', t => {
  const h = store(t, { mealDays: 30 });
  const r = h.add('u1', { kind: 'meal', d: '2026-08-20' });
  assert.deepEqual([r.status, r.body.code, r.body.days], [400, 'expired', 30]);
  assert.deepEqual(h.files('u1'), []);
  assert.equal(h.add('u1', { kind: 'meal', d: '2026-09-10' }).status, 200, 'inside the retention');
  assert.equal(h.add('u1', { kind: 'body', d: '2026-01-05' }).status, 200, 'body photos have no retention');
});

test('emptying one\'s own store deletes the pictures and moves the revision on instead of restarting it', t => {
  const h = store(t);
  h.add('u1'); h.add('u1');
  assert.equal(h.photos.rev('u1'), 2);
  assert.equal(h.photos.count('u1'), 2);
  h.photos.clear('u1');
  assert.deepEqual(h.files('u1'), ['index.json'], 'no picture left');
  assert.equal(h.photos.count('u1'), 0);
  assert.equal(h.photos.rev('u1'), 3);
  // the next upload is revision 4 — a device that last saw revision 1 or 2 can tell
  assert.equal(h.add('u1').body.rev, 4);
  // someone who never had any gets no directory out of it
  h.photos.clear('nobody');
  assert.equal(fs.existsSync(h.dir('nobody')), false);
  assert.deepEqual(h.photos.stats(), { users: 1, files: 1, bytes: h.photos.list('u1').used });
});

test('hasOn answers the reminder: a body photo filed under that day', t => {
  const h = store(t);
  h.add('u1', { d: TODAY });
  h.add('u1', { kind: 'meal', d: '2026-10-01' });
  assert.equal(h.photos.hasOn('u1', TODAY), true);
  assert.equal(h.photos.hasOn('u1', '2026-10-01'), false, 'a meal photo is not a progress photo');
  assert.equal(h.photos.hasOn('u1', '2026-10-01', 'meal'), true);
  assert.equal(h.photos.hasOn('u2', TODAY), false);
});

test('the dashboard gets counts and bytes, never ids', t => {
  const h = store(t);
  assert.deepEqual(h.photos.stats(), { users: 0, files: 0, bytes: 0 });
  const a = h.add('ann').body;
  h.add('ann'); h.add('bob');
  h.photos.dropUser('carol');
  const s = h.photos.stats();
  assert.deepEqual(s, { users: 2, files: 3, bytes: 3 * a.photo.bytes });
  assert.ok(!JSON.stringify(s).includes(a.photo.id));
});

test('an index someone mangled reads as empty, and entries it cannot trust are skipped', t => {
  const h = store(t);
  const id = h.add('u1').body.photo.id;
  const file = path.join(h.dir('u1'), 'index.json');
  const good = JSON.parse(fs.readFileSync(file, 'utf8')).items[0];
  fs.writeFileSync(file, JSON.stringify({ rev: 'x', items: [null, 5, { id: '../../db' }, { ...good, mime: 'text/html' }, { ...good, kind: 'evil' }, good] }));
  assert.deepEqual(h.photos.list('u1').items.map(i => i.id), [id]);
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(h.photos.list('u1').items, []);
  assert.equal(h.photos.file('u1', id, false), null);
  // the index says a file exists that does not: not found, not a crash
  fs.writeFileSync(file, JSON.stringify({ rev: 2, items: [{ ...good, id: 'a'.repeat(24) }] }));
  assert.equal(h.photos.file('u1', 'a'.repeat(24), false), null);
});
