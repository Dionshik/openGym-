/* Reading what an iOS Shortcut sends.
 *
 * The other end of this is not a program anyone tests: it is a Shortcut a person assembled by
 * hand, on a phone set to their own language and region. "80,5 кг" and "176.4 lb" are the same
 * kind of answer, body fat arrives as "18 %" or as the fraction 0.18 Health stores it as, a
 * height as 1.8 (metres) or 180, and a date however that phone writes dates. So this reads
 * generously — and then checks the result against what a human body can be, because a value
 * read wrongly must be dropped, not stored.
 *
 * Pure: no files, no clock except the one passed in. healthkit.js owns storage and tokens.
 */

export const METRICS = ['weight', 'bodyFat', 'leanMass', 'height', 'waist'];
// Accepted spellings of a field name, lower-cased with separators removed.
const ALIASES = {
  weight: ['weight', 'bodymass', 'mass', 'вес', 'масса'],
  bodyFat: ['bodyfat', 'bodyfatpercentage', 'fat', 'жир', 'процентжира'],
  leanMass: ['leanmass', 'leanbodymass', 'сухаямасса', 'безжироваямасса'],
  height: ['height', 'рост'],
  waist: ['waist', 'waistcircumference', 'талия', 'окружностьталии']
};
const FIELD = new Map();
for (const [metric, names] of Object.entries(ALIASES)) for (const n of names) FIELD.set(n, metric);
const keyOf = k => String(k).toLowerCase().replace(/[\s_\-.]/g, '');

// Canonical units: kg, %, cm. [min, max] a value must fall in to be believed.
export const BOUNDS = { weight: [20, 400], bodyFat: [2, 70], leanMass: [15, 250], height: [80, 250], waist: [30, 250] };

const LB = 0.45359237, IN = 2.54;
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12
};
const pad = n => String(n).padStart(2, '0');
const validDay = (y, m, d) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;

/**
 * The calendar day a date string names, as YYYY-MM-DD — the day as the phone wrote it, with no
 * timezone arithmetic: "2026-10-01T00:30:00+03:00" is the first of October for the person who
 * sent it, whatever day that instant is in UTC. null when no date can be read.
 */
export function dayOf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);                       // ISO 8601, with or without a time
  if (m) return validDay(+m[1], +m[2], +m[3]);
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);                          // 01.10.2026
  if (m) return validDay(+m[3], +m[2], +m[1]);
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);                          // 10/01/2026 — month first, as iOS writes it in en-US
  if (m) return validDay(+m[3], +m[1], +m[2]);
  m = s.toLowerCase().match(/(\d{1,2})\s+([a-zа-яё]{3})[a-zа-яё.]*\s+(\d{4})/);      // 1 окт. 2026 г. / 1 October 2026
  if (m && MONTHS[m[2]]) return validDay(+m[3], MONTHS[m[2]], +m[1]);
  m = s.toLowerCase().match(/([a-zа-яё]{3})[a-zа-яё.]*\s+(\d{1,2}),?\s+(\d{4})/);     // Oct 1, 2026
  if (m && MONTHS[m[1]]) return validDay(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

/** The first number in a string and whatever unit follows it: "80,5 кг" → { n: 80.5, unit: 'кг' }. */
export function readNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { n: v, unit: '' } : null;
  // A list of samples arrives as lines, newest first when the Shortcut sorts as told.
  const line = String(v == null ? '' : v).split(/\r?\n/).map(x => x.trim()).find(Boolean);
  if (!line) return null;
  const m = line.replace(/\s+/g, ' ').match(/(-?\d+(?:[.,]\d+)?)\s*([^\d\s.,;]*)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) ? { n, unit: m[2].toLowerCase() } : null;
}

const isPounds = u => /^(lb|lbs|pound|pounds|фунт)/.test(u);
const isInches = u => /^(in|inch|inches|дюйм|″|")/.test(u);
const isMetres = u => u === 'm' || u === 'м' || /^(met|метр)/.test(u);

/** One metric's value in its canonical unit, or null when it cannot be a real one. */
export function readMetric(metric, raw, { unit = '' } = {}) {
  const r = readNumber(raw);
  if (!r) return null;
  const u = r.unit || String(unit || '').toLowerCase();
  let v = r.n;
  if (metric === 'weight' || metric === 'leanMass') {
    if (isPounds(u)) v *= LB;
  } else if (metric === 'bodyFat') {
    // Health keeps body fat as a fraction; the Shortcut may hand over either form.
    if (v > 0 && v <= 1) v *= 100;
  } else {
    if (isInches(u)) v *= IN;
    else if (isMetres(u) || (v > 0 && v < 3)) v *= 100;
  }
  const [lo, hi] = BOUNDS[metric];
  if (!(v >= lo && v <= hi)) return null;
  return Math.round(v * 10) / 10;
}

/**
 * The whole request body, read.
 *
 *   { date?, unit?, weight?, weightDate?, bodyFat?, … }
 *
 * A metric's own `<name>Date` wins over the body's `date`, which wins over `today` (the server's
 * idea of today — a Shortcut that sends neither is assumed to have run when it arrived).
 *
 * @returns {{ accepted: [{ metric, d, v }], ignored: string[], warnings: string[] }}
 */
export function parseIngest(body, { today } = {}) {
  const accepted = [], ignored = [], warnings = [];
  const src = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const dates = {}, values = {};
  let unit = '', bodyDay = null;
  for (const [k, v] of Object.entries(src)) {
    const key = keyOf(k);
    if (key === 'date' || key === 'дата') { bodyDay = dayOf(v); if (!bodyDay && String(v || '').trim()) warnings.push('date: could not read it, used today'); continue; }
    if (key === 'unit' || key === 'units') { unit = String(v || ''); continue; }
    const dated = key.endsWith('date') && FIELD.get(key.slice(0, -4));
    if (dated) { dates[dated] = v; continue; }
    const metric = FIELD.get(key);
    if (metric) values[metric] = v; else ignored.push(String(k).slice(0, 40));
  }
  for (const metric of METRICS) {
    if (!(metric in values)) continue;
    const raw = values[metric];
    if (raw == null || String(raw).trim() === '') continue;              // nothing measured today: not an error
    const v = readMetric(metric, raw, { unit });
    if (v == null) { warnings.push(`${metric}: "${String(raw).slice(0, 30)}" is not a value this can be`); continue; }
    const own = metric in dates ? dayOf(String(dates[metric]).split(/\r?\n/).map(x => x.trim()).find(Boolean)) : null;
    if (metric in dates && !own && String(dates[metric] || '').trim()) warnings.push(`${metric}Date: could not read it`);
    const d = own || bodyDay || today;
    // A day in the future is a mis-set clock or a mis-read date; tomorrow is allowed for the
    // phones that are ahead of the server's timezone.
    if (today && d > nextDay(today)) { warnings.push(`${metric}: the date ${d} is in the future`); continue; }
    accepted.push({ metric, d, v });
  }
  return { accepted, ignored: ignored.slice(0, 20), warnings: warnings.slice(0, 20) };
}

function nextDay(iso) {
  const t = new Date(iso + 'T12:00:00Z').getTime() + 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
