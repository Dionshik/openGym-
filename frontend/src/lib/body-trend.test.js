import { describe, it, expect } from 'vitest'
import { tQuantile95, olsFit, measureTrend, goalEta, growthContext, MIN_POINTS, MIN_SPAN_DAYS, MAX_AGE_DAYS, SIGMA_FLOOR_CM } from './body-trend.js'

const TODAY = '2026-10-01'
const DAY = 86400000
const dayAt = n => {                       // n days before TODAY
  const d = new Date(new Date(TODAY + 'T12:00:00').getTime() - n * DAY)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
// Readings of one key: [daysAgo, cm] pairs.
const profile = (key, pairs, over = {}) => ({
  unit: 'kg', workouts: [], routines: [], week: {}, bodyweight: [],
  measurements: pairs.map(([ago, v]) => ({ d: dayAt(ago), t: 1, [key]: v })).sort((a, b) => (a.d < b.d ? -1 : 1)),
  ...over
})
const ARM = 'upperArmFlexedLeft'

describe('the building blocks', () => {
  it('Student t for a two-sided 95 % interval', () => {
    expect(tQuantile95(1)).toBe(12.706)
    expect(tQuantile95(3)).toBe(3.182)
    expect(tQuantile95(5)).toBe(2.571)
    expect(tQuantile95(30)).toBe(2.042)
    expect(tQuantile95(35)).toBe(2.042)        // past the table: the wider neighbour
    expect(tQuantile95(1000)).toBe(1.98)
    expect(tQuantile95(0)).toBeNaN()
  })
  it('least squares recovers an exact line', () => {
    const fit = olsFit([0, 10, 20, 30].map(x => ({ x, y: 40 + 0.05 * x })))
    expect(fit.b).toBeCloseTo(0.05, 10)
    expect(fit.a).toBeCloseTo(40, 10)
    expect(fit.sse).toBeCloseTo(0, 10)
    expect(olsFit([{ x: 1, y: 2 }])).toBe(null)
    expect(olsFit([{ x: 1, y: 2 }, { x: 1, y: 3 }])).toBe(null)
  })
})

describe('measureTrend refuses rather than guesses', () => {
  it('body fat and lean mass are not tape measurements', () => {
    expect(measureTrend(profile('bodyFat', [[60, 20], [0, 19]]), 'bodyFat', { today: TODAY }).reason).toBe('kind')
  })
  it('too few readings', () => {
    const r = measureTrend(profile(ARM, [[70, 38], [56, 38.2], [28, 38.4], [0, 38.6]]), ARM, { today: TODAY })
    expect(r).toMatchObject({ ok: false, reason: 'few-points', n: 4, need: MIN_POINTS })
  })
  it('readings that cover too short a time', () => {
    const r = measureTrend(profile(ARM, [[40, 38], [30, 38.1], [20, 38.2], [10, 38.3], [0, 38.4]]), ARM, { today: TODAY })
    expect(r).toMatchObject({ ok: false, reason: 'short-span', spanDays: 40, need: MIN_SPAN_DAYS })
  })
  it('readings bunched at one end', () => {
    const r = measureTrend(profile(ARM, [[80, 38], [8, 38.4], [6, 38.4], [3, 38.5], [0, 38.5]]), ARM, { today: TODAY })
    expect(r).toMatchObject({ ok: false, reason: 'uneven' })
  })
  it('a last reading that is too old', () => {
    const r = measureTrend(profile(ARM, [[150, 38], [130, 38.2], [110, 38.4], [90, 38.6], [60, 38.8]]), ARM, { today: TODAY })
    expect(r).toMatchObject({ ok: false, reason: 'stale', need: MAX_AGE_DAYS })
  })
  it('readings older than the window, in the future, empty or broken do not count', () => {
    const S = profile(ARM, [[300, 30], [250, 31], [200, 32], [190, 33], [0, 38]])
    S.measurements.push(null, { d: dayAt(-5), [ARM]: 50 }, { d: dayAt(3) })
    expect(measureTrend(S, ARM, { today: TODAY })).toMatchObject({ ok: false, reason: 'few-points', n: 1 })
    expect(measureTrend({}, ARM, { today: TODAY }).reason).toBe('few-points')
  })
})

describe('measureTrend answers with a range', () => {
  // 0.5 cm a month, measured every fortnight for twelve weeks, exactly on the line.
  const steady = () => profile(ARM, [84, 70, 56, 42, 28, 14, 0].map(ago => [ago, +(38 + 0.5 * (84 - ago) / 30.44).toFixed(4)]))

  it('a steady gain is detected, with the slope and its interval per month', () => {
    const r = measureTrend(steady(), ARM, { today: TODAY })
    expect(r.ok).toBe(true)
    expect(r.n).toBe(7)
    expect(r.spanDays).toBe(84)
    expect(r.perMonth).toBe(0.5)
    expect(r.detectable).toBe(true)
    // Points on an exact line still get the tape's own scatter: the floor, not zero.
    expect(r.sigma).toBe(SIGMA_FLOOR_CM)
    // se = 0.3 / sqrt(5488) per day; t(5) = 2.571 → ±0.32 cm a month
    expect(r.ci[0]).toBeCloseTo(0.18, 2)
    expect(r.ci[1]).toBeCloseTo(0.82, 2)
  })
  it('the projection is a range for one future reading, twelve weeks ahead at most', () => {
    const r = measureTrend(steady(), ARM, { today: TODAY })
    const p = r.projection
    expect(p.days).toBe(84)
    expect(p.d).toBe(dayAt(-84))
    expect(p.mid).toBeCloseTo(40.8, 1)                 // 38 + 0.5 × 168 / 30.44
    expect(p.lo).toBeLessThan(p.mid)
    expect(p.hi).toBeGreaterThan(p.mid)
    expect(p.hi - p.lo).toBeGreaterThan(2 * 2.571 * SIGMA_FLOOR_CM)   // wider than the scatter alone: the line itself is uncertain
    expect(p.path).toHaveLength(7)
    expect(p.path[0].d).toBe(dayAt(0))
    expect(p.path.at(-1)).toMatchObject({ d: p.d, mid: p.mid, lo: p.lo, hi: p.hi })
    // The further ahead, the wider.
    expect(p.path.at(-1).hi - p.path.at(-1).lo).toBeGreaterThan(p.path[0].hi - p.path[0].lo)
  })
  it('never projects further ahead than the readings reach back', () => {
    const S = profile(ARM, [56, 42, 28, 14, 0].map(ago => [ago, 38 + 0.05 * (56 - ago)]))
    const r = measureTrend(S, ARM, { today: TODAY })
    expect(r.detectable).toBe(true)
    expect(r.projection.days).toBe(56)
  })
  it('a change inside the tape error is "no trend yet": no projection', () => {
    const S = profile(ARM, [[84, 38], [70, 38.2], [56, 37.9], [42, 38.1], [28, 38], [14, 38.2], [0, 38.1]])
    const r = measureTrend(S, ARM, { today: TODAY })
    expect(r.ok).toBe(true)
    expect(r.detectable).toBe(false)
    expect(r.projection).toBe(null)
    expect(r.ci[0]).toBeLessThan(0)
    expect(r.ci[1]).toBeGreaterThan(0)
  })
  it('a shrinking waist is a trend too', () => {
    const S = profile('waist', [84, 70, 56, 42, 28, 14, 0].map(ago => [ago, +(95 - 1.2 * (84 - ago) / 30.44).toFixed(4)]))
    const r = measureTrend(S, 'waist', { today: TODAY })
    expect(r.perMonth).toBe(-1.2)
    expect(r.detectable).toBe(true)
    expect(r.projection.mid).toBeLessThan(91.7)
  })
  it('a noisy series widens the range instead of hiding the noise', () => {
    const calm = measureTrend(steady(), ARM, { today: TODAY })
    const S = steady()
    S.measurements.forEach((row, i) => { row[ARM] += i % 2 ? 0.6 : -0.6 })
    const noisy = measureTrend(S, ARM, { today: TODAY })
    expect(noisy.sigma).toBeGreaterThan(calm.sigma)
    expect(noisy.ci[1] - noisy.ci[0]).toBeGreaterThan(calm.ci[1] - calm.ci[0])
  })
})

describe('goalEta', () => {
  const trend = { ok: true, perMonth: 0.5, projection: { days: 84, mid: 40.8 } }   // today's line: 39.42
  it('a goal the line reaches inside the projection gets a time', () => {
    expect(goalEta(trend, 40)).toEqual({ days: 35 })
  })
  it('a goal beyond the horizon, behind the line, or the wrong way gets none', () => {
    expect(goalEta(trend, 45)).toBe(null)
    expect(goalEta(trend, 39)).toBe(null)
    expect(goalEta({ ...trend, perMonth: -0.5 }, 45)).toBe(null)
    expect(goalEta({ ok: true, perMonth: 0.5, projection: null }, 40)).toBe(null)
    expect(goalEta({ ok: false }, 40)).toBe(null)
    expect(goalEta(trend, null)).toBe(null)
  })
})

describe('growthContext', () => {
  const set = { done: true, w: 20, r: 10 }
  const workout = ago => ({ id: 'w' + ago, d: dayAt(ago), start: 1, entries: [{ id: 'c1', exercise: { n: 'Curl', muscleWeights: { biceps: 1, forearm: 0.4 } }, sets: [set, set, set, set] }] })
  const S = (over = {}) => ({
    unit: 'kg', measurements: [],
    routines: [{ id: 'r1', name: 'Arms', ex: [{ id: 'c1', muscleWeights: { biceps: 1, forearm: 0.4 }, sets: 3 }] }],
    week: { 1: ['r1'], 4: ['r1'] }, workouts: [workout(2), workout(9), workout(16), workout(40)],
    bodyweight: [[27, 80], [20, 80.2], [13, 80.5], [6, 80.7], [0, 81]].map(([ago, w]) => ({ d: dayAt(ago), w })),
    ...over
  })

  it('weekly sets for the muscles under the tape: done over four weeks, and planned', () => {
    const c = growthContext(S(), ARM, { today: TODAY })
    expect(c.site).toBe('upperArmFlexed')
    // three sessions in the window × 4 sets ÷ 4 weeks; the plan is 2 days × 3 sets
    expect(c.muscles).toEqual([{ slug: 'biceps', done: 3, planned: 6 }, { slug: 'triceps', done: 0, planned: 0 }])
  })
  it('a site with no trained muscle under it has no sets to report', () => {
    expect(growthContext(S(), 'waist', { today: TODAY }).muscles).toEqual([])
  })
  it('the weight trend in kg a week, in kilograms whatever the profile unit', () => {
    expect(growthContext(S(), ARM, { today: TODAY }).weight).toBeCloseTo(0.26, 2)
    const lb = S({ unit: 'lb', bodyweight: [[27, 176], [20, 177], [13, 178], [6, 179], [0, 180]].map(([ago, w]) => ({ d: dayAt(ago), w })) })
    expect(growthContext(lb, ARM, { today: TODAY }).weight).toBeCloseTo(0.47, 2)
    expect(growthContext(S({ bodyweight: [{ d: dayAt(3), w: 80 }] }), ARM, { today: TODAY }).weight).toBe(null)
  })
  it('protein per kilogram needs five logged days', () => {
    const days = n => ({ v: 1, log: [], foods: [], del: {}, days: Object.fromEntries(Array.from({ length: n }, (_, i) => [dayAt(i + 1), { k: 2400, p: 162, f: 80, c: 250, n: 5 }])) })
    expect(growthContext(S({ nutrition: days(6) }), ARM, { today: TODAY }).protein).toBe(2)
    expect(growthContext(S({ nutrition: days(4) }), ARM, { today: TODAY }).protein).toBe(null)
    expect(growthContext(S({ nutrition: days(6), bodyweight: [] }), ARM, { today: TODAY }).protein).toBe(null)
  })
  it('the level comes from the Coach intake, else from the first logged workout', () => {
    expect(growthContext(S(), ARM, { today: TODAY }).level).toBe('new')
    expect(growthContext(S({ workouts: [workout(400)] }), ARM, { today: TODAY }).level).toBe('trained')
    expect(growthContext(S({ workouts: [] }), ARM, { today: TODAY }).level).toBe(null)
    expect(growthContext(S({ coach: { profile: { experience: 'regular' } } }), ARM, { today: TODAY }).level).toBe('trained')
    expect(growthContext(S({ workouts: [workout(400)], coach: { profile: { experience: 'new' } } }), ARM, { today: TODAY }).level).toBe('new')
  })
  it('the study figures are offered for the flexed arm only, and only with a level', () => {
    expect(growthContext(S(), ARM, { today: TODAY }).reference).toEqual({ weeks: [10, 12], cm: [1.3, 1.5] })
    expect(growthContext(S({ workouts: [workout(400)] }), ARM, { today: TODAY }).reference).toEqual({ weeks: [10, 12], cm: [0.4, 0.4] })
    expect(growthContext(S(), 'upperArmLeft', { today: TODAY }).reference).toBe(null)
    expect(growthContext(S({ workouts: [] }), ARM, { today: TODAY }).reference).toBe(null)
  })
  it('an empty profile yields empty answers, not a crash', () => {
    expect(growthContext({}, ARM, { today: TODAY })).toMatchObject({ weight: null, protein: null, level: null, reference: null })
  })
})
