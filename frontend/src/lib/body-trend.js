/* Where a tape measurement is heading — said only as firmly as the readings allow.
 *
 * A tape is a blunt instrument for a slow process. The same person measuring the same arm twice
 * lands about 2.6 mm apart on average (intra-observer technical error; Ulijaszek & Kerr,
 * Br J Nutr 1999), so two readings have to differ by roughly 0.7 cm before the difference means
 * anything, while a trained lifter's arm grows a millimetre or two a month. One reading against
 * the last one is therefore noise; a line through many of them is not.
 *
 * So this fits a straight line (ordinary least squares) through the readings of the last half
 * year and reports the slope with its 95 % interval, and — when the slope can be told apart from
 * zero — where a reading taken some weeks from now would most likely fall, as a RANGE (a
 * prediction interval), never one number. It refuses outright when there are too few readings,
 * when they span too short a time, when they are bunched at one end, or when the last one is old:
 * an answer nobody can lean on is worse than "not yet".
 *
 * What it is not: a model of muscle growth. Nothing here turns sets or protein into centimetres
 * — the published dose-response effects are smaller than the tape's own error. The training
 * plan, the weight trend and the protein intake are reported beside the trend (growthContext)
 * as the things worth looking at, not multiplied into it.
 */
import { isGirth, siteOf, SITE_MUSCLES } from './body.js'
export { TAPE_DETECTABLE_CM } from './body.js'
import { weeklySetsDone, plannedWeeklySets } from './muscles.js'
import { weightSlope } from './nutrition-adaptive.js'
import { nutritionOf, loggedDays, dayBefore } from './nutrition.js'
import { personOf } from './nutrition-targets.js'

export const WINDOW_DAYS = 180
export const MIN_POINTS = 5
export const MIN_SPAN_DAYS = 56
export const MAX_AGE_DAYS = 45
export const MAX_HORIZON_DAYS = 84
// The scatter of single readings is never taken to be smaller than this, however neatly five
// points happen to line up: 0.3 cm is about the tape's own repeatability.
export const SIGMA_FLOOR_CM = 0.3
const MONTH = 30.44
const DAY = 86400000
const LB = 0.45359237
const noon = iso => new Date(iso + 'T12:00:00').getTime()
const r2 = n => Math.round(n * 100) / 100
const r1 = n => Math.round(n * 10) / 10

// Two-sided 95 % Student's t (the 0.975 quantile) by degrees of freedom. Beyond the table the
// next smaller tabulated value is used, which errs on the wide side.
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131,
  2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042]
export function tQuantile95(df) {
  if (!(df >= 1)) return NaN
  if (df <= 30) return T975[Math.floor(df) - 1]
  return df <= 40 ? 2.042 : df <= 60 ? 2.021 : df <= 120 ? 2.0 : 1.98
}

/** Least squares through [{ x, y }]: { n, a, b, xbar, sxx, sse }; null with under two distinct x. */
export function olsFit(points) {
  const n = points.length
  if (n < 2) return null
  const xbar = points.reduce((s, p) => s + p.x, 0) / n
  const ybar = points.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0, sxy = 0
  for (const p of points) { sxx += (p.x - xbar) ** 2; sxy += (p.x - xbar) * (p.y - ybar) }
  if (!sxx) return null
  const b = sxy / sxx, a = ybar - b * xbar
  const sse = points.reduce((s, p) => s + (p.y - (a + b * p.x)) ** 2, 0)
  return { n, a, b, xbar, sxx, sse }
}

/**
 * The trend of one tape measurement, in the stored unit (centimetres).
 *
 * Refused:  { ok: false, reason, n, spanDays, need }
 *   reason  'kind'        not a tape measurement (body fat, lean mass)
 *           'few-points'  fewer than MIN_POINTS readings in the window (need = MIN_POINTS)
 *           'short-span'  they cover less than MIN_SPAN_DAYS (need = MIN_SPAN_DAYS)
 *           'uneven'      fewer than two readings in one half of the period
 *           'stale'       the last reading is older than MAX_AGE_DAYS (need = MAX_AGE_DAYS)
 * Answered: { ok: true, n, spanDays, perMonth, ci: [lo, hi], detectable, sigma, projection }
 *   perMonth, ci   the slope and its 95 % interval, cm per month
 *   detectable     the interval excludes zero
 *   projection     null unless detectable; otherwise { days, d, mid, lo, hi, path } — the range a
 *                  single reading on day `d` is expected to fall in, and the same along the way
 *                  (`path`, from the last reading on) for a chart
 */
export function measureTrend(S, key, { today }) {
  const refuse = (reason, extra = {}) => ({ ok: false, reason, n: 0, spanDays: 0, need: null, ...extra })
  if (!isGirth(key)) return refuse('kind')
  const from = dayBefore(today, WINDOW_DAYS)
  const rows = (Array.isArray(S?.measurements) ? S.measurements : [])
    .filter(r => r && r[key] > 0 && r.d >= from && r.d <= today)
    .sort((a, b) => (a.d < b.d ? -1 : 1))
  const n = rows.length
  if (n < MIN_POINTS) return refuse('few-points', { n, need: MIN_POINTS })
  const t0 = noon(rows[0].d)
  const pts = rows.map(r => ({ x: Math.round((noon(r.d) - t0) / DAY), y: r[key] }))
  const spanDays = pts.at(-1).x
  if (spanDays < MIN_SPAN_DAYS) return refuse('short-span', { n, spanDays, need: MIN_SPAN_DAYS })
  const mid = spanDays / 2
  if (pts.filter(p => p.x < mid).length < 2 || pts.filter(p => p.x >= mid).length < 2) return refuse('uneven', { n, spanDays })
  const age = Math.round((noon(today) - noon(rows.at(-1).d)) / DAY)
  if (age > MAX_AGE_DAYS) return refuse('stale', { n, spanDays, need: MAX_AGE_DAYS })

  const fit = olsFit(pts)
  const sigma = Math.max(Math.sqrt(fit.sse / (n - 2)), SIGMA_FLOOR_CM)
  const tq = tQuantile95(n - 2)
  const se = sigma / Math.sqrt(fit.sxx)
  const detectable = Math.abs(fit.b) > tq * se
  const out = {
    ok: true, n, spanDays, sigma: r2(sigma), detectable,
    perMonth: r2(fit.b * MONTH), ci: [r2((fit.b - tq * se) * MONTH), r2((fit.b + tq * se) * MONTH)],
    projection: null
  }
  if (!detectable) return out
  // Never further ahead than the readings reach back, and never past twelve weeks.
  const days = Math.min(spanDays, MAX_HORIZON_DAYS)
  const xNow = spanDays + age
  const at = x => {
    const y = fit.a + fit.b * x
    const half = tq * sigma * Math.sqrt(1 + 1 / n + (x - fit.xbar) ** 2 / fit.sxx)
    return { d: dayBefore(rows[0].d, -x), mid: r1(y), lo: r1(y - half), hi: r1(y + half) }
  }
  const steps = 6
  const path = Array.from({ length: steps + 1 }, (_, i) => at(Math.round(spanDays + (xNow + days - spanDays) * i / steps)))
  out.projection = { days, ...at(xNow + days), path }
  return out
}

/**
 * How long until the trend line reaches `goal` (stored unit): { days, d }, or null when there is
 * no usable trend, the goal lies the other way, or it is further off than the projection reaches
 * — a date beyond the horizon would be a guess presented as arithmetic.
 */
export function goalEta(trend, goal) {
  if (!trend?.ok || !trend.projection || !(goal > 0)) return null
  const perDay = trend.perMonth / MONTH
  // Where the line is today: the projected value walked back over the horizon.
  const gap = goal - (trend.projection.mid - perDay * trend.projection.days)
  if (!perDay || Math.sign(gap) !== Math.sign(perDay)) return null
  const days = Math.round(gap / perDay)
  return days >= 1 && days <= trend.projection.days ? { days } : null
}

/* What published studies measured, for scale — never fed into the numbers above.
 * Gentil et al., PeerJ 2020 (pooled data of three of their trials, young men, flexed arm
 * circumference before and after 10–12 weeks of resistance training): untrained 31.3 → 32.8 cm
 * and 33.0 → 34.3 cm; trained 36.1 → 36.5 cm. Group means: individual results in such trials
 * range from no change to several times the average. */
export const ARM_REFERENCE = { weeks: [10, 12], new: [1.3, 1.5], trained: [0.4, 0.4] }
// Pelland et al., Sports Med 2025 (meta-regression, 67 studies): about four weekly sets per
// muscle, indirect sets counted in part, is the least that produced detectable growth.
export const MIN_EFFECTIVE_SETS = 4

/**
 * What stands beside the trend: the things known to bear on muscle size, each as a plain
 * figure and each null when the profile cannot say.
 *   muscles   [{ slug, done, planned }] — effective sets a week, last four weeks vs the plan
 *   weight    kg per week over the last four weeks (null with under four weigh-ins or two weeks)
 *   protein   g per kg of body weight a day over the last 14 logged days (null under five days)
 *   level     'new' | 'trained' | null — from the Coach intake, else from the first logged workout
 *   reference ARM_REFERENCE's range for that level, for the flexed arm only
 */
export function growthContext(S, key, { today }) {
  const site = siteOf(key)
  const slugs = SITE_MUSCLES[site] || []
  const done = slugs.length ? weeklySetsDone(S?.workouts, { today, weeks: 4 }) : {}
  const planned = slugs.length ? plannedWeeklySets(S) : {}
  const muscles = slugs.map(slug => ({ slug, done: done[slug] || 0, planned: planned[slug] || 0 }))

  const from = dayBefore(today, 28)
  const kg = w => (S?.unit === 'lb' ? w * LB : w)
  const weighs = (Array.isArray(S?.bodyweight) ? S.bodyweight : []).filter(b => b && b.w > 0 && b.d > from && b.d <= today)
    .map(b => ({ x: (noon(b.d) - noon(from)) / DAY, y: kg(b.w) }))
  const slope = weighs.length >= 4 && weighs.at(-1).x - weighs[0].x >= 14 ? weightSlope(weighs) : null
  const weight = slope == null ? null : r2(slope * 7)

  const person = personOf(S || {}, today)
  const since = dayBefore(today, 14)
  const days = loggedDays(nutritionOf(S)).filter(x => x.d >= since && x.d < today && x.p > 0)
  const protein = days.length >= 5 && person.kg > 0 ? r1(days.reduce((a, x) => a + x.p, 0) / days.length / person.kg) : null

  const exp = S?.coach?.profile?.experience
  const first = (Array.isArray(S?.workouts) ? S.workouts : []).map(w => w?.d).filter(Boolean).sort()[0]
  const level = exp === 'new' ? 'new' : exp === 'returning' || exp === 'regular' ? 'trained'
    : !first ? null : (noon(today) - noon(first)) / DAY < 180 ? 'new' : 'trained'
  const reference = site === 'upperArmFlexed' && level ? { weeks: ARM_REFERENCE.weeks, cm: ARM_REFERENCE[level] } : null

  return { site, muscles, weight, protein, level, reference }
}
