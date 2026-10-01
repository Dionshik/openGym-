/* How much to eat: resting expenditure from the body, total expenditure from how active the
 * person is, a daily energy target from the goal, and protein / fat / carbohydrate from that.
 *
 * Every formula here is the textbook one, on purpose — a number the user can look up beats a
 * clever number they cannot:
 *
 *   Mifflin–St Jeor   BMR = 10·kg + 6.25·cm − 5·age + 5 (men) / − 161 (women)
 *   Katch–McArdle     BMR = 370 + 21.6 · lean mass (kg) — used when body fat is known
 *   activity factor   1.2 / 1.375 / 1.55 / 1.725 / 1.9
 *   goal              a share of body weight per week, at 7700 kcal per kilogram
 *   protein           g per kg of body weight (1.4–2.0 is the ISSN range for people who train)
 *
 * The energy target never goes below FLOOR. Below that a diary app has no business setting a
 * goal on its own; the caller shows that the floor was applied.
 */
import { adaptiveTdee } from './nutrition-adaptive.js'
import { trainingShift } from './nutrition-training.js'
import { nutritionOf } from './nutrition.js'

export const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 }
export const ACTIVITY_LEVELS = Object.keys(ACTIVITY)
export const KCAL_PER_KG = 7700
export const FLOOR = { m: 1500, f: 1200 }
export const GOALS = ['lose', 'maintain', 'gain']
export const RATE = { lose: { min: 0.25, max: 1, def: 0.5 }, gain: { min: 0.1, max: 0.5, def: 0.25 } }   // % of body weight per week
export const PROTEIN = { min: 1.2, max: 2.4, def: 1.8 }                                                 // g per kg
export const DEFAULT_SETTINGS = { mode: 'auto', goal: 'maintain', rate: null, proteinPerKg: PROTEIN.def, cycle: true }

const LB = 0.45359237
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const r1 = n => Math.round(n * 10) / 10
export const kgOf = (w, unit) => (unit === 'lb' ? w * LB : w)

/** Age in whole years on `today` from a birth year — the profile stores no more than the year. */
export const ageOf = (born, today) => (born > 1900 ? clamp(+String(today).slice(0, 4) - born, 0, 120) : null)

export function bmrMifflin({ kg, cm, age, sex }) {
  const base = 10 * kg + 6.25 * cm - 5 * age
  // No sex given: the midpoint of the two constants, rather than silently assuming either.
  return Math.round(base + (sex === 'm' ? 5 : sex === 'f' ? -161 : -78))
}
export const bmrKatch = ({ kg, bodyFat }) => Math.round(370 + 21.6 * kg * (1 - bodyFat / 100))

/** What the formulas need, read from the profile. A missing value is null, never a guess. */
export function personOf(S, today) {
  const bw = (S.bodyweight || []).filter(b => b && b.d <= today).at(-1)
  const bp = S.bodyProfile || {}
  const fat = (S.measurements || []).filter(m => m && m.bodyFat > 0 && m.d <= today).at(-1)
  return {
    kg: bw ? r1(kgOf(bw.w, S.unit)) : null,
    cm: bp.heightCm > 0 ? bp.heightCm : null,
    age: ageOf(bp.born, today),
    sex: bp.sex === 'm' || bp.sex === 'f' ? bp.sex : null,
    activity: ACTIVITY[bp.activity] ? bp.activity : null,
    bodyFat: fat && fat.bodyFat >= 3 && fat.bodyFat <= 60 ? fat.bodyFat : null
  }
}
/** Which facts are still missing for a computed target — 'weight' | 'height' | 'born'. */
export function missingFor(person) {
  const out = []
  if (!person.kg) out.push('weight')
  if (!person.bodyFat) { if (!person.cm) out.push('height'); if (person.age == null) out.push('born') }
  return out
}

/** Resting expenditure and which formula gave it; null while a needed fact is missing. */
export function bmrOf(person) {
  if (!person.kg) return null
  if (person.bodyFat) return { kcal: bmrKatch(person), formula: 'katch' }
  if (!person.cm || person.age == null) return null
  return { kcal: bmrMifflin(person), formula: 'mifflin' }
}
export const tdeeFormula = (bmrKcal, activity) => Math.round(bmrKcal * (ACTIVITY[activity] || ACTIVITY.light))

/** The day's energy target for a goal. `floored` says the safety floor replaced the arithmetic. */
export function goalKcal(tdee, { goal = 'maintain', rate, kg, sex } = {}) {
  let delta = 0
  if (goal === 'lose' || goal === 'gain') {
    const lim = RATE[goal]
    const pct = clamp(rate > 0 ? rate : lim.def, lim.min, lim.max)
    delta = Math.round(pct / 100 * (kg || 0) * KCAL_PER_KG / 7) * (goal === 'lose' ? -1 : 1)
  }
  const floor = FLOOR[sex] || FLOOR.m
  const want = Math.round(tdee + delta)
  return want < floor ? { kcal: floor, delta: floor - Math.round(tdee), floored: true } : { kcal: want, delta, floored: false }
}

/** Protein by body weight, fat at a healthy minimum, carbohydrate takes what is left. */
export function macroTargets(kcal, { kg, proteinPerKg = PROTEIN.def } = {}) {
  const p = Math.round(clamp(proteinPerKg, PROTEIN.min, PROTEIN.max) * kg)
  let f = Math.round(Math.max(0.7 * kg, kcal * 0.25 / 9))
  let c = Math.round((kcal - 4 * p - 9 * f) / 4)
  if (c < 0) { f = Math.max(Math.round(0.5 * kg), Math.round((kcal - 4 * p) / 9)); c = Math.max(0, Math.round((kcal - 4 * p - 9 * f) / 4)) }
  return { p, f: Math.max(0, f), c }
}

/** The saved target settings with every default filled in. */
export const settingsOf = S => ({ ...DEFAULT_SETTINGS, ...(nutritionOf(S).targets || {}) })

/**
 * The target that holds on average — before today's training moves it.
 * Manual: what the user typed. Auto: expenditure (measured from the weight trend when there is
 * enough of a diary to measure it, the formula otherwise) plus the goal.
 * Returns { kcal, p, f, c, tdee, bmr, basis, conf, floored, missing }; kcal is null while
 * `missing` names what the profile still lacks.
 */
export function baseTargets(S, today) {
  const set = settingsOf(S)
  if (set.mode === 'manual') {
    return { kcal: set.kcal || null, p: set.p || 0, f: set.f || 0, c: set.c || 0, tdee: null, bmr: null, basis: 'manual', conf: null, floored: false, missing: [] }
  }
  const person = personOf(S, today)
  const b = bmrOf(person)
  const formula = b ? tdeeFormula(b.kcal, person.activity) : null
  const measured = adaptiveTdee(S, { today, bmrKcal: b?.kcal || null, formulaTdee: formula })
  const tdee = measured.tdee || formula
  if (!tdee || !person.kg) return { kcal: null, p: 0, f: 0, c: 0, tdee: null, bmr: b?.kcal || null, basis: null, conf: null, floored: false, missing: missingFor(person) }
  const g = goalKcal(tdee, { goal: set.goal, rate: set.rate, kg: person.kg, sex: person.sex })
  return {
    kcal: g.kcal, ...macroTargets(g.kcal, { kg: person.kg, proteinPerKg: set.proteinPerKg }),
    tdee, bmr: b?.kcal || null, basis: measured.tdee ? 'adaptive' : 'formula', conf: measured.conf, reason: measured.reason, floored: g.floored, missing: []
  }
}

/**
 * The target for one day: the base, moved towards what was (or is planned to be) trained that
 * day when "follow my training" is on. The difference goes into carbohydrate; protein and fat
 * stay put. `shift` is the kcal moved, 0 on an average day.
 */
export function targetsFor(S, d, today = d) {
  const base = baseTargets(S, today)
  if (!base.kcal) return { ...base, shift: 0 }
  const set = settingsOf(S)
  const person = personOf(S, today)
  const shift = set.cycle && set.mode !== 'manual' && person.kg ? trainingShift(S, d, { kg: person.kg, base: base.kcal, today }) : 0
  if (!shift) return { ...base, shift: 0 }
  return { ...base, kcal: base.kcal + shift, c: Math.max(0, Math.round(base.c + shift / 4)), shift }
}

/** What to store beside the settings so that a reader without these formulas — the server,
 *  the Coach, the MCP bridge — still knows the current target. */
export function snapshotTargets(S, today, now = Date.now()) {
  const set = settingsOf(S)
  const b = baseTargets(S, today)
  const keep = { mode: set.mode, goal: set.goal, rate: set.rate, proteinPerKg: set.proteinPerKg, cycle: set.cycle, t: set.t || 0 }
  if (set.mode === 'manual') return { ...keep, kcal: set.kcal || null, p: set.p || 0, f: set.f || 0, c: set.c || 0, basis: 'manual', at: now }
  return { ...keep, kcal: b.kcal, p: b.p, f: b.f, c: b.c, tdee: b.tdee, basis: b.basis, conf: b.conf, at: now }
}
