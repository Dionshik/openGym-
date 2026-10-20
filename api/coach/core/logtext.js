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
import { readMatchItem, resolveMatch, tokens } from './match.js';

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

/** Like cleanText in match.js, with room for a whole session — and line breaks kept as ", ",
 *  because one exercise per line is how most people type a workout. */
export const cleanLogText = text => String(text == null ? '' : text)
  .replace(/\s*[\r\n]+\s*/g, ', ').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ')
  .replace(/^[,\s]+|[,\s]+$/g, '').slice(0, MAX_LOG_TEXT);

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

// A model writes "80", "80 kg", "8-10", 8.0 — take the first number in it, or nothing.
const num = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const inRange = (v, lo, hi) => (v != null && v >= lo && v <= hi ? v : null);
const round = (v, step) => Math.round(v / step) * step;

/**
 * One row of a logged exercise, or null when there is nothing in it to log. Out-of-range
 * numbers are dropped rather than clamped: 8000 reps is a misread, and the nearest legal value
 * would be a confident wrong one.
 */
export function readSet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const reps = inRange(num(raw.reps), 1, 500);
  const weight = inRange(num(raw.weight), 0, 1000);
  const sec = inRange(num(raw.sec), 1, 7200);
  const min = inRange(num(raw.min), 0.5, 600);
  const km = inRange(num(raw.km), 0.01, 300);
  let speed = inRange(num(raw.speed), 0.1, 60);
  if (speed == null && km != null && min != null) speed = inRange(+(km / (min / 60)).toFixed(1), 0.1, 60);
  const out = {};
  if (reps != null) out.reps = Math.round(reps);
  if (weight != null && weight > 0) out.weight = round(weight, 0.25);
  if (sec != null) out.sec = Math.round(sec);
  if (min != null) out.min = round(min, 0.5);
  if (speed != null) out.speed = round(speed, 0.1);
  if (raw.warmup === true) out.warmup = true;
  return out.reps || out.sec || out.min ? out : null;
}

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
export function validateLog(data, { customIds = [], customs = null, today = null } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['the answer must be one JSON object'] };
  if (!Array.isArray(data.items)) return { ok: false, errors: ['`items` must be an array (empty when the text names no exercise)'] };
  const own = new Set([...customIds, ...(customs || []).map(c => c && c.id).filter(Boolean)]);
  const errors = [];
  const items = [];
  data.items.slice(0, MAX_LOG_ITEMS).forEach((it, i) => {
    const r = readMatchItem(it, `items[${i}]`, own);
    if (r.error) { errors.push(r.error); return; }
    if (it.sets != null && !Array.isArray(it.sets)) { errors.push(`items[${i}].sets must be an array of set objects`); return; }
    const sets = (it.sets || []).slice(0, MAX_LOG_SETS).map(readSet).filter(Boolean);
    items.push({ ...r.item, sets });
  });
  if (errors.length) return { ok: false, errors };
  dropDoubtfulCustomIds(items, customs);
  const unit = data.unit === 'kg' || data.unit === 'lb' ? data.unit : null;
  const minutes = inRange(num(data.minutes), 1, 600);
  const start = typeof data.start === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(data.start.trim())
    ? data.start.trim().padStart(5, '0') : null;
  return { ok: true, result: { items, date: readWhen(data.when, today), start, minutes: minutes == null ? null : Math.round(minutes), unit } };
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
      const mine = tokens(nameOf.get(it.customId));
      const said = new Set([...tokens(it.said), ...it.names.flatMap(n => [...tokens(n)])]);
      keep = [...mine].some(w => said.has(w));
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
