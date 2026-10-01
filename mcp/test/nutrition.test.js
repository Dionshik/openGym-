// get_nutrition and get_body: the food diary and the body profile, read-only, in the same
// shape discipline as the other tools — final numbers, explicit nulls, never a template.
import { describe, beforeAll, afterAll, beforeEach, test, expect, vi } from 'vitest'
import { buildDemoState } from '../../frontend/src/lib/demoSeed.js'
import { emptyNutrition, addEntry, entryFrom, quickEntry, rollUp, dayBefore } from '../../frontend/src/lib/nutrition.js'
import { _seedStateForTests } from '../src/state.js'
import { TOOLS } from '../src/tools.js'

const TODAY = '2026-07-27'
const byName = Object.fromEntries(TOOLS.map(t => [t.name, t.handler]))
const call = (name, params = {}) => byName[name](params)
const chicken = { n: 'Chicken breast', k: 165, p: 31, f: 3.6, c: 0 }

function seed(mut) {
  const S = buildDemoState()
  S.unit = 'kg'
  S.nutrition = emptyNutrition()
  mut?.(S)
  _seedStateForTests(S)
  return S
}

beforeAll(() => { vi.useFakeTimers({ now: new Date(TODAY + 'T12:00:00Z'), toFake: ['Date'] }) })
afterAll(() => { vi.useRealTimers() })
beforeEach(() => { seed() })

describe('the two tools are registered beside the others', () => {
  test('eleven tools, each with a name, a description and a handler', () => {
    expect(TOOLS.map(t => t.name)).toEqual(expect.arrayContaining(['get_nutrition', 'get_body', 'get_bodyweight', 'list_workouts']))
    expect(TOOLS).toHaveLength(11)
    for (const t of TOOLS) { expect(t.description.length).toBeGreaterThan(40); expect(typeof t.handler).toBe('function') }
  })
})

describe('get_nutrition', () => {
  test('an empty diary answers with nulls, not errors', () => {
    const r = call('get_nutrition')
    expect(r.range).toEqual({ from: dayBefore(TODAY, 14), to: TODAY, logged_days: 0 })
    expect(r.average).toBe(null)
    expect(r.days).toEqual([])
  })

  test('daily totals and their average over the range', () => {
    seed(S => {
      addEntry(S.nutrition, entryFrom(chicken, 200, { d: dayBefore(TODAY, 1), m: 1 }))
      addEntry(S.nutrition, quickEntry({ n: 'Lunch out', k: 700, p: 30, f: 30, c: 70 }, { d: dayBefore(TODAY, 1), m: 1 }))
      addEntry(S.nutrition, entryFrom(chicken, 100, { d: dayBefore(TODAY, 2), m: 2 }))
      addEntry(S.nutrition, entryFrom(chicken, 100, { d: dayBefore(TODAY, 40), m: 2 }))
    })
    const r = call('get_nutrition')
    expect(r.days).toEqual([
      { date: dayBefore(TODAY, 2), kcal: 165, protein_g: 31, fat_g: 4, carbs_g: 0, entries: 1 },
      { date: dayBefore(TODAY, 1), kcal: 1030, protein_g: 92, fat_g: 37, carbs_g: 70, entries: 2 }
    ])
    expect(r.average).toEqual({ kcal: 598, protein_g: 62, fat_g: 20, carbs_g: 35 })
    expect(call('get_nutrition', { from: dayBefore(TODAY, 60) }).range.logged_days).toBe(3)
  })

  test('`date` lists that day meal by meal, and only the meals that have something', () => {
    seed(S => {
      addEntry(S.nutrition, entryFrom(chicken, 150, { d: TODAY, m: 2 }))
      addEntry(S.nutrition, quickEntry({ n: 'Coffee', k: 40 }, { d: TODAY, m: 0 }))
    })
    const day = call('get_nutrition', { date: TODAY }).day
    expect(day.date).toBe(TODAY)
    expect(day.meals.map(m => m.meal)).toEqual(['breakfast', 'dinner'])
    expect(day.meals[1].entries[0]).toEqual({ name: 'Chicken breast', grams: 150, kcal: 248, protein_g: 46.5, fat_g: 5.4, carbs_g: 0 })
    expect(day.meals[0].entries[0].grams).toBe(null)             // logged as bare numbers
  })

  test('a folded day still counts in the totals, and has no entries to list', () => {
    const old = dayBefore(TODAY, 120)
    seed(S => {
      addEntry(S.nutrition, entryFrom(chicken, 200, { d: old, m: 1 }))
      rollUp(S.nutrition, TODAY)
    })
    const r = call('get_nutrition', { from: dayBefore(TODAY, 130), date: old })
    expect(r.days).toEqual([{ date: old, kcal: 330, protein_g: 62, fat_g: 7, carbs_g: 0, entries: 1 }])
    expect(r.day.meals).toEqual([])
  })

  test('the target is the one the app computes — manual as typed, automatic from the body', () => {
    seed(S => { S.nutrition.targets = { mode: 'manual', kcal: 2200, p: 160, f: 70, c: 230, t: 1 } })
    expect(call('get_nutrition').target).toEqual({ kcal: 2200, protein_g: 160, fat_g: 70, carbs_g: 230, basis: 'manual', estimated_expenditure_kcal: null })
    seed(S => { S.bodyProfile = { sex: 'm', born: 1996, heightCm: 180, activity: 'moderate' }; S.nutrition.targets = { mode: 'auto', goal: 'maintain', cycle: false, t: 1 } })
    const auto = call('get_nutrition').target
    expect(auto.basis).toBe('formula')
    expect(auto.kcal).toBe(auto.estimated_expenditure_kcal)
    seed()
    expect(call('get_nutrition').target).toBe(null)             // nothing to compute it from
  })
})

describe('get_body', () => {
  test('a profile that filled nothing in answers with nulls — and the muscle-map figure is not a sex', () => {
    seed(S => { S.body = 'female'; S.bodyProfile = null; S.measurements = [] })
    const r = call('get_body')
    expect(r.sex).toBe(null)
    expect(r.age).toBe(null)
    expect(r.height_cm).toBe(null)
    expect(r.measurements).toEqual({})
    expect(r.resting_expenditure_kcal).toBe(null)
    expect(r.weight_kg).toBeGreaterThan(0)                      // the demo profile has weigh-ins
  })

  test('the facts, the latest of each measurement, and what the formulas make of them', () => {
    seed(S => {
      S.bodyweight = [{ d: TODAY, w: 80, t: 1 }]
      S.bodyProfile = { sex: 'm', born: 1996, heightCm: 180, activity: 'moderate' }
      S.measurements = [{ d: dayBefore(TODAY, 30), waist: 92 }, { d: TODAY, waist: 89.5, upperArmLeft: 38 }]
    })
    expect(call('get_body')).toEqual({
      sex: 'male', age: 30, height_cm: 180, daily_activity: 'moderate', weight_kg: 80, body_fat_percent: null,
      measurements: { waist: { value: 89.5, date: TODAY }, upperArmLeft: { value: 38, date: TODAY } },
      resting_expenditure_kcal: 1780, resting_formula: 'mifflin', daily_expenditure_kcal: 2759
    })
  })

  test('body fat switches the formula', () => {
    seed(S => { S.bodyweight = [{ d: TODAY, w: 80, t: 1 }]; S.bodyProfile = null; S.measurements = [{ d: TODAY, bodyFat: 20 }] })
    const r = call('get_body')
    expect([r.body_fat_percent, r.resting_expenditure_kcal, r.resting_formula]).toEqual([20, 1752, 'katch'])
  })
})

describe('no synced state', () => {
  test('both tools say so instead of throwing', () => {
    _seedStateForTests(null)
    expect(call('get_nutrition')).toHaveProperty('error')
    expect(call('get_body')).toHaveProperty('error')
  })
})
