/* Eat more on the days you train and less on the days you do not — without eating more overall.
 *
 * The daily target already contains an average day's training (it comes from expenditure over
 * weeks). This only redistributes it: a training day gets the energy of its session minus the
 * daily average of all sessions, a rest day gives that average back. Over a normal week the
 * shifts cancel.
 *
 * The session's energy is an estimate from what was logged — how long it took and how heavy the
 * person is — not a reading from a watch. Resistance training costs roughly 3–6 MET depending on
 * how it is done; 4 is used (3 above resting), and the shift is capped, because the honest error
 * bar on that figure is wide.
 */
import { effectiveRoutineIds } from './history.js'
import { dayBefore } from './nutrition.js'

export const NET_MET = 3            // kcal per kg per hour above resting
export const MAX_SHIFT = 0.15       // of the day's base target, either way
export const LOOKBACK_DAYS = 28
const HOUR = 3600000

/** Energy a logged workout cost above resting, in kcal, for a person of `kg`. */
export function sessionKcal(w, kg) {
  if (!w || !(kg > 0)) return 0
  let hours = (w.end - w.start) / HOUR
  // An imported workout has no clock; price it by its completed sets at about 2½ minutes each.
  if (!(hours >= 1 / 60)) {
    const sets = (w.entries || []).reduce((n, e) => n + (e.sets || []).filter(s => s && s.done).length, 0)
    hours = sets * 2.5 / 60
  }
  return Math.round(NET_MET * kg * Math.min(3, Math.max(0, hours)))
}

/**
 * kcal to add to (or take from) the base target on day `d`.
 *   - a day with a logged workout: that workout
 *   - today or later, nothing logged yet, a routine planned: the typical past session
 *   - anything else: a rest day
 * 0 until there are sessions in the look-back window to average over.
 */
export function trainingShift(S, d, { kg, base, today = d } = {}) {
  const from = dayBefore(today, LOOKBACK_DAYS)
  const recent = (S.workouts || []).filter(w => w && w.d > from && w.d <= today)
  if (!recent.length || !(base > 0)) return 0
  const costs = recent.map(w => sessionKcal(w, kg)).filter(k => k > 0)
  if (!costs.length) return 0
  const perDay = costs.reduce((a, b) => a + b, 0) / LOOKBACK_DAYS
  const onDay = (S.workouts || []).filter(w => w && w.d === d)
  let trained = onDay.reduce((a, w) => a + sessionKcal(w, kg), 0)
  if (!onDay.length && d >= today && S.routines && S.week && S.dayPlan && effectiveRoutineIds(S, d).length) {
    const sorted = [...costs].sort((a, b) => a - b)
    trained = sorted[Math.floor(sorted.length / 2)]
  }
  const cap = Math.round(base * MAX_SHIFT)
  return Math.round(Math.min(cap, Math.max(-cap, trained - perDay)))
}
