/* Body measurements and the facts the energy formulas need.
 *
 * S.measurements is one row per day, in centimetres and percent whatever the profile's weight
 * unit — changing kg/lb must never relabel an old waist as something it is not. The field names
 * are the ones upstream's own body-measurements work uses (waist, upperArmLeft, …), a subset of
 * them, so the two meet on the same rows when that lands here; `leanMass` (kg) is this fork's
 * addition, because Apple Health reports it.
 */

export const MEASURES = [
  { key: 'waist', group: 'torso' },
  { key: 'chest', group: 'torso' },
  { key: 'hips', group: 'torso' },
  { key: 'shoulders', group: 'torso' },
  { key: 'neck', group: 'torso' },
  { key: 'upperArmLeft', group: 'arms' },
  { key: 'upperArmRight', group: 'arms' },
  { key: 'thighLeft', group: 'legs' },
  { key: 'thighRight', group: 'legs' },
  { key: 'calfLeft', group: 'legs' },
  { key: 'calfRight', group: 'legs' },
  { key: 'bodyFat', group: 'other', kind: 'percent' },
  { key: 'leanMass', group: 'other', kind: 'mass' }
]
export const MEASURE_KEYS = MEASURES.map(m => m.key)
const BY_KEY = Object.fromEntries(MEASURES.map(m => [m.key, m]))

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
export const cmToDisplay = (cm, unit) => (cm > 0 ? r1(unit === 'lb' ? cm / IN : cm) : null)
export const cmFromDisplay = (v, unit) => (+v > 0 ? r1(unit === 'lb' ? +v * IN : +v) : null)

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

/** Change between the latest value and the one before it, in the display unit; null with one point. */
export function measureDelta(S, key) {
  const pts = measureSeries(S, key)
  return pts.length > 1 ? r1(pts.at(-1).y - pts.at(-2).y) : null
}
