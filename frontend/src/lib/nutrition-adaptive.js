/* Expenditure measured instead of guessed: what was eaten, against what the scale did.
 *
 *   expenditure = mean daily intake − (weight change per day × 7700 kcal/kg)
 *
 * Eat 2400 a day and hold your weight and you burn 2400; lose 0.4 kg a week on it and you burn
 * about 2840. No watch is involved — wrist devices miss energy expenditure by 30 % and more —
 * and no activity factor has to be picked honestly.
 *
 * It is only as good as the diary and the weigh-ins, so it refuses to answer rather than answer
 * badly: it needs enough fully-logged days and enough weigh-ins on both ends of the window, and
 * even then the result is blended with the formula and kept within a plausible range of it.
 */
import { nutritionOf, loggedDays, dayBefore } from './nutrition.js'

export const WINDOW_DAYS = 28
export const MIN_SPAN_DAYS = 14
export const MIN_LOGGED_DAYS = 10
export const MIN_WEIGH_INS = 8
const KCAL_PER_KG = 7700
const LB = 0.45359237
const DAY = 86400000
const noon = iso => new Date(iso + 'T12:00:00').getTime()

/** Least-squares slope of weight over time, in kg per day. null with fewer than two points. */
export function weightSlope(points) {
  if (points.length < 2) return null
  const mx = points.reduce((a, p) => a + p.x, 0) / points.length
  const my = points.reduce((a, p) => a + p.y, 0) / points.length
  let num = 0, den = 0
  for (const p of points) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2 }
  return den ? num / den : null
}

/**
 * { tdee, raw, conf, reason, loggedDays, weighIns, kgPerWeek }
 *   tdee    the figure to use — blended with `formulaTdee` when there is one; null when refused
 *   raw     the unblended measurement (shown as "your diary says …")
 *   conf    'none' | 'low' | 'ok'
 *   reason  why it refused: 'few-days' | 'few-weighins' | 'uneven' — null when it answered
 * The window ends yesterday: today is never a complete day.
 */
export function adaptiveTdee(S, { today, bmrKcal = null, formulaTdee = null } = {}) {
  const none = (reason, extra = {}) => ({ tdee: null, raw: null, conf: 'none', reason, loggedDays: 0, weighIns: 0, kgPerWeek: null, ...extra })
  const to = dayBefore(today, 1), from = dayBefore(today, WINDOW_DAYS)
  // A day counts when it looks whole. Half a day in the diary would read as eating half as much.
  const whole = Math.max(800, 0.6 * (bmrKcal || 0))
  const days = loggedDays(nutritionOf(S)).filter(x => x.d >= from && x.d <= to && x.k >= whole)
  const kg = w => (S.unit === 'lb' ? w * LB : w)
  const weighs = (S.bodyweight || []).filter(b => b && b.d >= from && b.d <= to && b.w > 0)
    .map(b => ({ x: (noon(b.d) - noon(from)) / DAY, y: kg(b.w) }))
  const counts = { loggedDays: days.length, weighIns: weighs.length }
  if (days.length < MIN_LOGGED_DAYS) return none('few-days', counts)
  if ((noon(days.at(-1).d) - noon(days[0].d)) / DAY < MIN_SPAN_DAYS - 1) return none('few-days', counts)
  if (weighs.length < MIN_WEIGH_INS) return none('few-weighins', counts)
  // Weigh-ins bunched at one end say nothing about the trend across the window.
  const mid = (weighs[0].x + weighs.at(-1).x) / 2
  if (weighs.at(-1).x - weighs[0].x < MIN_SPAN_DAYS - 1 || weighs.filter(p => p.x < mid).length < 3 || weighs.filter(p => p.x >= mid).length < 3) return none('uneven', counts)

  const slope = weightSlope(weighs)
  const intake = days.reduce((a, x) => a + x.k, 0) / days.length
  let raw = Math.round(intake - slope * KCAL_PER_KG)
  const conf = days.length >= 20 && weighs.length >= 12 ? 'ok' : 'low'
  // Within sight of the formula: a missed week of logging must not turn into a 900 kcal "finding".
  if (formulaTdee) raw = Math.round(Math.min(formulaTdee * 1.5, Math.max(formulaTdee * 0.7, raw)))
  else raw = Math.min(5500, Math.max(1100, raw))
  const weight = conf === 'ok' ? 0.8 : 0.5
  const tdee = formulaTdee ? Math.round(formulaTdee * (1 - weight) + raw * weight) : raw
  return { tdee, raw, conf, reason: null, ...counts, kgPerWeek: Math.round(slope * 7 * 100) / 100 }
}
