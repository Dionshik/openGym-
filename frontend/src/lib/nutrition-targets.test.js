import { describe, it, expect } from 'vitest'
import {
  ACTIVITY, FLOOR, ageOf, kgOf, bmrMifflin, bmrKatch, bmrOf, tdeeFormula, goalKcal, macroTargets,
  personOf, missingFor, settingsOf, baseTargets, targetsFor, snapshotTargets
} from './nutrition-targets.js'
import { adaptiveTdee, weightSlope, MIN_LOGGED_DAYS, MIN_WEIGH_INS } from './nutrition-adaptive.js'
import { sessionKcal, trainingShift } from './nutrition-training.js'
import { emptyNutrition, dayBefore } from './nutrition.js'

const TODAY = '2026-10-01'
const person = { kg: 80, cm: 180, age: 30, sex: 'm', activity: 'moderate', bodyFat: null }
const profile = (over = {}) => ({
  unit: 'kg', bodyweight: [{ d: '2026-09-30', w: 80, t: 1 }], bodyProfile: { sex: 'm', born: 1996, heightCm: 180, activity: 'moderate', t: 1 },
  measurements: [], workouts: [], routines: [], week: {}, dayPlan: {}, nutrition: null, ...over
})
// `n` days of diary ending yesterday, `kcal` each, as folded-free log rows.
const diary = (n, kcal, { skip = () => false } = {}) => {
  const log = []
  for (let i = 1; i <= n; i++) { const d = dayBefore(TODAY, i); if (!skip(i)) log.push({ id: 'e' + i, d, m: 1, n: 'x', g: 0, k: kcal, p: 0, f: 0, c: 0, t: i }) }
  return { ...emptyNutrition(), log }
}
// A weigh-in every `every` days over the last `n` days, changing `perDay` kg a day.
const weighIns = (n, perDay, every = 2, start = 80) => {
  const out = []
  for (let i = n; i >= 1; i -= every) out.push({ d: dayBefore(TODAY, i), w: Math.round((start + (n - i) * perDay) * 1000) / 1000, t: i })
  return out
}

describe('the formulas', () => {
  it('Mifflin–St Jeor', () => {
    expect(bmrMifflin(person)).toBe(1780)
    expect(bmrMifflin({ kg: 60, cm: 165, age: 30, sex: 'f' })).toBe(1320)
    expect(bmrMifflin({ ...person, sex: null })).toBe(1697)          // between the two, not either
  })
  it('Katch–McArdle from lean mass', () => {
    expect(bmrKatch({ kg: 80, bodyFat: 20 })).toBe(1752)
  })
  it('uses body fat when it is known, the body measurements otherwise, and nothing when a fact is missing', () => {
    expect(bmrOf({ ...person, bodyFat: 20 })).toEqual({ kcal: 1752, formula: 'katch' })
    expect(bmrOf(person)).toEqual({ kcal: 1780, formula: 'mifflin' })
    expect(bmrOf({ ...person, cm: null })).toBe(null)
    expect(bmrOf({ ...person, kg: null, bodyFat: 20 })).toBe(null)
    expect(bmrOf({ kg: 80, bodyFat: 20, cm: null, age: null })).toEqual({ kcal: 1752, formula: 'katch' })
  })
  it('activity multiplies; an unset level is treated as light, not sedentary', () => {
    expect(tdeeFormula(1780, 'moderate')).toBe(2759)
    expect(tdeeFormula(1780, null)).toBe(Math.round(1780 * ACTIVITY.light))
  })
  it('age from a birth year, weight from either unit', () => {
    expect(ageOf(1996, TODAY)).toBe(30)
    expect(ageOf(null, TODAY)).toBe(null)
    expect(kgOf(176.4, 'lb')).toBeCloseTo(80.01, 1)
    expect(kgOf(80, 'kg')).toBe(80)
  })
})

describe('goalKcal', () => {
  it('losing: a share of body weight a week at 7700 kcal/kg', () => {
    expect(goalKcal(2759, { goal: 'lose', rate: 0.5, kg: 80, sex: 'm' })).toEqual({ kcal: 2319, delta: -440, floored: false })
  })
  it('gaining is slower by default; maintaining changes nothing', () => {
    expect(goalKcal(2759, { goal: 'gain', kg: 80, sex: 'm' })).toEqual({ kcal: 2979, delta: 220, floored: false })
    expect(goalKcal(2759, { goal: 'maintain', kg: 80 })).toEqual({ kcal: 2759, delta: 0, floored: false })
  })
  it('an impossible rate is pulled into range rather than obeyed', () => {
    expect(goalKcal(2759, { goal: 'lose', rate: 5, kg: 80, sex: 'm' }).delta).toBe(-880)       // capped at 1 %
    expect(goalKcal(2759, { goal: 'lose', rate: 0.01, kg: 80, sex: 'm' }).delta).toBe(-220)    // at least 0.25 %
  })
  it('never sets a target below the floor, and says so', () => {
    expect(goalKcal(1500, { goal: 'lose', rate: 1, kg: 60, sex: 'f' })).toEqual({ kcal: FLOOR.f, delta: -300, floored: true })
    expect(goalKcal(1700, { goal: 'lose', rate: 1, kg: 90 }).kcal).toBe(FLOOR.m)            // sex unknown: the higher floor
  })
})

describe('macroTargets', () => {
  it('protein by body weight, a quarter of energy as fat, carbohydrate the rest', () => {
    expect(macroTargets(2319, { kg: 80, proteinPerKg: 1.8 })).toEqual({ p: 144, f: 64, c: 292 })
  })
  it('on little energy fat gives way before protein, and carbohydrate never goes negative', () => {
    expect(macroTargets(1200, { kg: 100, proteinPerKg: 2.4 })).toEqual({ p: 240, f: 50, c: 0 })
  })
  it('keeps protein inside the sensible range', () => {
    expect(macroTargets(2500, { kg: 80, proteinPerKg: 9 }).p).toBe(192)
    expect(macroTargets(2500, { kg: 80, proteinPerKg: 0.2 }).p).toBe(96)
  })
})

describe('personOf', () => {
  it('reads the latest weight in kilograms whatever the profile unit, and the latest body fat', () => {
    const S = profile({ unit: 'lb', bodyweight: [{ d: '2026-09-01', w: 190, t: 1 }, { d: '2026-09-30', w: 176.4, t: 2 }], measurements: [{ d: '2026-09-01', bodyFat: 22 }, { d: '2026-09-20', bodyFat: 20 }, { d: '2026-09-25', waist: 90 }] })
    expect(personOf(S, TODAY)).toEqual({ kg: 80, cm: 180, age: 30, sex: 'm', activity: 'moderate', bodyFat: 20 })
  })
  it('the figure the muscle map is drawn on is not the person: S.body is never read as sex', () => {
    const S = profile({ body: 'female', bodyProfile: { heightCm: 180, born: 1996 } })
    expect(personOf(S, TODAY).sex).toBe(null)
  })
  it('names what is still missing', () => {
    expect(missingFor(personOf({ unit: 'kg', bodyweight: [] }, TODAY))).toEqual(['weight', 'height', 'born'])
    expect(missingFor(personOf(profile({ bodyProfile: { heightCm: 180 } }), TODAY))).toEqual(['born'])
    expect(missingFor(personOf(profile(), TODAY))).toEqual([])
    // body fat stands in for height and age
    expect(missingFor(personOf(profile({ bodyProfile: null, measurements: [{ d: '2026-09-01', bodyFat: 20 }] }), TODAY))).toEqual([])
  })
  it('ignores an implausible body-fat reading', () => {
    expect(personOf(profile({ measurements: [{ d: '2026-09-01', bodyFat: 85 }] }), TODAY).bodyFat).toBe(null)
  })
})

describe('adaptiveTdee', () => {
  it('holding weight on 2400 a day means spending 2400', () => {
    const S = profile({ nutrition: diary(28, 2400), bodyweight: weighIns(28, 0) })
    expect(adaptiveTdee(S, { today: TODAY })).toMatchObject({ tdee: 2400, raw: 2400, conf: 'ok', reason: null, loggedDays: 28, weighIns: 14, kgPerWeek: 0 })
  })
  it('losing 0.35 kg a week on 2400 means spending about 2785', () => {
    const S = profile({ nutrition: diary(28, 2400), bodyweight: weighIns(28, -0.05) })
    const r = adaptiveTdee(S, { today: TODAY })
    expect(r.raw).toBe(2785)
    expect(r.kgPerWeek).toBe(-0.35)
  })
  it('is blended with the formula — more of the measurement the more there is to measure', () => {
    const full = profile({ nutrition: diary(28, 2400), bodyweight: weighIns(28, -0.05) })
    expect(adaptiveTdee(full, { today: TODAY, formulaTdee: 2500 }).tdee).toBe(Math.round(2500 * 0.2 + 2785 * 0.8))
    const thin = profile({ nutrition: diary(28, 2400, { skip: i => i % 2 === 0 }), bodyweight: weighIns(28, -0.05, 3) })
    const r = adaptiveTdee(thin, { today: TODAY, formulaTdee: 2500 })
    expect(r.conf).toBe('low')
    expect(r.tdee).toBe(Math.round(2500 * 0.5 + r.raw * 0.5))
  })
  it('stays within sight of the formula however odd the diary', () => {
    const S = profile({ nutrition: diary(28, 6000), bodyweight: weighIns(28, 0) })
    expect(adaptiveTdee(S, { today: TODAY, formulaTdee: 2500 }).raw).toBe(3750)
  })
  it('refuses on too few logged days, and half-logged days do not count', () => {
    expect(adaptiveTdee(profile({ nutrition: diary(MIN_LOGGED_DAYS - 1, 2400), bodyweight: weighIns(28, 0) }), { today: TODAY }))
      .toMatchObject({ tdee: null, conf: 'none', reason: 'few-days' })
    expect(adaptiveTdee(profile({ nutrition: diary(28, 500), bodyweight: weighIns(28, 0) }), { today: TODAY }).reason).toBe('few-days')
    // enough days, but all inside one week and a half
    expect(adaptiveTdee(profile({ nutrition: diary(11, 2400), bodyweight: weighIns(28, 0) }), { today: TODAY }).reason).toBe('few-days')
  })
  it('refuses on too few weigh-ins, or weigh-ins bunched at one end', () => {
    expect(adaptiveTdee(profile({ nutrition: diary(28, 2400), bodyweight: weighIns(28, 0, 6) }), { today: TODAY }).reason).toBe('few-weighins')
    expect(weighIns(10, 0, 1).length).toBeGreaterThanOrEqual(MIN_WEIGH_INS)
    expect(adaptiveTdee(profile({ nutrition: diary(28, 2400), bodyweight: weighIns(10, 0, 1) }), { today: TODAY }).reason).toBe('uneven')
  })
  it('today is never part of the window', () => {
    const S = profile({ nutrition: diary(28, 2400), bodyweight: weighIns(28, 0) })
    S.nutrition.log.push({ id: 'today', d: TODAY, m: 0, n: 'x', g: 0, k: 9000, p: 0, f: 0, c: 0, t: 1 })
    expect(adaptiveTdee(S, { today: TODAY }).raw).toBe(2400)
  })
  it('weightSlope is the least-squares line', () => {
    expect(weightSlope([{ x: 0, y: 80 }, { x: 10, y: 79 }])).toBeCloseTo(-0.1)
    expect(weightSlope([{ x: 0, y: 80 }])).toBe(null)
  })
})

describe('training', () => {
  const HOUR = 3600000
  const session = (d, minutes = 60) => ({ id: 'w' + d, d, start: 1000, end: 1000 + minutes * 60000, entries: [] })
  // Three sessions a week for four weeks, ending two days ago.
  const month = () => [2, 4, 6, 9, 11, 13, 16, 18, 20, 23, 25, 27].map(i => session(dayBefore(TODAY, i)))

  it('prices a session by its length and the body moving it', () => {
    expect(sessionKcal(session('2026-09-30', 60), 80)).toBe(240)
    expect(sessionKcal({ start: 0, end: 10 * HOUR, entries: [] }, 80)).toBe(720)       // capped at three hours
    expect(sessionKcal(session('2026-09-30'), 0)).toBe(0)
  })
  it('an imported workout with no clock is priced by its completed sets', () => {
    const w = { d: '2026-09-30', start: 5, end: 5, entries: [{ sets: Array.from({ length: 20 }, () => ({ done: true })) }, { sets: [{ done: false }] }] }
    expect(sessionKcal(w, 80)).toBe(200)
  })
  it('a training day gets its session minus the daily average, a rest day gives the average back', () => {
    const S = profile({ workouts: month() })
    expect(trainingShift(S, dayBefore(TODAY, 2), { kg: 80, base: 2500, today: TODAY })).toBe(137)
    expect(trainingShift(S, dayBefore(TODAY, 3), { kg: 80, base: 2500, today: TODAY })).toBe(-103)
  })
  it('over a normal week the shifts cancel', () => {
    const S = profile({ workouts: month() })
    const week = [2, 3, 4, 5, 6, 7, 8].reduce((a, i) => a + trainingShift(S, dayBefore(TODAY, i), { kg: 80, base: 2500, today: TODAY }), 0)
    expect(Math.abs(week)).toBeLessThanOrEqual(3)
  })
  it('is capped at 15 % of the target', () => {
    const S = profile({ workouts: month() })
    expect(trainingShift(S, dayBefore(TODAY, 2), { kg: 80, base: 600, today: TODAY })).toBe(90)
    expect(trainingShift(S, dayBefore(TODAY, 3), { kg: 80, base: 600, today: TODAY })).toBe(-90)
  })
  it('today, with a routine planned and nothing logged yet, counts as a typical session', () => {
    const wd = new Date(TODAY + 'T12:00:00').getDay()
    const S = profile({ workouts: month(), routines: [{ id: 'r1', name: 'A', ex: [] }], week: { [wd]: ['r1'] } })
    expect(trainingShift(S, TODAY, { kg: 80, base: 2500, today: TODAY })).toBe(137)
    expect(trainingShift({ ...S, dayPlan: { [TODAY]: 'rest' } }, TODAY, { kg: 80, base: 2500, today: TODAY })).toBe(-103)
  })
  it('with no recent sessions there is nothing to move', () => {
    expect(trainingShift(profile(), TODAY, { kg: 80, base: 2500, today: TODAY })).toBe(0)
  })
})

describe('baseTargets / targetsFor', () => {
  it('auto, no diary yet: the formula, the goal, the macros', () => {
    const S = profile({ nutrition: { ...emptyNutrition(), targets: { mode: 'auto', goal: 'lose', rate: 0.5, proteinPerKg: 1.8, cycle: false, t: 1 } } })
    expect(baseTargets(S, TODAY)).toMatchObject({ kcal: 2319, p: 144, f: 64, c: 292, tdee: 2759, bmr: 1780, basis: 'formula', conf: 'none', floored: false, missing: [] })
  })
  it('auto with a month of diary and weigh-ins: measured expenditure takes over', () => {
    const S = profile({ nutrition: diary(28, 2400), bodyweight: weighIns(28, 0) })
    const b = baseTargets(S, TODAY)
    expect(b.basis).toBe('adaptive')
    expect(b.tdee).toBe(Math.round(2759 * 0.2 + 2400 * 0.8))
  })
  it('auto without the facts: no number, and what to fill in', () => {
    expect(baseTargets({ unit: 'kg', bodyweight: [], nutrition: null }, TODAY)).toMatchObject({ kcal: null, missing: ['weight', 'height', 'born'] })
  })
  it('manual: exactly what was typed, body or no body', () => {
    const S = { unit: 'kg', bodyweight: [], nutrition: { ...emptyNutrition(), targets: { mode: 'manual', kcal: 2200, p: 160, f: 70, c: 230, t: 1 } } }
    expect(targetsFor(S, TODAY)).toMatchObject({ kcal: 2200, p: 160, f: 70, c: 230, basis: 'manual', shift: 0, missing: [] })
  })
  it('a training day moves energy into carbohydrate and leaves protein and fat alone', () => {
    const sessions = [2, 4, 6, 9, 11, 13, 16, 18, 20, 23, 25, 27].map(i => ({ id: 'w' + i, d: dayBefore(TODAY, i), start: 0, end: 3600000, entries: [] }))
    const S = profile({ workouts: sessions, nutrition: { ...emptyNutrition(), targets: { mode: 'auto', goal: 'maintain', cycle: true, t: 1 } } })
    const rest = targetsFor(S, dayBefore(TODAY, 3), TODAY), train = targetsFor(S, dayBefore(TODAY, 2), TODAY)
    expect(train.shift).toBe(137); expect(rest.shift).toBe(-103)
    expect(train.kcal - rest.kcal).toBe(240)
    expect(train.p).toBe(rest.p); expect(train.f).toBe(rest.f)
    expect(train.c - rest.c).toBe(60)
    const off = profile({ workouts: sessions, nutrition: { ...emptyNutrition(), targets: { mode: 'auto', cycle: false, t: 1 } } })
    expect(targetsFor(off, dayBefore(TODAY, 2), TODAY).shift).toBe(0)
  })
  it('settingsOf fills the defaults; the snapshot is what a reader without formulas gets', () => {
    expect(settingsOf({})).toMatchObject({ mode: 'auto', goal: 'maintain', proteinPerKg: 1.8, cycle: true })
    const S = profile({ nutrition: { ...emptyNutrition(), targets: { mode: 'auto', goal: 'lose', rate: 0.5, t: 7 } } })
    expect(snapshotTargets(S, TODAY, 99)).toEqual({ mode: 'auto', goal: 'lose', rate: 0.5, proteinPerKg: 1.8, cycle: true, t: 7, kcal: 2319, p: 144, f: 64, c: 292, tdee: 2759, basis: 'formula', conf: 'none', at: 99 })
    const manual = { unit: 'kg', bodyweight: [], nutrition: { ...emptyNutrition(), targets: { mode: 'manual', kcal: 2200, p: 160, f: 70, c: 230, t: 3 } } }
    expect(snapshotTargets(manual, TODAY, 99)).toMatchObject({ mode: 'manual', kcal: 2200, basis: 'manual', t: 3, at: 99 })
  })
})
