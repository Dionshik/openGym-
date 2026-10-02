/* Body measurements and the facts the energy formulas need.
 *
 * S.measurements is one row per day, in centimetres and percent whatever the profile's weight
 * unit — changing kg/lb must never relabel an old waist as something it is not. The field names
 * are the ones upstream's own body-measurements work uses (waist, upperArmLeft, …), a subset of
 * them, so the two meet on the same rows when that lands here; `leanMass` (kg) is this fork's
 * addition, because Apple Health reports it.
 *
 * This file imports nothing: the MCP bridge reads MEASURE_KEYS from it.
 */

// `site` is the place on the body, shared by a left and a right key: the measuring instruction
// (lib/measure-guide.js) and the muscles under the tape (SITE_MUSCLES) belong to the site.
// `extra` keeps a field out of the entry sheet until it is asked for or already in use — wrist
// and ankle are frame-size references that training barely moves. `upperArmFlexed*` is this
// fork's addition: the arm measured tensed, which is the number people mean by "my biceps".
export const MEASURES = [
  { key: 'waist', group: 'torso', site: 'waist' },
  { key: 'abdomen', group: 'torso', site: 'abdomen' },
  { key: 'chest', group: 'torso', site: 'chest' },
  { key: 'hips', group: 'torso', site: 'hips' },
  { key: 'shoulders', group: 'torso', site: 'shoulders' },
  { key: 'neck', group: 'torso', site: 'neck' },
  { key: 'upperArmLeft', group: 'arms', site: 'upperArm' },
  { key: 'upperArmRight', group: 'arms', site: 'upperArm' },
  { key: 'upperArmFlexedLeft', group: 'arms', site: 'upperArmFlexed' },
  { key: 'upperArmFlexedRight', group: 'arms', site: 'upperArmFlexed' },
  { key: 'forearmLeft', group: 'arms', site: 'forearm' },
  { key: 'forearmRight', group: 'arms', site: 'forearm' },
  { key: 'wristLeft', group: 'arms', site: 'wrist', extra: true },
  { key: 'wristRight', group: 'arms', site: 'wrist', extra: true },
  { key: 'thighLeft', group: 'legs', site: 'thigh' },
  { key: 'thighRight', group: 'legs', site: 'thigh' },
  { key: 'calfLeft', group: 'legs', site: 'calf' },
  { key: 'calfRight', group: 'legs', site: 'calf' },
  { key: 'ankleLeft', group: 'legs', site: 'ankle', extra: true },
  { key: 'ankleRight', group: 'legs', site: 'ankle', extra: true },
  { key: 'bodyFat', group: 'other', kind: 'percent' },
  { key: 'leanMass', group: 'other', kind: 'mass' }
]
export const MEASURE_KEYS = MEASURES.map(m => m.key)
const BY_KEY = Object.fromEntries(MEASURES.map(m => [m.key, m]))

/** The body site a key measures ('upperArm' for both arms); null for body fat and lean mass. */
export const siteOf = key => BY_KEY[key]?.site || null
/** A tape measurement — a length, as opposed to a percentage or a mass. */
export const isGirth = key => !!BY_KEY[key] && !BY_KEY[key].kind
/** The muscles under the tape, in lib/muscles.js slugs. A site with none (waist, wrist) is one
 *  where a change says nothing about a trained muscle. */
export const SITE_MUSCLES = {
  upperArm: ['biceps', 'triceps'], upperArmFlexed: ['biceps', 'triceps'], forearm: ['forearm'],
  chest: ['chest', 'upper-back'], shoulders: ['deltoids'], neck: ['trapezius'],
  hips: ['gluteal'], thigh: ['quadriceps', 'hamstring', 'adductors'], calf: ['calves'],
  waist: [], abdomen: [], wrist: [], ankle: []
}

const IN = 2.54, LB = 0.45359237
const r1 = n => Math.round(n * 10) / 10
const list = v => (Array.isArray(v) ? v : [])

/** The unit a measurement is shown in: %, the profile's weight unit, or cm / in. */
export const measureUnit = (key, unit) => (BY_KEY[key]?.kind === 'percent' ? '%' : BY_KEY[key]?.kind === 'mass' ? (unit === 'lb' ? 'lb' : 'kg') : unit === 'lb' ? 'in' : 'cm')
/** Stored value → what the user sees. */
export function toDisplay(key, v, unit) {
  if (!(v > 0)) return null
  const kind = BY_KEY[key]?.kind
  if (kind === 'percent') return r1(v)
  if (kind === 'mass') return r1(unit === 'lb' ? v / LB : v)
  return r1(unit === 'lb' ? v / IN : v)
}
/** What the user typed → the stored value (cm, %, kg); null for nothing or nonsense. */
export function fromDisplay(key, v, unit) {
  const n = +v
  if (!(n > 0)) return null
  const kind = BY_KEY[key]?.kind
  if (kind === 'percent') return n <= 70 ? r1(n) : null
  if (kind === 'mass') return r1(unit === 'lb' ? n * LB : n)
  const cm = r1(unit === 'lb' ? n * IN : n)
  return cm <= 300 ? cm : null
}
/** A difference between two stored values (a change, a rate, a margin), which may be negative
 *  or zero and so cannot go through toDisplay. Two decimals: a monthly rate is a small number. */
export function deltaToDisplay(key, v, unit) {
  if (!Number.isFinite(v)) return null
  const kind = BY_KEY[key]?.kind
  const k = kind === 'percent' ? 1 : unit !== 'lb' ? 1 : kind === 'mass' ? 1 / LB : 1 / IN
  return Math.round(v * k * 100) / 100
}
export const cmToDisplay = (cm, unit) => (cm > 0 ? r1(unit === 'lb' ? cm / IN : cm) : null)
export const cmFromDisplay = (v, unit) => (+v > 0 ? r1(unit === 'lb' ? +v * IN : +v) : null)

// The smallest difference between two single tape readings that is a difference: 2.77 × the
// technical error of measurement (about 2.6 mm for an arm; Ulijaszek & Kerr, Br J Nutr 1999).
// Below it, two numbers are the same number — in time (lib/body-trend.js) and between sides.
export const TAPE_DETECTABLE_CM = 0.7
// Left and right are only comparable when they were measured in the same session, or nearly.
export const SIDES_MAX_APART_DAYS = 14

/** The other arm, leg…: 'upperArmLeft' ↔ 'upperArmRight'. null for a measurement with no pair. */
export function otherSide(key) {
  const m = /^(.+)(Left|Right)$/.exec(String(key))
  const other = m && m[1] + (m[2] === 'Left' ? 'Right' : 'Left')
  return other && BY_KEY[other] && BY_KEY[key] ? other : null
}

/**
 * Left against right, for every site this profile has measured on both sides — each side's
 * latest reading:
 *   [{ site, left: { key, v, d }, right: { key, v, d }, diff, apartDays, comparable, within }]
 *     diff        right − left, in the stored unit
 *     apartDays   days between the two readings
 *     comparable  they were taken close enough together to be set against each other at all
 *     within      comparable, and the difference is inside the tape's own error — which is to
 *                 say: no difference this method can see. Nearly everybody is a few millimetres
 *                 asymmetric; a tape is not the instrument that shows it.
 */
export function sidePairs(S) {
  const latest = latestMeasures(S)
  const out = []
  for (const m of MEASURES) {
    if (!/Left$/.test(m.key)) continue
    const rk = otherSide(m.key)
    const l = latest[m.key], r = rk && latest[rk]
    if (!l || !r) continue
    const apartDays = Math.abs(Math.round((new Date(l.d + 'T12:00:00') - new Date(r.d + 'T12:00:00')) / 86400000))
    const diff = Math.round((r.v - l.v) * 10) / 10
    const comparable = apartDays <= SIDES_MAX_APART_DAYS
    out.push({ site: m.site, left: { key: m.key, ...l }, right: { key: rk, ...r }, diff, apartDays, comparable, within: comparable && Math.abs(diff) < TAPE_DETECTABLE_CM })
  }
  return out
}

/** The most recent value of every measurement that has one: { waist: { v, d }, … }. */
export function latestMeasures(S) {
  const out = {}
  for (const row of list(S?.measurements)) {
    if (!row) continue
    for (const key of MEASURE_KEYS) if (row[key] > 0) out[key] = { v: row[key], d: row.d }
  }
  return out
}
/** One measurement over time, as chart points in the display unit. */
export function measureSeries(S, key) {
  return list(S?.measurements).filter(r => r && r[key] > 0)
    .map(r => ({ t: new Date(r.d + 'T12:00:00').getTime(), y: toDisplay(key, r[key], S.unit), d: r.d }))
}
/** Which measurements this profile has ever recorded, in display order. */
export const usedMeasures = S => MEASURE_KEYS.filter(k => list(S?.measurements).some(r => r && r[k] > 0))

/** The goal set for a measurement, in the stored unit; null when there is none. */
export const goalOf = (S, key) => { const v = S?.measureGoals?.[key]?.v; return v > 0 ? v : null }
/** Goals from two copies of the profile: per measurement, whichever was set (or cleared) later. */
export function mergeGoals(a, b) {
  const out = { ...(a || {}) }
  for (const [k, g] of Object.entries(b || {})) if (!out[k] || (g?.t || 0) > (out[k]?.t || 0)) out[k] = g
  return out
}

/** Change between the latest value and the one before it, in the display unit; null with one point. */
export function measureDelta(S, key) {
  const pts = measureSeries(S, key)
  return pts.length > 1 ? r1(pts.at(-1).y - pts.at(-2).y) : null
}
