/* The two optional things a profile may let the Coach see: who the body is, and how it eats.
 *
 * Optional in the strict sense: neither is covered by the Coach's consent. Each has a switch of
 * its own (S.coach.consent.extra), off until the person turns it on, and the payload builder
 * asks this module — so a profile that agreed to the Coach last year, before either existed,
 * sends exactly what it sent then.
 *
 * What is sent is deliberately a summary:
 *
 *   bodyProfile   sex, age (not the birth year), height, daily activity, the latest body fat,
 *                 and for each measurement its latest value and how it moved over ~8 weeks.
 *   nutrition     the daily target and the averages actually eaten over the last two weeks,
 *                 the estimated expenditure, and the weight trend. Never a food name, never a
 *                 barcode, never a photograph — the Coach is told how much, not what.
 *
 * `S.body` is not read here or anywhere in the payload: that field picks the figure the muscle
 * map is drawn on, and says nothing about anyone.
 */
import { OPTIONAL_CATEGORIES } from './categories.js';

const DAY = 86400000;
const r1 = n => Math.round(n * 10) / 10;
const list = v => (Array.isArray(v) ? v : []);
const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const daysBefore = (iso, n) => isoOf(new Date(new Date(iso + 'T12:00:00').getTime() - n * DAY));
const MEASURES = ['waist', 'chest', 'hips', 'shoulders', 'neck', 'upperArmLeft', 'upperArmRight', 'thighLeft', 'thighRight', 'calfLeft', 'calfRight'];
const ACTIVITY = ['sedentary', 'light', 'moderate', 'active', 'very'];
const TREND_DAYS = 56;       // how far back "how it moved" looks
const INTAKE_DAYS = 14;
const WHOLE_DAY_KCAL = 800;  // a day with less than this in the diary was not logged, it was started

/** The optional categories this profile switched on. Nothing without the Coach's own consent. */
export function grantedExtras(S) {
  const c = S && S.coach && S.coach.consent;
  if (!c || !c.agreedAt || !c.extra || typeof c.extra !== 'object') return [];
  return OPTIONAL_CATEGORIES.filter(k => !!c.extra[k]);
}

/** @returns the `bodyProfile` section, or null when there is nothing in it worth sending. */
export function bodySection(S, today) {
  const bp = (S && S.bodyProfile) || {};
  const out = {};
  if (bp.sex === 'm' || bp.sex === 'f') out.sex = bp.sex === 'm' ? 'male' : 'female';
  if (bp.born > 1900) out.age = Math.max(0, +String(today).slice(0, 4) - bp.born);
  if (bp.heightCm > 0) out.heightCm = Math.round(bp.heightCm);
  if (ACTIVITY.includes(bp.activity)) out.dailyActivity = bp.activity;

  const rows = list(S && S.measurements).filter(r => r && r.d && r.d <= today);
  const from = daysBefore(today, TREND_DAYS);
  const fat = rows.filter(r => r.bodyFat > 0).at(-1);
  if (fat) out.bodyFatPercent = r1(fat.bodyFat);
  const measures = {};
  for (const key of MEASURES) {
    const pts = rows.filter(r => r[key] > 0);
    if (!pts.length) continue;
    const now = pts.at(-1);
    // The earliest reading inside the look-back window, if it is a different one.
    const then = pts.find(r => r.d >= from);
    measures[key] = { cm: r1(now[key]), ...(then && then !== now ? { changeCm: r1(now[key] - then[key]), sinceDays: Math.round((new Date(now.d) - new Date(then.d)) / DAY) } : {}) };
  }
  if (Object.keys(measures).length) out.measurements = measures;
  return Object.keys(out).length ? out : null;
}

/** @returns the `nutrition` section, or null when the diary has nothing to summarise. */
export function nutritionSection(S, today) {
  const nut = S && S.nutrition;
  if (!nut || typeof nut !== 'object') return null;
  const out = {};
  const t = nut.targets;
  if (t && t.kcal > 0) {
    out.target = { kcal: Math.round(t.kcal), proteinG: Math.round(t.p || 0), fatG: Math.round(t.f || 0), carbsG: Math.round(t.c || 0), goal: ['lose', 'maintain', 'gain'].includes(t.goal) && t.mode !== 'manual' ? t.goal : null };
    if (t.tdee > 0) out.expenditure = { kcal: Math.round(t.tdee), basis: t.basis === 'adaptive' ? 'measured from intake and weight trend' : 'estimated from body and activity' };
  }
  // What was actually eaten: the last two weeks, yesterday back — today is not over.
  const to = daysBefore(today, 1), from = daysBefore(today, INTAKE_DAYS);
  const days = new Map();
  for (const [d, v] of Object.entries(nut.days && typeof nut.days === 'object' ? nut.days : {})) {
    if (d >= from && d <= to && v) days.set(d, { k: +v.k || 0, p: +v.p || 0, f: +v.f || 0, c: +v.c || 0 });
  }
  for (const e of list(nut.log)) {
    if (!e || !(e.d >= from && e.d <= to)) continue;
    const cur = days.get(e.d) || { k: 0, p: 0, f: 0, c: 0 };
    days.set(e.d, { k: cur.k + (+e.k || 0), p: cur.p + (+e.p || 0), f: cur.f + (+e.f || 0), c: cur.c + (+e.c || 0) });
  }
  const whole = [...days.values()].filter(v => v.k >= WHOLE_DAY_KCAL);
  if (whole.length >= 3) {
    const avg = key => whole.reduce((a, v) => a + v[key], 0) / whole.length;
    out.intake = { days: INTAKE_DAYS, loggedDays: whole.length, kcal: Math.round(avg('k')), proteinG: Math.round(avg('p')), fatG: Math.round(avg('f')), carbsG: Math.round(avg('c')) };
  }
  return Object.keys(out).length ? out : null;
}

/** The sections this profile granted, ready to be spread into the payload. */
export function extraSections(S, today) {
  const granted = grantedExtras(S);
  const out = {};
  if (granted.includes('bodyProfile')) { const b = bodySection(S, today); if (b) out.bodyProfile = b; }
  if (granted.includes('nutrition')) { const n = nutritionSection(S, today); if (n) out.nutrition = n; }
  return out;
}
