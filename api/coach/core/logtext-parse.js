/* A typed-out workout, read without a model: the day, the unit, and the sets on each line.
 *
 * The model is good at the part that needs understanding — which exercise "бабочка" or "the
 * pulldown machine" is — and unreliable at copying numbers into a schema: a small local model
 * under a grammar will happily answer every line with an empty `sets` array and no `when`.
 * The numbers are the part a pattern reads better anyway. So this module reads them straight
 * from the text the person typed, and logtext.js uses it wherever the model left a gap: the day
 * and the unit always (neither is a matter of interpretation), the sets of any exercise the
 * model returned without them.
 *
 * Conservative on purpose. A line it cannot read gives no sets rather than a guess; a date is
 * only taken from the start of the first line, or from a line that is nothing but an
 * unmistakable date — "бег 3.5 км", "1.5 часа" or a lone "22.5" are never a day. Russian and
 * English; numbers are numbers in every language. Every word it treats as a unit or a filler
 * is listed by its real forms, never as an open prefix: "раз…" would swallow "разводка".
 *
 * Pure, like the rest of core/: "today" comes in from the caller. Also the home of readSet, the
 * check every row passes, so the phone's demo can use it without loading the catalogue.
 */

const L = '\\p{L}';
/** A whole word (or words) in a regex source: no letter may touch it on either side. */
const wb = src => `(?<![${L}])(?:${src})(?![${L}])`;
const word = src => new RegExp(`(?<![${L}\\p{N}])(?:${src})(?![${L}])`, 'iu');

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const toDate = iso => { const m = ISO.exec(String(iso || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
const fromDate = d => d.toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return fromDate(d); };
const real = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? fromDate(dt) : null; };
const MAX_DAYS_BACK = 400;
const RECENT_DAYS = 45;

/* ---------- the words around the numbers, by their real forms ---------- */

const TIMES = 'раз|раза';
const REPS = 'повтор|повтора|повторов|повторы|повторение|повторения|повторений|reps?|repetitions?';
const SETS = 'подход|подхода|подходов|подходы|подходами|сет|сета|сетов|сеты|sets?';
const SECW = 'сек|секунд|секунда|секунды|секунду|sec|secs|second|seconds';
const MINW = 'мин|минут|минута|минуты|минуту|min|mins|minute|minutes';
const HOURS = 'ч|час|часа|часов|h|hr|hrs|hour|hours';
const KGW = 'кг|kg|kgs|килограмм|килограмма|килограммов';
const LBW = 'lb|lbs|фунт|фунта|фунтов';
const KMW = 'км|km';
const SPEEDW = 'км/ч|km/h|kmh|kph';
const WARM = `размин${L}*|warm-?ups?|warming`;
const REST = `отдых|отдыха|rest|пауза|паузы|перерыв|перерыва`;

const N = '(\\d+(?:\\.\\d+)?)';
const SEC = `(?:${wb(SECW)}\\.?|с(?=\\s*(?:$|[,;)]))|s(?=\\s*(?:$|[,;)])))`;
const MIN = `(?:${wb(MINW)}\\.?)`;
const KG = wb(KGW);
const LB = wb(LBW);
const PREP = `(?:${wb('по|на|с|со|at|with')}|@)`;

// What may stand around the numbers of a set without being an exercise's name.
const FILLER = new RegExp(wb([TIMES, REPS, SETS, SECW, MINW, KGW, LBW, KMW, 'по|на|с|со|x|х|at|of|and|и|after|после', WARM, REST, 'между'].join('|')), 'giu');
const numericOnly = s => !String(s).replace(/(\d)\s*[xх×*]\s*(?=\d)/g, '$1 ').replace(/[\d.,:×*+\-–—()@/]/g, ' ')
  .replace(FILLER, ' ').replace(/[^\p{L}]+/gu, '').length;

/**
 * The text as the pieces a person separates exercises with: lines, then commas and semicolons
 * within a line — except that a piece with nothing but numbers in it ("85×6" in "жим 80×8,
 * 85×6, 90×4") belongs to the exercise before it on the same line. A new line always starts a
 * new piece, so a date on a line of its own stays one.
 */
export function splitPieces(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    let first = true;
    for (const part of line.split(/;|,(?!\d)/)) {
      const p = part.replace(/\s+/g, ' ').trim();
      if (!p) continue;
      if (!first && out.length && /\d/.test(p) && numericOnly(p)) out[out.length - 1] += ', ' + p;
      else out.push(p);
      first = false;
    }
  }
  return out;
}

/* ---------- the unit ---------- */

/** 'kg' or 'lb' when the text names exactly one of them, else null — the profile's unit then. */
export function unitFromText(text) {
  const s = String(text || '').toLowerCase();
  const kg = new RegExp(`\\d\\s*${KG}|${KG}`, 'iu').test(s);
  const lb = new RegExp(`\\d\\s*${LB}|${LB}`, 'iu').test(s);
  return kg === lb ? null : kg ? 'kg' : 'lb';
}

/* ---------- the day ---------- */

const MONTHS = [
  'январ[ьяе]|янв|january|jan', 'феврал[ьяе]|фев|february|feb', 'март[ае]?|мар|march|mar', 'апрел[ьяе]|апр|april|apr',
  'ма[йяе]|may', 'июн[ьяе]|июн|june|jun', 'июл[ьяе]|июл|july|jul', 'август[ае]?|авг|august|aug',
  'сентябр[ьяе]|сент?|september|sept?', 'октябр[ьяе]|окт|october|oct', 'ноябр[ьяе]|нояб?|november|nov', 'декабр[ьяе]|дек|december|dec'
].map(src => new RegExp(`^(?:${src})\\.?$`, 'iu'));
const monthOf = w => { const i = MONTHS.findIndex(re => re.test(String(w || ''))); return i < 0 ? 0 : i + 1; };
const WEEKDAYS = [
  [0, 'воскресенье|воскресенья|воскресенью|sunday'], [1, 'понедельник|понедельника|monday'], [2, 'вторник|вторника|tuesday'],
  [3, 'среда|среду|среды|wednesday'], [4, 'четверг|четверга|thursday'], [5, 'пятница|пятницу|пятницы|friday'], [6, 'суббота|субботу|субботы|saturday']
];
// A number followed by one of these is a measurement, not a day: "3.5 км", "22.5 кг", "1.5 часа".
const UNIT_AFTER = new RegExp(`^\\s*(?:${[KMW, KGW, LBW, MINW, SECW, HOURS, TIMES, REPS, SETS].map(wb).join('|')}|с(?![${L}])|s(?![${L}])|[xх×*%°])`, 'iu');
const LAST_WEEK = new RegExp(wb(`на\\s+прошлой\\s+неделе|прошлой\\s+недели|last\\s+week`), 'iu');

/** The year for a day and month given without one: this year, or last year if that is still to come. */
function withYear(m, d, today, y = null) {
  const ty = +today.slice(0, 4);
  if (y != null) return real(y < 100 ? 2000 + y : y, m, d);
  const iso = real(ty, m, d);
  return iso && iso > today ? real(ty - 1, m, d) : iso;
}
/** Monday of the week `iso` is in. */
const mondayOf = iso => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7));

/**
 * One piece of text read for a date: the date, the text before it, and the piece with the date
 * taken out — or null. An explicit date (with a month or a year, or "13.10") beats "вчера",
 * which beats a weekday: "Среда 14.10" is the 14th, whatever Wednesday was most recent.
 *
 * @param {{ bareNumbers?:boolean }} opts  whether "13.10" without a year counts anywhere. Off
 *   the first line a lone "22.5" is far likelier a weight than the 22nd of May, so there a
 *   bare day.month is only taken with a dot and when it is within the last few weeks.
 */
export function readDate(piece, today, { bareNumbers = true } = {}) {
  const s = String(piece || '');
  const hits = [];
  const add = (rank, re, fn) => { const m = re.exec(s); if (m) { const iso = fn(m); if (iso) hits.push({ rank, iso, at: m.index, len: m[0].length }); } };
  add(0, /(\d{4})-(\d{2})-(\d{2})/, m => real(+m[1], +m[2], +m[3]));
  add(0, /(?<![\d.,xх×*/])(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?(?![\d.,/])/u, m => {
    if (UNIT_AFTER.test(s.slice(m.index + m[0].length))) return null;
    const iso = withYear(+m[2], +m[1], today, m[3] ? +m[3] : null);
    if (!m[3] && !bareNumbers && (!/\./.test(m[0]) || !iso || (toDate(today) - toDate(iso)) / 86400000 > RECENT_DAYS)) return null;
    return iso;
  });
  add(0, new RegExp(`(?<![\\d.])(\\d{1,2})\\s+([${L}]{3,}\\.?)(?:\\s+(\\d{4}))?`, 'u'),
    m => (monthOf(m[2]) ? withYear(monthOf(m[2]), +m[1], today, m[3] ? +m[3] : null) : null));
  add(0, new RegExp(`(?<![${L}])([${L}]{3,}\\.?)\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?![\\d.,xх×])`, 'u'),
    m => (monthOf(m[1]) ? withYear(monthOf(m[1]), +m[2], today, m[3] ? +m[3] : null) : null));
  add(1, word('позавчера|day before yesterday'), () => addDays(today, -2));
  add(1, word('вчера|yesterday'), () => addDays(today, -1));
  add(1, word('сегодня|today'), () => today);
  add(1, new RegExp(`(\\d{1,3})\\s*(?:дня|дней|день|days?)\\s*(?:назад|ago)`, 'iu'), m => addDays(today, -(+m[1])));
  for (const [wd, src] of WEEKDAYS) {
    add(2, word(`(?:(?:в|во|on|last)\\s+)?(?:прошл${L}*\\s+)?(?:${src})`), () => {
      // The most recent such day before today: someone logging today's session says "today".
      let iso = addDays(today, -(((toDate(today).getUTCDay() - wd + 7) % 7) || 7));
      if (LAST_WEEK.test(s) && iso >= mondayOf(today)) iso = addDays(iso, -7);
      return iso;
    });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.rank - b.rank || a.at - b.at);
  const h = hits[0];
  if (h.iso > today || (toDate(today) - toDate(h.iso)) / 86400000 > MAX_DAYS_BACK) return null;
  // Everything that said "which day", taken out together, so a header like "Среда 14.10" leaves nothing.
  let rest = s;
  for (const x of [...hits].sort((a, b) => b.at - a.at)) rest = rest.slice(0, x.at) + ' ' + rest.slice(x.at + x.len);
  rest = rest.replace(LAST_WEEK, ' ');
  return { iso: h.iso, rank: h.rank, before: s.slice(0, Math.min(...hits.map(x => x.at))), rest: rest.replace(/\s+/g, ' ').trim() };
}

// What may surround a date without making its line an exercise: "Тренировка от 13.10:".
const DATE_FILLER = new RegExp(wb('тренировка|тренировки|тренировку|занятие|workout|session|training|дата|date|от|за|была|был|было|в|во|on|день|day'), 'giu');
const onlyDate = rest => !String(rest).replace(DATE_FILLER, ' ').replace(/[^\p{L}\p{N}]+/gu, '').length;

/**
 * The day of the workout, if the text says it: at the start of the first line (the whole line,
 * or "вчера жим 3х8"), or on any line that is nothing but a date with a month or a year in it.
 * Returns { iso, piece, whole, rest } — `piece` the index of the piece it came from, `rest` that
 * piece without the date — or null.
 */
export function dateFromText(text, today) {
  if (!toDate(today)) return null;
  const pieces = splitPieces(text);
  // Every piece that could be the day, then the most explicit of them: "среда, 14 октября" is
  // two pieces, and the 14th is what it means.
  const found = [];
  for (let i = 0; i < pieces.length; i++) {
    const r = readDate(pieces[i], today, { bareNumbers: i === 0 });
    if (!r) continue;
    if (onlyDate(r.rest)) found.push({ iso: r.iso, piece: i, whole: true, rest: '', rank: r.rank });
    else if (i === 0 && onlyDate(r.before)) found.push({ iso: r.iso, piece: 0, whole: false, rest: r.rest, rank: r.rank });
  }
  if (!found.length) return null;
  // Every piece that is only a date is a date line, not an exercise, whichever one was chosen.
  const dateOnly = found.filter(f => f.whole).map(f => f.piece);
  found.sort((a, b) => a.rank - b.rank || a.piece - b.piece);
  const { rank, ...best } = found[0];
  const partial = found.find(f => !f.whole);
  return { ...best, dateOnly, ...(partial ? { firstRest: partial.rest } : {}) };
}

/* ---------- the sets of one line ---------- */

/**
 * Digits as digits: every way of writing "by" between two numbers as x, and a decimal comma as
 * a point — but only where it is one: "22,5" and "по 82,5" are decimals; "80x8,85x6", "3х10,12"
 * and "8,80" right after an NxM are lists.
 */
function normalize(s) {
  const joined = String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/(\d)\s*[xх×*]\s*(?=\d)/g, '$1x');
  return joined.replace(/(\d+),(\d{1,2})(?!\d)/g, (m, a, b, at, str) => {
    const before = str.slice(0, at), after = str.slice(at + m.length);
    if (/x\d*$/.test(before) || /,\s*$/.test(before)) return m;           // the reps of an NxM, or a list
    if (/^\s*,\s*\d/.test(after)) return m;                               // a list: "10,12,15"
    return a + '.' + b;
  }).replace(/\s+/g, ' ').trim();
}

/** The load in a piece of a line: "80 кг", "по 80", "@ 80", "+10" (added load), or a lone "80". */
function weightIn(s) {
  let m = new RegExp(`${N}\\s*(?:${KG}|${LB})`, 'iu').exec(s);
  if (m) return +m[1];
  m = new RegExp(`${PREP}\\s*${N}(?!\\s*(?:${wb(TIMES)}|${wb(REPS)}|${SEC}|${MIN}|${wb(SETS)}))`, 'iu').exec(s);
  if (m) return +m[1];
  const nums = s.match(/\d+(?:\.\d+)?/g) || [];
  m = /\+\s*(\d+(?:\.\d+)?)/.exec(s);
  if (m && nums.length === 1) return +m[1];
  if (nums.length === 1 && !/\+/.test(s) && !new RegExp(`\\d\\s*(?:${wb(TIMES)}|${wb(REPS)}|${wb(SETS)}|${SEC}|${MIN})`, 'iu').test(s)) return +nums[0];
  return null;
}

// The first number of "3x8" is a count of sets when it is a small whole number.
const isSets = a => Number.isInteger(a) && a >= 1 && a <= 10;
const rowsOf = (n, row) => Array.from({ length: Math.max(0, Math.min(30, Math.round(n))) }, () => ({ ...row }));
const withWeight = (row, w) => (w ? { ...row, weight: w } : row);
const WARM_RE = new RegExp(WARM, 'iu');

/**
 * The sets one line of a workout describes, as rows in the shape readSet takes
 * ({ reps, weight } / { sec, weight } / { min, km, speed }), or [] when the line gives none.
 *
 *   "3x8 80", "3х8 по 80 кг", "3 подхода по 8 повторений 80 кг", "3 подхода 8 повторений 80 кг",
 *   "3 sets of 8 at 80", "80кг 10 раз 3 подхода"
 *   "80x8, 85x6, 90x4" and "80x8,85x6"  — one row each, weight × reps
 *   "3x10 60, 2x8 70"                  — sets × reps at a weight, group by group
 *   "80x8x3", "3x8x80", "8x15x3"        — the small whole end is the sets
 *   "3 по 10", "3x10"                   — sets × reps, no load;  "+10 кг" is added load
 *   "3 по 60 с", "3x60 сек", "60 секунд" — a timed hold;  "3x2 мин" — minutes
 *   "30 мин", "20 минут 3 км", "10 мин 6 км/ч" — cardio
 * A rest ("отдых 2 мин"), an angle ("30°"), a percentage and a note in brackets ("(+2.5)") are
 * not part of a set and are taken out first. Rows after a warm-up word are warm-ups.
 */
export function setsFromText(line) {
  let s = normalize(line);
  if (!s) return [];
  s = s
    .replace(new RegExp(`${wb(REST)}\\s*(?:между\\s+подходами\\s*)?(?:по\\s*)?\\d+(?:\\.\\d+)?\\s*(?:${SEC}|${MIN})?`, 'giu'), ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:°|%|градус\p{L}*)/gu, ' ')
    .replace(/\(\s*[+±-]\s*\d+(?:\.\d+)?\s*(?:кг|kg|lbs?)?\s*\)/giu, ' ')
    .replace(/\s+/g, ' ').trim();
  const speedM = new RegExp(`${N}\\s*(?:${SPEEDW})`, 'iu').exec(s);
  const speed = speedM ? +speedM[1] : null;
  if (speedM) s = s.replace(speedM[0], ' ');
  const allWarm = WARM_RE.test(s.split(/\d/)[0] || '');
  const done = rows => rows.map(r => (allWarm ? { ...r, warmup: true } : r));

  // "3x2 мин", "4 по 5 минут", "3 подхода по 2 минуты" — minutes, counted.
  const minTimes = new RegExp(`(\\d+)\\s*(?:x|по|(?:${wb(SETS)})\\s*по)\\s*${N}\\s*${MIN}`, 'iu').exec(s);
  if (minTimes && isSets(+minTimes[1])) return done(rowsOf(+minTimes[1], { min: +minTimes[2] }));
  // "3 по 60 с", "3x60 сек", "3 подхода по 45 секунд" — a timed hold.
  const holds = new RegExp(`(\\d+)\\s*(?:x|по|(?:${wb(SETS)})\\s*по)\\s*(\\d+)\\s*${SEC}`, 'iu').exec(s);
  if (holds && isSets(+holds[1])) return done(rowsOf(+holds[1], withWeight({ sec: +holds[2] }, weightIn(s.replace(holds[0], ' ')))));

  // NxM groups, read group by group with the text around each.
  const pairs = [...s.matchAll(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?/g)];
  if (pairs.length) {
    const kgAfter = new RegExp(`^\\s*(?:${KG}|${LB})`, 'iu');
    // "2x20кг" is two implements of 20 kg — the load, not a set.
    let lineWeight = null;
    const groups = [];
    pairs.forEach((m, i) => {
      const start = i ? pairs[i - 1].index + pairs[i - 1][0].length : 0;
      const lead = s.slice(start, m.index);
      const trail = s.slice(m.index + m[0].length, i + 1 < pairs.length ? pairs[i + 1].index : s.length);
      if (!m[3] && kgAfter.test(trail) && isSets(+m[1])) { lineWeight = +m[2]; return; }
      groups.push({ a: +m[1], b: +m[2], c: m[3] != null ? +m[3] : null, lead, trail });
    });
    const allSmall = groups.every(g => isSets(g.a));
    const rows = groups.flatMap((g, i) => {
      const warm = WARM_RE.test(g.lead) ? { warmup: true } : {};
      const mark = r => r.map(x => ({ ...x, ...warm }));
      if (new RegExp(`^\\s*${SEC}`, 'iu').test(g.trail)) return mark(isSets(g.a) ? rowsOf(g.a, { sec: g.b }) : [{ sec: g.b }]);
      if (new RegExp(`^\\s*${MIN}`, 'iu').test(g.trail)) return mark(isSets(g.a) ? rowsOf(g.a, { min: g.b }) : [{ min: g.b }]);
      if (g.c != null) {
        if (isSets(g.a) && isSets(g.c)) return mark(rowsOf(Math.min(g.a, g.c), { reps: g.b, weight: Math.max(g.a, g.c) }));
        return mark(isSets(g.a) ? rowsOf(g.a, { reps: g.b, weight: g.c }) : rowsOf(g.c, { reps: g.b, weight: g.a }));
      }
      const w = weightIn(g.trail) ?? (groups.length === 1 ? weightIn(g.lead) : null) ?? lineWeight;
      if (isSets(g.a) && (w != null || allSmall || groups.length === 1)) return mark(rowsOf(g.a, withWeight({ reps: g.b }, w)));
      return mark([{ reps: g.b, weight: g.a }]);
    });
    return allWarm ? done(rows) : rows;
  }

  // Words: "3 подхода по 8 (повторений)", "3 по 10", "3 sets of 8", "3 подхода 8 повторений",
  // "10 повторений 3 подхода", "80кг 10 раз 3 подхода".
  const byPo = new RegExp(`(\\d+)\\s*(?:${wb(SETS)})?\\s*(?:${wb('по|of')})\\s*(\\d+)\\s*(?:${wb(REPS)}|${wb(TIMES)})?`, 'iu').exec(s);
  if (byPo && isSets(+byPo[1]) && !new RegExp(`^\\s*(?:${SEC}|${MIN})`, 'iu').test(s.slice(byPo.index + byPo[0].length))) {
    return done(rowsOf(+byPo[1], withWeight({ reps: +byPo[2] }, weightIn(s.replace(byPo[0], ' ')))));
  }
  const setsM = new RegExp(`(\\d+)\\s*(?:${wb(SETS)})`, 'iu').exec(s);
  const repsM = new RegExp(`(\\d+)\\s*(?:${wb(REPS)}|${wb(TIMES)})`, 'iu').exec(s);
  if (repsM) {
    const n = setsM && +setsM[1] >= 1 && +setsM[1] <= 30 ? +setsM[1] : 1;
    let rest = s.replace(repsM[0], ' ');
    if (setsM) rest = rest.replace(setsM[0], ' ');
    return done(rowsOf(n, withWeight({ reps: +repsM[1] }, weightIn(rest))));
  }
  // "60 секунд" — one hold; "3 подхода, 60 секунд" — that many.
  const sec = new RegExp(`(\\d+)\\s*${SEC}`, 'iu').exec(s);
  if (sec) return done(rowsOf(setsM ? +setsM[1] : 1, { sec: +sec[1] }));
  // Cardio: minutes, with a distance and a speed if there are.
  const minM = new RegExp(`${N}\\s*${MIN}`, 'iu').exec(s);
  if (minM) {
    const km = new RegExp(`${N}\\s*(?:${wb(KMW)})`, 'iu').exec(s);
    return done([{ min: +minM[1], ...(km ? { km: +km[1] } : {}), ...(speed ? { speed } : {}) }]);
  }
  return [];
}

/* ---------- the check every row passes ---------- */

// A model writes "80", "80 kg", "8-10", 8.0 — take the first number in it, or nothing.
export const num = v => {
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
  // The names the schema asks for first, then the ones a model reaches for instead.
  const pick = (...keys) => { for (const k of keys) if (raw[k] != null && raw[k] !== '') return raw[k]; return null; };
  const reps = inRange(num(pick('reps', 'repetitions', 'rep', 'r')), 1, 500);
  const weight = inRange(num(pick('weight', 'kg', 'weight_kg', 'load', 'w')), 0, 1000);
  const sec = inRange(num(pick('sec', 'seconds', 'secs', 'time_sec')), 1, 7200);
  const min = inRange(num(pick('min', 'minutes', 'mins', 'duration')), 0.5, 600);
  const km = inRange(num(pick('km', 'distance', 'distance_km')), 0.01, 300);
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

/* ---------- which line is which exercise ---------- */

const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const hasName = p => /\p{L}/u.test(String(p).replace(FILLER, ' '));
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The day, and the pieces of the text that can be exercises: the date lines taken out, and the
 *  date taken off the front of a first line that goes on to an exercise. */
export function exercisePieces(text, today) {
  const date = dateFromText(text, today);
  const pieces = splitPieces(text)
    .map((p, i) => (!date ? p : date.dateOnly.includes(i) ? null : i === 0 && date.firstRest != null ? date.firstRest : p))
    .filter(p => p && hasName(p));
  return { date, pieces };
}

/**
 * For each exercise the model read (in the text's order), the text of the piece it came from
 * with its name taken out — or null. Matched by the words the model said it came from (`said`),
 * as whole words from the start ("жим" is not inside "отжимания"), the earliest piece at or
 * after the last one used; when none of them can be found and the text has exactly one
 * exercise piece per item, by position.
 */
export function piecesForItems(text, items, today) {
  const exercises = exercisePieces(text, today).pieces;
  const out = new Array(items.length).fill(null);
  let cursor = 0;
  items.forEach((it, k) => {
    const said = norm(it && it.said);
    if (!said) return;
    const re = new RegExp(`(?<![${L}])${escape(said)}`, 'iu');
    const at = exercises.findIndex((p, j) => j >= cursor && re.test(norm(p)));
    if (at < 0) return;
    const p = norm(exercises[at]);
    const m = re.exec(p);
    out[k] = (p.slice(0, m.index) + ' ' + p.slice(m.index + m[0].length)).trim();
    cursor = at + 1;
  });
  if (out.every(x => x == null) && exercises.length === items.length) return exercises;
  return out;
}
