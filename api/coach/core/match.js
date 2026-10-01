/* "Describe it in your own words": free text in, exercises out.
 *
 * The split of labour is the point of this file. The model reads the lifter's words — any
 * language, gym slang, a half-remembered name — and says in plain English what exercise that
 * is. It never sees the catalogue and never names an id. Which catalogue rows that English
 * name actually is gets decided here, deterministically, by `rankLibrary`: so the payload is a
 * sentence rather than 1,324 rows (it fits the smallest local model and costs next to nothing
 * on a paid API), and an id that does not exist cannot come back, because no id comes back.
 *
 * Like the rest of core/, nothing here touches a file, a clock or an environment, and the
 * phone that brought its own key runs this very module.
 */
import { CONTRACT } from './payload.js';
import { LIBRARY, LIB_BY_ID } from './library.js';

export const MAX_TEXT = 600;        // what one request may carry of the user's words
// These two are stated again in MATCH_SCHEMA (schemas.js) as maxItems, for providers that can
// enforce a shape while decoding; the validator below is what actually holds them.
export const MAX_ITEMS = 8;         // exercises read out of one text
export const MAX_NAMES = 4;         // English names the model may offer per exercise
export const MAX_MATCHES = 6;       // catalogue rows offered back per exercise
const MAX_CUSTOM = 60;              // the user's own exercises that ride along by name
// Below this a row shares a word with the name and little else ("press" alone finds 150 rows).
const MIN_SCORE = 0.55;
// At or above this the name the model gave is the row, give or take a "(male)".
export const EXACT_SCORE = 0.95;

/* ---------- the closed vocabularies ---------- */

// Body parts and equipment are whatever the catalogue itself uses, so a custom exercise the
// model drafts lands under a chip the app can actually show.
export const BODY_PARTS = [...new Set(LIBRARY.map(e => e.bp))].sort();
export const EQUIPMENT = [...new Set(LIBRARY.map(e => e.eq).filter(Boolean))].sort();
// Mirror of MUSCLES in frontend/src/lib/muscles.js — the eighteen the body map can shade.
// exercise-match.test.js on the frontend pins the two lists against each other.
export const MUSCLES = [
  'trapezius', 'deltoids', 'chest', 'upper-back', 'serratus',
  'biceps', 'triceps', 'forearm',
  'abs', 'obliques', 'lower-back',
  'gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors',
  'calves', 'tibialis'
];

/* ---------- what leaves ---------- */

/**
 * The payload: the words, the language to answer in, and the names of the user's own
 * exercises so "my cable thing" can resolve to one. Built by name, like payload.js — no
 * training data, no plan, no profile, and no handle either: nothing in here is about a person.
 */
export function buildMatchPayload(S, text) {
  return {
    coach_contract: CONTRACT,
    task: 'match',
    meta: { lang: (S && S.lang) || 'en' },
    text: cleanText(text),
    custom: ((S && S.customEx) || []).filter(c => c && c.id && c.n).slice(0, MAX_CUSTOM)
      .map(c => ({ id: String(c.id).slice(0, 40), n: String(c.n).slice(0, 60) }))
  };
}

/** Control characters out, whitespace folded, length capped. Empty means there is nothing to ask. */
export const cleanText = text => String(text == null ? '' : text)
  .replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

/* ---------- the validator ---------- */

const isStr = v => typeof v === 'string' && v.trim().length > 0;
const clamp = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const muscles = list => [...new Set((Array.isArray(list) ? list : []).filter(m => MUSCLES.includes(m)))];

/**
 * What the model said, reduced to what the app is prepared to act on.
 *
 * Only a broken shape is an error — that is what the repair round can fix. Everything that is
 * merely a hint is checked against its closed list and dropped when it is not on it: a body
 * part the app has no chip for, a muscle the map cannot draw, a `customId` that is not one of
 * this person's exercises. A dropped hint costs a slightly worse ranking; a refused answer
 * costs a second provider call.
 *
 * @returns {{ ok:true, items:object[] } | { ok:false, errors:string[] }}
 */
export function validateMatch(data, { customIds = [] } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['the answer must be one JSON object'] };
  if (!Array.isArray(data.items)) return { ok: false, errors: ['`items` must be an array (empty when the text names no exercise)'] };
  const own = new Set(customIds);
  const errors = [];
  const items = [];
  data.items.slice(0, MAX_ITEMS).forEach((it, i) => {
    if (!it || typeof it !== 'object') { errors.push(`items[${i}] must be an object`); return; }
    const names = [...new Set((Array.isArray(it.names) ? it.names : []).filter(isStr).map(n => clamp(n, 80).toLowerCase()))].slice(0, MAX_NAMES);
    if (!names.length) { errors.push(`items[${i}].names must list at least one English name for the exercise`); return; }
    const c = it.create && typeof it.create === 'object' ? it.create : {};
    const primary = muscles(c.primary);
    const item = {
      said: clamp(it.said, 120),
      names,
      bp: BODY_PARTS.includes(it.bp) ? it.bp : null,
      eq: EQUIPMENT.includes(it.eq) ? it.eq : null,
      create: {
        // A model that left the name out still described an exercise; its own first English
        // name is a truer label for it than refusing the whole answer.
        name: clamp(c.name, 60) || names[0],
        desc: clamp(c.desc, 600),
        primary,
        secondary: muscles(c.secondary).filter(m => !primary.includes(m))
      }
    };
    if (isStr(it.customId) && own.has(it.customId)) item.customId = it.customId;
    items.push(item);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, items };
}

/* ---------- from an English name to catalogue rows ---------- */

// Spellings that mean one thing. Applied to both sides before anything is compared, so it
// does not matter which of them the catalogue happens to use.
const JOINED = [
  [/\bpull[\s-]?downs?\b/g, 'pulldown'], [/\bpush[\s-]?downs?\b/g, 'pushdown'],
  [/\bpull[\s-]?ups?\b/g, 'pullup'], [/\bpush[\s-]?ups?\b/g, 'pushup'],
  [/\bchin[\s-]?ups?\b/g, 'chinup'], [/\bsit[\s-]?ups?\b/g, 'situp'],
  [/\bstep[\s-]?ups?\b/g, 'stepup'], [/\bdead[\s-]?lifts?\b/g, 'deadlift'],
  [/\bkick[\s-]?backs?\b/g, 'kickback'], [/\bpull[\s-]?overs?\b/g, 'pullover'],
  [/\bskull[\s-]?crushers?\b/g, 'skullcrusher'], [/\bfl(?:y|ye|yes|ies)\b/g, 'fly']
];
const ALIAS = {
  lat: 'lateral', lats: 'lateral', machine: 'lever', leverage: 'lever', ez: 'ezbar', sz: 'ezbar',
  db: 'dumbbell', bb: 'barbell', kb: 'kettlebell', calves: 'calf', tricep: 'triceps', bicep: 'biceps',
  rdl: 'romanian', ohp: 'overhead', bodyweight: 'body'
};
// Words that tell two rows of the catalogue apart on screen but say nothing about the movement.
const NOISE = new Set(['male', 'female', 'pov', 'v', 'version', 'with', 'on', 'the', 'a', 'an', 'of', 'and', 'to', 'in', 'for']);

// "press" and "abs" keep their s by the rules below; these keep it by name: the muscles are
// spelled both ways in the catalogue and are aliased above instead of stemmed. (Not a blanket
// "ends in ps" — that left dips, jumps, hops and steps unstemmed.)
const KEEP_S = new Set(['biceps', 'triceps', 'quadriceps']);
const stem = w => {
  if (w.length > 4 && /(ss|sh|ch|x)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !KEEP_S.has(w)) return w.slice(0, -1);
  return w;
};

/** A name as the set of words that carry meaning. Unicode-aware: a custom name may be Cyrillic. */
export function tokens(name) {
  let s = String(name || '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
  // "(back pov)" is which way the camera faced, not a back squat.
  s = s.replace(/\((?:back|side|front)\s+pov\)/g, ' ');
  for (const [re, to] of JOINED) s = s.replace(re, to);
  const out = new Set();
  for (const raw of s.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || NOISE.has(raw)) continue;
    const w = ALIAS[raw] || stem(raw);
    if (!NOISE.has(w)) out.add(ALIAS[w] || w);
  }
  return out;
}

const libTokens = new Map();
const tokensOfEntry = e => {
  let t = libTokens.get(e.id);
  if (!t) { t = tokens(e.n); libTokens.set(e.id, t); }
  return t;
};

/* How much of the asked-for name is in the row (coverage), and how much of the row is the
   asked-for name (precision). Coverage leads: "barbell bench press" must rank the row that has
   all three words above a longer row that also has them, and both far above one that only
   shares "press". */
function similarity(q, e) {
  if (!q.size || !e.size) return 0;
  let hit = 0;
  for (const w of q) if (e.has(w)) hit++;
  if (!hit) return 0;
  return 0.7 * (hit / q.size) + 0.3 * (hit / e.size);
}

/**
 * The catalogue rows — and the user's own exercises — that an interpreted item most plausibly
 * is, best first.
 *
 * Earlier names count for more than later ones (the model lists them most specific first), and
 * agreeing on equipment or body part breaks ties between rows whose names score alike.
 *
 * @returns {{ id:string, score:number, custom?:boolean }[]}
 */
export function rankLibrary(item, { customs = [], max = MAX_MATCHES } = {}) {
  const queries = (item.names || []).map((n, i) => ({ t: tokens(n), weight: 1 - i * 0.05 })).filter(q => q.t.size);
  const scored = [];
  const consider = (e, entryTokens, custom) => {
    let best = 0;
    for (const q of queries) best = Math.max(best, similarity(q.t, entryTokens) * q.weight);
    if (!best) return;
    // A row has to earn its place on its name; the hints only order rows that already did.
    if (best >= MIN_SCORE) {
      if (item.eq && e.eq === item.eq) best += 0.05;
      if (item.bp && e.bp === item.bp) best += 0.03;
      scored.push({ id: e.id, score: Math.min(1, +best.toFixed(3)), len: entryTokens.size, ...(custom ? { custom: true } : {}) });
    }
  };
  for (const e of LIBRARY) consider(e, tokensOfEntry(e), false);
  // The user's own exercises are matched on their own words too: their name is as likely to be
  // in the user's language as in English, and the model's English names would never find it.
  const saidTokens = tokens(item.said);
  for (const c of customs) {
    if (!c || !c.id || !c.n) continue;
    const t = tokens(c.n);
    if (c.id === item.customId) { scored.push({ id: c.id, score: 1, len: t.size, custom: true }); continue; }
    const before = scored.length;
    consider({ id: c.id, eq: c.eq, bp: c.bp }, t, true);
    if (scored.length === before) {
      const s = similarity(saidTokens, t);
      if (s >= MIN_SCORE) scored.push({ id: c.id, score: +s.toFixed(3), len: t.size, custom: true });
    }
  }
  const chosen = m => (m.id === item.customId ? 1 : 0);
  scored.sort((a, b) => chosen(b) - chosen(a) || b.score - a.score || a.len - b.len);
  return scored.slice(0, max).map(({ len, ...m }) => m);
}

/**
 * Validated items → what a client renders: per exercise, the rows it could be and the draft of
 * a new one. `exact` says the best row is the name the model gave rather than a neighbour of it.
 */
export function resolveMatch(items, S) {
  const customs = (S && S.customEx) || [];
  return (items || []).map(it => {
    const matches = rankLibrary(it, { customs });
    return {
      said: it.said,
      names: it.names,
      bp: it.bp,
      eq: it.eq,
      matches,
      exact: !!matches.length && matches[0].score >= EXACT_SCORE,
      create: it.create
    };
  });
}

export const matchName = id => LIB_BY_ID.get(id)?.n || null;
