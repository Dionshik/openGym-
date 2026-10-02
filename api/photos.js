/* Photographs a member keeps: of their body, to see it change, and of what they ate.
 *
 * Files, not profile data. A profile's state is one JSON document the app PUTs back whole and
 * keeps in the browser's localStorage; a picture belongs in neither. So each member has a
 * directory here that this server alone writes:
 *
 *   photos/<uid>/index.json      { rev, items: [{ id, kind, d, m?, pose?, mime, w, h, bytes, at, tm?, tb? }] }
 *   photos/<uid>/<id>.jpg|webp   the picture
 *   photos/<uid>/<id>.t.jpg|webp its thumbnail, when the app sent one
 *
 * The index is the truth about what exists — nothing in the profile points at a file, so an
 * imported backup or a reset cannot leave a pointer to nothing. Its `rev` rides on /api/data
 * and /api/data/rev like the pool's and Health's, which is how a second device learns to fetch.
 *
 *   The app shrinks and re-encodes a picture before it sends it (frontend lib/image-prep.js), so
 *   what arrives is a JPEG or a WebP of a megabyte at most, with no camera metadata. Neither is
 *   taken on trust: the bytes are sniffed, anything else is refused — a PNG included, which is
 *   what Safari hands back when asked for a WebP it cannot encode — and EXIF, XMP and IPTC are
 *   cut out of whatever a client did send, because a body photo taken at home must not carry
 *   the address of that home into every backup of ./data.
 *
 *   Nothing here is encrypted, like everything else in ./data: whoever can read the disk can
 *   open these files. That is why the store is off until the admin turns it on, and why there
 *   is no route by which an admin — or anyone but the member — can fetch a member's photo:
 *   every read is scoped to the session's own uid.
 *
 *   A member can always delete, on or off: switching the feature off must not strand anyone's
 *   pictures on a server they can no longer reach them through. While it is off, /api/data tells
 *   a member who still has photos here how many (server.js `photosLeft`), and the app offers to
 *   delete them.
 *
 * Deliberately no relation to the AI lane (coach/food-jobs.js): a photo sent to be read is held
 * in memory there and never written. Keeping one is a second, explicit upload to this module.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const KINDS = ['body', 'meal'];
export const POSES = ['front', 'side', 'back', 'flex'];
export const MEAL_SLOTS = 4;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_THUMB_BYTES = 80 * 1024;
export const MAX_ITEMS = 6000;
export const UPLOADS_PER_HOUR = 120;
const MAX_DELETE = 100;

const safe = uid => String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
const ID = /^[a-f0-9]{24}$/;
const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** 'image/jpeg' | 'image/webp' by the file's own first bytes; null for anything else. */
export function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * The same JPEG without its EXIF/XMP (APP1), IPTC (APP13) and comment segments — where a camera
 * writes the time, the device and the GPS position — wherever in the file they sit, and without
 * anything that follows the end of the image. The picture data is untouched. null for a file
 * whose segments do not add up, which is refused rather than stored half-understood.
 *
 * The walk does not stop at the first scan. A progressive JPEG has several, with ordinary
 * segments between them, and a metadata segment is as legal there as before the first; and
 * phones append whole second images after the end marker (a motion photo, a depth or gain map),
 * each with EXIF of its own. So scan data is stepped over to the next marker and the walk goes
 * on, and it ends at the end-of-image marker with whatever comes after it left behind.
 */
export function stripJpegMeta(buf) {
  if (sniff(buf) !== 'image/jpeg') return null;
  const out = [buf.subarray(0, 2)];
  let pos = 2;
  let scans = 0;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) return null;
    let m = pos + 1;
    while (m < buf.length && buf[m] === 0xff) m++;            // fill bytes before a marker
    if (m >= buf.length) return null;
    const marker = buf[m];
    if (marker === 0xd9) { out.push(Buffer.from([0xff, 0xd9])); return scans ? Buffer.concat(out) : null; }   // end of image: nothing after it is kept
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(buf.subarray(pos, m + 1)); pos = m + 1; continue; }
    if (m + 3 > buf.length) return null;
    const len = buf.readUInt16BE(m + 1);
    const end = m + 1 + len;
    if (len < 2 || end > buf.length) return null;
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) out.push(buf.subarray(pos, end));
    pos = end;
    if (marker !== 0xda) continue;
    // Start of scan: compressed data follows its header, up to the next real marker. Inside it
    // FF 00 is a data byte, FF D0–D7 are restart markers and FF FF is padding — none ends it.
    scans += 1;
    let i = pos;
    while (i < buf.length) {
      if (buf[i] === 0xff && i + 1 < buf.length) {
        const next = buf[i + 1];
        if (next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) break;
      }
      i++;
    }
    out.push(buf.subarray(pos, i));
    pos = i;
  }
  // No end marker: a picture cut short still decodes as far as it goes, and is kept as it came.
  return scans ? Buffer.concat(out) : null;
}

/** The same WebP without its EXIF and XMP chunks; null when the container does not parse. */
export function stripWebpMeta(buf) {
  if (sniff(buf) !== 'image/webp') return null;
  const chunks = [];
  let pos = 12, dropped = false;
  while (pos + 8 <= buf.length) {
    const tag = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const end = pos + 8 + size + (size & 1);                  // payloads are padded to an even length
    if (end > buf.length + (size & 1)) return null;
    if (tag === 'EXIF' || tag === 'XMP ') dropped = true;
    else chunks.push(Buffer.from(buf.subarray(pos, Math.min(end, buf.length))));
    pos = end;
  }
  if (!chunks.length) return null;
  if (!dropped) return buf;
  // The extended header says which optional chunks follow: clear the two that are gone.
  const vp8x = chunks.find(c => c.toString('latin1', 0, 4) === 'VP8X');
  if (vp8x && vp8x.length > 8) vp8x[8] &= ~0x0c;
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(4 + body.length, 4); head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

/** Base64 from the app → { buf, mime } with metadata removed, or null for anything not a picture we keep. */
export function readImage(b64, maxBytes) {
  if (typeof b64 !== 'string' || !b64 || b64.length > Math.ceil(maxBytes / 3) * 4 + 8) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const raw = Buffer.from(b64, 'base64');
  if (raw.length > maxBytes) return null;
  const mime = sniff(raw);
  const buf = mime === 'image/jpeg' ? stripJpegMeta(raw) : mime === 'image/webp' ? stripWebpMeta(raw) : null;
  return buf ? { buf, mime } : null;
}

const validDay = (d, today) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const ms = Date.parse(d + 'T12:00:00Z');
  // A picture may be filed under an earlier day, and "today" on the phone can be a day ahead of
  // this server's UTC date — but not under next month.
  return Number.isFinite(ms) && isoDay(ms) === d && d >= '2000-01-01' && ms <= Date.parse(today + 'T12:00:00Z') + 2 * 86400000;
};
const dim = v => (Number.isInteger(v) && v > 0 && v <= 20000 ? v : 0);

export function createPhotos({ dataDir, atomicWrite, settings, now = () => Date.now() }) {
  const root = path.join(dataDir, 'photos');
  const dirOf = uid => path.join(root, safe(uid));
  const indexOf = uid => path.join(dirOf(uid), 'index.json');
  const fileOf = (uid, item, thumb) => path.join(dirOf(uid), `${item.id}${thumb ? '.t' : ''}.${EXT[thumb ? item.tm : item.mime]}`);

  const conf = () => settings.get().photos;
  const enabled = () => conf().enabled === true;
  const quota = () => conf().quotaMb * 1024 * 1024;

  const read = uid => {
    try {
      const raw = JSON.parse(fs.readFileSync(indexOf(uid), 'utf8'));
      const items = Array.isArray(raw.items) ? raw.items.filter(i => record(i) && ID.test(i.id) && EXT[i.mime] && KINDS.includes(i.kind)) : [];
      return { rev: Number.isInteger(raw.rev) ? raw.rev : 0, items };
    } catch { return { rev: 0, items: [] }; }
  };
  const write = (uid, store) => {
    fs.mkdirSync(dirOf(uid), { recursive: true, mode: 0o700 });
    atomicWrite(indexOf(uid), JSON.stringify(store), 0o600);
  };
  const usedOf = store => store.items.reduce((a, i) => a + (i.bytes || 0) + (i.tb || 0), 0);
  const unlink = (uid, item) => {
    try { fs.unlinkSync(fileOf(uid, item, false)); } catch { /* already gone */ }
    if (item.tm) { try { fs.unlinkSync(fileOf(uid, item, true)); } catch { /* already gone */ } }
  };
  /** Meal photos past the instance's retention, if it has one. Returns whether anything went. */
  const expire = (uid, store) => {
    const days = conf().mealDays;
    if (!(days > 0)) return false;
    const cutoff = isoDay(now() - days * 86400000);
    const old = store.items.filter(i => i.kind === 'meal' && i.d < cutoff);
    if (!old.length) return false;
    store.items = store.items.filter(i => !old.includes(i));
    store.rev += 1;
    write(uid, store);                       // the index first: a crash leaves an orphan file, never a dead entry
    old.forEach(i => unlink(uid, i));
    return true;
  };
  const publicItem = i => ({ id: i.id, kind: i.kind, d: i.d, ...(i.kind === 'meal' ? { m: i.m } : { pose: i.pose }), mime: i.mime, w: i.w || 0, h: i.h || 0, bytes: i.bytes || 0, at: i.at || 0, thumb: !!i.tm });
  const summary = store => ({ rev: store.rev, used: usedOf(store), quota: quota() });

  const recent = new Map();                  // uid → timestamps of this hour's uploads

  const photos = {
    enabled,
    publicConfig: () => enabled(),
    rev: uid => read(uid).rev,
    /** For the dashboard: how many members keep photos and what they weigh. Never whose, or what. */
    stats() {
      let users = 0, files = 0, bytes = 0;
      let dirs = [];
      try { dirs = fs.readdirSync(root); } catch { /* nothing stored yet */ }
      for (const uid of dirs) {
        const store = read(uid);
        if (!store.items.length) continue;
        users += 1; files += store.items.length; bytes += usedOf(store);
      }
      return { users, files, bytes };
    },
    /** Whether a photo of `kind` is filed under day `d` — what a "progress photo" reminder asks. */
    hasOn: (uid, d, kind = 'body') => read(uid).items.some(i => i.d === d && i.kind === kind),

    list(uid) {
      const store = read(uid);
      expire(uid, store);
      return { ...summary(store), maxBytes: MAX_PHOTO_BYTES, items: store.items.map(publicItem) };
    },

    /** @returns {{ status: number, body: object }} */
    add(uid, body) {
      if (!enabled()) return { status: 403, body: { error: 'disabled' } };
      const since = (recent.get(uid) || []).filter(t => now() - t < 3600000);
      if (since.length >= UPLOADS_PER_HOUR) return { status: 429, body: { error: 'too many uploads — try again later', code: 'throttled' } };
      const kind = KINDS.includes(body.kind) ? body.kind : null;
      if (!kind) return { status: 400, body: { error: 'unknown kind', code: 'bad-kind' } };
      if (!validDay(body.d, isoDay(now()))) return { status: 400, body: { error: 'bad date', code: 'bad-date' } };
      // Filed under a day this instance no longer keeps meal photos for: it would be accepted
      // now and deleted on the next look, with "saved" on the member's screen in between.
      if (kind === 'meal' && conf().mealDays > 0 && body.d < isoDay(now() - conf().mealDays * 86400000)) {
        return { status: 400, body: { error: 'older than this server keeps meal photos', code: 'expired', days: conf().mealDays } };
      }
      const m = Number.isInteger(body.m) && body.m >= 0 && body.m < MEAL_SLOTS ? body.m : 0;
      const pose = POSES.includes(body.pose) ? body.pose : 'front';
      if (typeof body.image === 'string' && body.image.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 8) return { status: 413, body: { error: 'photo too large', code: 'toolarge' } };
      const image = readImage(body.image, MAX_PHOTO_BYTES);
      if (!image) return { status: 400, body: { error: 'not a JPEG or WebP image', code: 'badimage' } };
      // A thumbnail is a convenience: one that does not pass is simply not kept.
      const thumb = body.thumb ? readImage(body.thumb, MAX_THUMB_BYTES) : null;

      const store = read(uid);
      expire(uid, store);
      if (store.items.length >= MAX_ITEMS) return { status: 409, body: { error: 'too many photos', code: 'quota', ...summary(store) } };
      const size = image.buf.length + (thumb ? thumb.buf.length : 0);
      if (usedOf(store) + size > quota()) return { status: 409, body: { error: 'photo storage is full', code: 'quota', ...summary(store) } };

      const item = {
        id: crypto.randomBytes(12).toString('hex'), kind, d: body.d, ...(kind === 'meal' ? { m } : { pose }),
        mime: image.mime, w: dim(body.w), h: dim(body.h), bytes: image.buf.length, at: now(),
        ...(thumb ? { tm: thumb.mime, tb: thumb.buf.length } : {})
      };
      fs.mkdirSync(dirOf(uid), { recursive: true, mode: 0o700 });
      atomicWrite(fileOf(uid, item, false), image.buf, 0o600);          // files first: an entry never points at nothing
      if (thumb) atomicWrite(fileOf(uid, item, true), thumb.buf, 0o600);
      store.items.push(item);
      store.rev += 1;
      write(uid, store);
      recent.set(uid, [...since, now()]);
      return { status: 200, body: { photo: publicItem(item), ...summary(store) } };
    },

    /** The bytes of one of `uid`'s own photos, or null — an id that is someone else's is simply not found. */
    file(uid, id, thumb) {
      if (!ID.test(String(id))) return null;
      const item = read(uid).items.find(i => i.id === id);
      if (!item) return null;
      const small = thumb && !!item.tm;
      try { return { buf: fs.readFileSync(fileOf(uid, item, small)), mime: small ? item.tm : item.mime, etag: `"${item.id}${small ? '-t' : ''}"` }; }
      catch { return null; }
    },

    remove(uid, ids) {
      const want = new Set((Array.isArray(ids) ? ids : []).slice(0, MAX_DELETE).filter(i => typeof i === 'string' && ID.test(i)));
      const store = read(uid);
      const gone = store.items.filter(i => want.has(i.id));
      if (gone.length) {
        store.items = store.items.filter(i => !want.has(i.id));
        store.rev += 1;
        write(uid, store);
        gone.forEach(i => unlink(uid, i));
      }
      return { removed: gone.length, ...summary(store) };
    },

    /** Everything of one member's, the directory included: the account is gone. */
    dropUser(uid) {
      const dir = dirOf(uid);
      if (path.dirname(dir) !== root || !safe(uid)) return;
      fs.rmSync(dir, { recursive: true, force: true });
      recent.delete(uid);
    },
    /**
     * Every photo of one member's, at their own request. The pictures go; an empty index stays,
     * carrying the next revision — if the count restarted at zero, a second device holding
     * "revision 1" would take the first photo uploaded afterwards (revision 1 again) for the
     * list it already has.
     */
    clear(uid) {
      const rev = read(uid).rev;
      photos.dropUser(uid);
      if (rev > 0) write(uid, { rev: rev + 1, items: [] });
    },
    /** How many photos a member still has here — asked while the store is switched off. */
    count: uid => read(uid).items.length,

    routes({ json, send, readBody, readSession, audit }) {
      const signedIn = (req, res) => {
        const user = readSession(req);
        if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
        return user;
      };
      const off = res => json(res, 403, { error: 'disabled' });
      return {
        'GET /api/photos': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          if (!enabled()) return off(res);
          json(res, 200, photos.list(user.id));
        },
        'POST /api/photos': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          if (!enabled()) return off(res);
          const r = photos.add(user.id, await readBody(req));
          json(res, r.status, r.body);
        },
        // The picture itself. `private, no-cache` with an ETag: the browser may keep a copy but
        // has to ask before showing it, so a signed-out browser shows nothing and an unchanged
        // photo is not downloaded twice.
        'GET /api/photo': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          if (!enabled()) return off(res);
          const q = new URL(req.url, 'http://x').searchParams;
          const f = photos.file(user.id, q.get('id'), q.get('thumb') === '1');
          if (!f) return json(res, 404, { error: 'no such photo' });
          const headers = { ETag: f.etag, 'Cache-Control': 'private, no-cache', 'Cross-Origin-Resource-Policy': 'same-origin' };
          if (req.headers['if-none-match'] === f.etag) return send(res, 304, null, headers);
          send(res, 200, f.buf, { 'Content-Type': f.mime, ...headers });
        },
        // Works with the feature off too: a member's way to take their pictures back.
        'POST /api/photos/delete': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          const body = await readBody(req);
          json(res, 200, { ok: true, ...photos.remove(user.id, body.ids) });
        },
        'POST /api/photos/clear': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          photos.clear(user.id);
          audit(req, 'auth.photos.clear', { user });
          json(res, 200, { ok: true });
        }
      };
    }
  };
  return photos;
}
