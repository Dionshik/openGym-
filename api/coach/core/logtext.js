/* "Describe the workout you did": free text in, a past workout's draft out.
 *
 * The exercise lookup (match.js) with the rest of a training-log line read too — the sets, the
 * reps, the weight, which day it was. The split of labour is the same and for the same reason:
 * the model only *reads* — it says in plain English what each exercise is and copies the
 * numbers out — and everything that could be wrong in a way that matters is decided here,
 * deterministically. Which catalogue row an English name is (`resolveMatch`), whether a number
 * is a plausible set, and which date "on Friday" is: a model that cannot count weekdays never
 * gets to, it names the weekday and this file does the arithmetic against `meta.today`.
 *
 * Nothing is logged by any of this. The client turns the answer into a draft on the ordinary
 * "log a past workout" screen, where the person checks every exercise and every set before
 * anything is saved.
 *
 * Like the rest of core/, nothing here touches a file, a clock or an environment; "today" comes
 * in from the caller, and the phone that brought its own key runs this very module.
 */
import { CONTRACT } from './payload.js';
import { readMatchItem, resolveMatch, tokens, sameWord } from './match.js';
import { dateFromText, piecesForItems, setsFromText, unitFromText, readSet, num } from './logtext-parse.js';

export const MAX_LOG_TEXT = 1500;   // a whole session, typed out
// Stated again in LOGTEXT_SCHEMA (schemas.js) as maxItems; the validator is what holds them.
export const MAX_LOG_ITEMS = 15;    // exercises in one workout
export const MAX_LOG_SETS = 30;     // rows under one exercise
const MAX_CUSTOM = 60;
const MAX_DAYS_BACK = 400;
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const toDate = iso => { const m = ISO.exec(String(iso || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
const fromDate = d => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return fromDate(d); };
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
/** A real calendar date — "2026-02-30" parses in JS and silently becomes March. */
export const isISODate = s => { const d = toDate(s); return !!d && fromDate(d) === s; };

/* ---------- what leaves ---------- */

/** Like cleanText in match.js, with room for a whole session — and with its line breaks kept:
 *  one exercise per line is how most people type a workout, and the lines are what
 *  logtext-parse.js reads the day and the sets from. */
export const cleanLogText = text => String(text == null ? '' : text)
  .replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
  .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
  .slice(0, MAX_LOG_TEXT);

/**
 * The payload: the words, the language and weight unit the person uses, today's date (so the
 * model can read "12.10" as a date in the right year), and the names of their own exercises.
 * No training data, no plan, no profile — the same promise the exercise lookup makes.
 *
 * @param {string} today  the person's own date, YYYY-MM-DD — their clock, not the server's
 */
export function buildLogPayload(S, text, { today } = {}) {
  const day = isISODate(today) ? today : null;
  return {
    coach_contract: CONTRACT,
    task: 'logtext',
    meta: {
      lang: (S && S.lang) || 'en',
      unit: S && S.unit === 'lb' ? 'lb' : 'kg',
      today: day,
      weekday: day ? WEEKDAYS[toDate(day).getUTCDay()] : null
    },
    text: cleanLogText(text),
    custom: ((S && S.customEx) || []).filter(c => c && c.id && c.n).slice(0, MAX_CUSTOM)
      .map(c => ({ id: String(c.id).slice(0, 40), n: String(c.n).slice(0, 60) }))
  };
}

/* ---------- the validator ---------- */

// readSet — the check every row passes — lives in logtext-parse.js, so the demo can use it
// without loading the catalogue this module pulls in; it is re-exported from here.
export { readSet };
const inRange = (v, lo, hi) => (v != null && v >= lo && v <= hi ? v : null);

/**
 * The day the text names, as a date no later than `today` and not much more than a year back —
 * or null, and the person picks it on the draft. An explicit date wins over a weekday, which
 * wins over "N days ago"; a date in the future is the model getting the year wrong, and is
 * dropped rather than guessed at.
 */
export function readWhen(when, today) {
  if (!isISODate(today) || !when || typeof when !== 'object') return null;
  const ok = iso => isISODate(iso) && iso <= today && daysBetween(iso, today) <= MAX_DAYS_BACK ? iso : null;
  if (typeof when.date === 'string' && when.date.trim()) return ok(when.date.trim().slice(0, 10));
  const wd = WEEKDAYS.indexOf(String(when.weekday || '').trim().toLowerCase());
  if (wd >= 0) {
    // The most recent such day before today: someone logging today's session says "today".
    const back = ((toDate(today).getUTCDay() - wd + 7) % 7) || 7;
    return ok(addDays(today, -back));
  }
  const n = num(when.daysAgo);
  if (n != null && Number.isInteger(n) && n >= 0) return ok(addDays(today, -n));
  return null;
}

/**
 * What the model said, reduced to what the app is prepared to act on. As in match.js only a
 * broken shape is an error (that is what the repair round can fix); a bad number is dropped,
 * an unreadable date becomes "pick one".
 *
 * @returns {{ ok:true, result:{ items:object[], date:string|null, start:string|null, minutes:number|null, unit:'kg'|'lb'|null } }
 *         | { ok:false, errors:string[] }}
 */
/**
 * The rows a model wrote for one exercise, in whatever shape it chose: the asked-for array of
 * rows, one row object, a row that says how many times it was done (`{ sets: 3, reps: 8 }`),
 * a count with the numbers on the exercise itself, or the shorthand as a string ("3x8 80").
 * Each row is then checked by readSet; this only unfolds them.
 */
export function modelRows(it) {
  const own = { reps: it.reps, weight: it.weight, sec: it.sec, min: it.min, km: it.km };
  let raw = it.sets;
  if (typeof raw === 'string' && !/^\s*\d+\s*$/.test(raw)) return setsFromText(raw);
  if (raw != null && num(raw) != null && (typeof raw === 'number' || typeof raw === 'string')) {
    const n = Math.round(num(raw));
    return n >= 1 && n <= MAX_LOG_SETS ? Array.from({ length: n }, () => ({ ...own })) : [];
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) raw = [raw];
  if (!Array.isArray(raw)) return (own.reps != null || own.sec != null || own.min != null) ? [own] : [];
  return raw.flatMap(r => {
    if (typeof r === 'string') return setsFromText(r);
    const n = r && typeof r === 'object' ? num(r.count ?? r.times ?? r.sets) : null;
    return n != null && n > 1 && n <= MAX_LOG_SETS ? Array.from({ length: Math.round(n) }, () => ({ ...r })) : [r];
  });
}

export function validateLog(data, { customIds = [], customs = null, today = null, text = null } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['the answer must be one JSON object'] };
  if (!Array.isArray(data.items)) return { ok: false, errors: ['`items` must be an array (empty when the text names no exercise)'] };
  const own = new Set([...customIds, ...(customs || []).map(c => c && c.id).filter(Boolean)]);
  const errors = [];
  const items = [];
  data.items.slice(0, MAX_LOG_ITEMS).forEach((it, i) => {
    const r = readMatchItem(it, `items[${i}]`, own);
    if (r.error) { errors.push(r.error); return; }
    const sets = modelRows(it).slice(0, MAX_LOG_SETS).map(readSet).filter(Boolean);
    items.push({ ...r.item, sets });
  });
  if (errors.length) return { ok: false, errors };
  dropDoubtfulCustomIds(items, customs);
  // What the model left out, read from the text itself: the sets of an exercise it returned
  // without any, from the line that exercise is on (logtext-parse.js).
  if (text) {
    const lines = piecesForItems(text, items, isISODate(today) ? today : null);
    items.forEach((it, k) => {
      if (!it.sets.length && lines[k]) it.sets = setsFromText(lines[k]).slice(0, MAX_LOG_SETS).map(readSet).filter(Boolean);
    });
  }
  // The unit is what the text says, not what the model assumed: a model copying an example with
  // "kg" in it would otherwise turn a pound profile's 185 into 408. No unit in the text means
  // the person's own (null). Without the text (tests, older callers) the model's word stands.
  const unit = text ? unitFromText(text) : (data.unit === 'kg' || data.unit === 'lb' ? data.unit : null);
  const minutes = inRange(num(data.minutes), 1, 600);
  const start = typeof data.start === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(data.start.trim())
    ? data.start.trim().padStart(5, '0') : null;
  // The day: from the text when it says one (no interpretation needed), else the model's reading.
  const said = text && isISODate(today) ? dateFromText(text, today) : null;
  const date = said ? said.iso : readWhen(data.when, today);
  return { ok: true, result: { items, date, start, minutes: minutes == null ? null : Math.round(minutes), unit } };
}

/**
 * "This is one of your own exercises" is the one claim in an answer that the ranking takes on
 * trust (rankLibrary puts that exercise first, at full score), so it is checked here. A small
 * model shown a list with one custom exercise in it will happily stamp that id on every line
 * of a workout — so an id claimed by more than one line is dropped from all of them, and an id
 * whose name shares not a single word with what the person typed, or with the model's own
 * English names for the line, is dropped too. Dropping it costs nothing: the line is still
 * resolved by name, and the person's own exercises are still searched by their words.
 * Mutates `items`.
 */
export function dropDoubtfulCustomIds(items, customs) {
  const claims = new Map();
  for (const it of items) if (it.customId) claims.set(it.customId, (claims.get(it.customId) || 0) + 1);
  const nameOf = new Map((customs || []).filter(c => c && c.id).map(c => [c.id, c.n]));
  for (const it of items) {
    if (!it.customId) continue;
    let keep = claims.get(it.customId) === 1;
    if (keep && nameOf.has(it.customId)) {
      // Word by word, allowing for an ending: "в хаммере" names "Хаммер", "бабочку" "Бабочка".
      const mine = [...tokens(nameOf.get(it.customId))];
      const said = [...tokens(it.said), ...it.names.flatMap(n => [...tokens(n)])];
      keep = mine.some(w => said.some(s => sameWord(w, s)));
    }
    if (!keep) delete it.customId;
  }
  return items;
}

/** Validated answer → what the client renders: each exercise resolved against the catalogue and
 *  the person's own exercises, exactly as the lookup does, with its sets beside it. */
export function resolveLog(result, S) {
  const items = (result && result.items) || [];
  const resolved = resolveMatch(items, S);
  return {
    date: result.date || null, start: result.start || null, minutes: result.minutes || null, unit: result.unit || null,
    items: resolved.map((r, i) => ({ ...r, sets: items[i].sets || [] }))
  };
}
