/* The shared exercise pool.
 *
 * A custom exercise lives in its owner's state file and nobody else ever sees it. The pool is
 * how one becomes everybody's: its owner suggests it, an admin or a moderator approves it
 * (editing it first if it needs it) or declines it with a note, and an approved exercise is
 * served to every signed-in profile on the instance, next to the built-in catalogue.
 *
 * It is the first instance-wide content file — `pool.json`, beside db.json — and deliberately
 * not part of db.json: that file holds credentials and is rewritten whole on every save, and a
 * queue anybody signed in can append to has no business sharing a write path with it.
 *
 * Three decisions shape everything below.
 *
 *   The pool id IS the custom exercise's own id. So on the suggester's devices their own copy
 *   and the pool row are one exercise (their copy shadows the row; nothing in their routines
 *   or history has to be re-pointed), and if they delete their copy later the pool row is
 *   simply what the id resolves to from then on.
 *
 *   Nothing is ever deleted once it was approved. Somebody's routine and somebody's history
 *   may name the id, and a workout log stores an id and nothing else. "Remove" is `retired`:
 *   the row is still served, so it still resolves, and clients stop offering it for new use.
 *
 *   What other people's devices receive is an allowlist, like every other place this server
 *   hands one person's data to another: the exercise, never who suggested it.
 *
 * Written as a factory taking server.js's helpers, the way coach/routes.js is, so the store
 * and the routes can be driven in a test without a server.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY, libraryHas } from './coach/core/library.js';
import { BODY_PARTS, EQUIPMENT, MUSCLES } from './coach/core/match.js';

export const MAX_PENDING_PER_USER = 10;   // suggestions one profile may have waiting at a time
export const MAX_POOL = 2000;             // approved + retired rows the instance will hold
const REJECTED_DAYS = 60;                 // a declined suggestion is forgotten after this
const NOTE_MAX = 200;

// The catalogue's body parts, plus the one the app adds on top of the dataset.
const BODY = new Set([...BODY_PARTS, 'full body']);
const EQUIP = new Set(EQUIPMENT);
// The custom-exercise form stores muscles as the body map's slugs; cardio as the dataset's own word.
const MUSCLE = new Set([...MUSCLES, 'cardiovascular system']);
const libraryNames = new Set(LIBRARY.map(e => e.n.toLowerCase()));

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const muscles = v => [...new Set((Array.isArray(v) ? v : []).filter(m => MUSCLE.has(m)))].slice(0, 12);

/**
 * One suggested exercise, reduced to what the pool stores. Every field is copied in by name
 * and checked against the list the app itself offers; anything else on the object is dropped.
 *
 * @returns {{ ok:true, ex:object } | { ok:false, error:string, code:string }}
 */
export function cleanExercise(input) {
  const e = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const id = typeof e.id === 'string' ? e.id : '';
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) return { ok: false, code: 'id', error: 'not a valid exercise id' };
  const n = str(e.n, 60);
  if (!n) return { ok: false, code: 'name', error: 'the exercise needs a name' };
  if (!BODY.has(e.bp)) return { ok: false, code: 'bp', error: 'the exercise needs a body part' };
  // An exercise imported from another app arrives with `eq: "custom"`. It can be shared once
  // its owner has said what it is actually done with.
  if (!EQUIP.has(e.eq)) return { ok: false, code: 'eq', error: 'the exercise needs equipment — edit it and pick one first' };
  const primaries = muscles(e.primaries);
  const secondaries = muscles(e.secondaries).filter(m => !primaries.includes(m));
  const tg = MUSCLE.has(e.tg) ? e.tg : (primaries[0] || '');
  return {
    ok: true,
    ex: {
      id, n, bp: e.bp, eq: e.eq, tg, primaries, secondaries,
      muscleGroups: [...primaries, ...secondaries], sm: secondaries,
      desc: String(e.desc == null ? '' : e.desc).trim().slice(0, 1000)
    }
  };
}

// What every profile's device is sent: the exercise and whether it is retired. Not the status
// history, not the note, and not who suggested it.
const PUBLIC = ['id', 'n', 'bp', 'eq', 'tg', 'primaries', 'secondaries', 'muscleGroups', 'sm', 'desc'];
const publicRow = r => ({ ...Object.fromEntries(PUBLIC.map(k => [k, r[k]])), ...(r.status === 'retired' ? { retired: true } : {}) });
const live = r => r.status === 'approved' || r.status === 'retired';

/**
 * The served rows straight off the disk, for readers that are not the server's request path —
 * Coach jobs, which run with nobody's request in hand. Read per call: jobs are minutes apart
 * and the file is small. An unreadable or absent file is an empty pool.
 */
export function readPoolRows(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'pool.json'), 'utf8'));
    return (Array.isArray(raw && raw.items) ? raw.items : []).filter(r => r && typeof r.id === 'string' && live(r)).map(publicRow);
  } catch { return []; }
}

export function createPool({ dataDir, atomicWrite }) {
  const file = path.join(dataDir, 'pool.json');
  let state = { rev: 0, items: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && Array.isArray(raw.items)) state = { rev: Number(raw.rev) || 0, items: raw.items.filter(r => r && typeof r.id === 'string') };
  } catch { /* no pool yet */ }

  // `bump` when what clients are served changed (the approved/retired set or a row in it): the
  // revision is how a device learns it has to fetch the pool again.
  const save = bump => {
    if (bump) state.rev++;
    atomicWrite(file, JSON.stringify(state), 0o600);
  };
  const find = id => state.items.find(r => r.id === id) || null;
  const nameTaken = (name, exceptId) => {
    const k = name.toLowerCase();
    return libraryNames.has(k) || state.items.some(r => live(r) && r.id !== exceptId && r.n.toLowerCase() === k);
  };
  const prune = () => {
    const cutoff = Date.now() - REJECTED_DAYS * 86400000;
    state.items = state.items.filter(r => r.status !== 'rejected' || (r.reviewedAt || r.at || 0) > cutoff);
  };

  const pool = {
    rev: () => state.rev,
    /** Approved and retired rows, as a profile's device sees them. */
    publicItems: () => state.items.filter(live).map(publicRow),
    /** The same rows for server-side readers (the Coach, the MCP bridge): id → row. */
    lookup: id => { const r = find(id); return r && live(r) ? publicRow(r) : null; },

    /** A profile is being deleted: what it had waiting goes with it; what it gave stays, unsigned. */
    dropUser(uid) {
      const before = state.items.length;
      state.items = state.items.filter(r => !(r.by === uid && !live(r)));
      let touched = state.items.length !== before;
      for (const r of state.items) if (r.by === uid) { r.by = null; r.byName = null; touched = true; }
      if (touched) save(false);
    },

    routes({ json, readBody, readSession, requireMod, audit }) {
      const signedIn = (req, res) => {
        const user = readSession(req);
        if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
        return user;
      };
      const mineOf = uid => state.items.filter(r => r.by === uid).map(r => ({ id: r.id, status: r.status, ...(r.note ? { note: r.note } : {}) }));

      return {
        /* ------------------------------ everyone signed in ------------------------------ */

        'GET /api/pool': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          json(res, 200, { rev: state.rev, items: pool.publicItems(), mine: mineOf(user.id) });
        },

        // Suggest one of your own exercises, or send a corrected version of one that is still
        // waiting or was declined.
        'POST /api/pool/submit': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          const body = await readBody(req);
          const c = cleanExercise(body.exercise);
          if (!c.ok) return json(res, 400, { error: c.error, code: c.code });
          // A custom exercise may deliberately share an id with a built-in one on its owner's
          // device (it overrides it there). Shared with everyone, it would override it for everyone.
          if (libraryHas(c.ex.id)) return json(res, 409, { error: 'this exercise overrides a built-in one and cannot be shared', code: 'builtin' });
          const cur = find(c.ex.id);
          if (cur && cur.by !== user.id) return json(res, 409, { error: 'somebody else already suggested an exercise with this id', code: 'taken' });
          if (cur && live(cur)) return json(res, 409, { error: 'this exercise is already shared', code: 'shared' });
          if (nameTaken(c.ex.n, c.ex.id)) return json(res, 409, { error: `“${c.ex.n}” already exists in the library`, code: 'name' });
          if (!cur && state.items.filter(r => r.by === user.id && r.status === 'pending').length >= MAX_PENDING_PER_USER) {
            return json(res, 429, { error: `you already have ${MAX_PENDING_PER_USER} suggestions waiting — let those be looked at first`, code: 'cap' });
          }
          prune();
          const row = { ...c.ex, status: 'pending', by: user.id, byName: user.name, at: Date.now() };
          if (cur) state.items[state.items.indexOf(cur)] = row; else state.items.push(row);
          save(false);
          json(res, 200, { ok: true, mine: mineOf(user.id) });
        },

        // Take a suggestion back before anybody acted on it, or clear a declined one away.
        'POST /api/pool/withdraw': async (req, res) => {
          const user = signedIn(req, res); if (!user) return;
          const body = await readBody(req);
          const cur = find(String(body.id || ''));
          if (!cur || cur.by !== user.id) return json(res, 404, { error: 'no such suggestion' });
          if (live(cur)) return json(res, 409, { error: 'an exercise that is already shared cannot be taken back — ask a moderator to retire it', code: 'shared' });
          state.items = state.items.filter(r => r !== cur);
          save(false);
          json(res, 200, { ok: true, mine: mineOf(user.id) });
        },

        /* ------------------------------ admins and moderators ------------------------------ */

        // Everything, with who suggested it: the queue, what is shared, what was declined.
        'GET /api/mod/pool': async (req, res) => {
          if (!requireMod(req, res)) return;
          prune();
          json(res, 200, { rev: state.rev, items: state.items });
        },

        // Approve (optionally with corrections) or decline (with a note the suggester will read).
        'POST /api/mod/pool/review': async (req, res) => {
          const mod = requireMod(req, res); if (!mod) return;
          const body = await readBody(req);
          const cur = find(String(body.id || ''));
          if (!cur) return json(res, 404, { error: 'no such suggestion' });
          if (cur.status !== 'pending') return json(res, 409, { error: 'this suggestion was already decided', code: 'decided' });
          if (body.action === 'reject') {
            Object.assign(cur, { status: 'rejected', note: str(body.note, NOTE_MAX), reviewedBy: mod.id, reviewedAt: Date.now() });
            save(false);
            audit(req, 'admin.pool.reject', { user: mod, msg: cur.n });
            return json(res, 200, { ok: true, item: cur });
          }
          if (body.action !== 'approve') return json(res, 400, { error: 'action must be approve or reject' });
          let next = cur;
          if (body.edits) {
            const c = cleanExercise({ ...body.edits, id: cur.id });
            if (!c.ok) return json(res, 400, { error: c.error, code: c.code });
            next = { ...cur, ...c.ex };
          }
          if (nameTaken(next.n, cur.id)) return json(res, 409, { error: `“${next.n}” already exists in the library`, code: 'name' });
          if (state.items.filter(live).length >= MAX_POOL) return json(res, 409, { error: 'the shared pool is full', code: 'full' });
          Object.assign(cur, next, { status: 'approved', note: undefined, reviewedBy: mod.id, reviewedAt: Date.now() });
          delete cur.note;
          save(true);
          audit(req, 'admin.pool.approve', { user: mod, msg: cur.n });
          json(res, 200, { ok: true, item: cur });
        },

        // Correct a shared exercise. The id never changes — it is what routines and history hold.
        'POST /api/mod/pool/update': async (req, res) => {
          const mod = requireMod(req, res); if (!mod) return;
          const body = await readBody(req);
          const cur = find(String(body.id || ''));
          if (!cur || !live(cur)) return json(res, 404, { error: 'no such shared exercise' });
          const c = cleanExercise({ ...body.exercise, id: cur.id });
          if (!c.ok) return json(res, 400, { error: c.error, code: c.code });
          if (nameTaken(c.ex.n, cur.id)) return json(res, 409, { error: `“${c.ex.n}” already exists in the library`, code: 'name' });
          Object.assign(cur, c.ex, { reviewedBy: mod.id, reviewedAt: Date.now() });
          save(true);
          audit(req, 'admin.pool.edit', { user: mod, msg: cur.n });
          json(res, 200, { ok: true, item: cur });
        },

        // Stop offering a shared exercise (or offer it again). It keeps resolving either way.
        'POST /api/mod/pool/retire': async (req, res) => {
          const mod = requireMod(req, res); if (!mod) return;
          const body = await readBody(req);
          const cur = find(String(body.id || ''));
          if (!cur || !live(cur)) return json(res, 404, { error: 'no such shared exercise' });
          const retired = body.retired !== false;
          if (!retired && nameTaken(cur.n, cur.id)) return json(res, 409, { error: `“${cur.n}” already exists in the library`, code: 'name' });
          cur.status = retired ? 'retired' : 'approved';
          cur.reviewedBy = mod.id; cur.reviewedAt = Date.now();
          save(true);
          audit(req, retired ? 'admin.pool.retire' : 'admin.pool.restore', { user: mod, msg: cur.n });
          json(res, 200, { ok: true, item: cur });
        }
      };
    }
  };
  return pool;
}
