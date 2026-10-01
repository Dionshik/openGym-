/* What the app says and what the server does, held together.
 *
 * The api container shares no build step with the frontend, so a few things about the food
 * diary and the body profile exist on both sides: the list of optional Coach categories and
 * the words the Body screen uses for them, the day totals the Coach's nutrition summary is
 * built from, and the validators' idea of what a food can be. This runs under vitest, which can
 * load both runtimes, and compares behaviour.
 */
import { describe, it, expect } from 'vitest'
import { OPTIONAL_CATEGORIES, DATA_CATEGORIES } from '../../../api/coach/core/categories.js'
import { nutritionSection, bodySection } from '../../../api/coach/core/extras.js'
import { cleanPer100, validateMeal, MEAL_SLOTS, FOOD_KINDS } from '../../../api/coach/core/food.js'
import { PROMPTS } from '../../../api/coach/core/prompts.js'
import { OPTIONAL_TEXT, CATEGORY_TEXT, sharedExtras } from './coach.js'
import { MEALS, emptyNutrition, addEntry, entryFrom, loggedDays, dayBefore, sanitizeFood } from './nutrition.js'
import { snapshotTargets, personOf } from './nutrition-targets.js'
import { MEASURE_KEYS } from './body.js'
import { demoFood } from './coach-demo.js'
import { FOOD_ERRORS } from './food-ai.js'
import { todayISO } from './format.js'

describe('the optional Coach categories', () => {
  it('the Body screen has a switch, in words, for exactly the categories the server knows', () => {
    expect(Object.keys(OPTIONAL_TEXT)).toEqual([...OPTIONAL_CATEGORIES])
    expect(Object.keys(CATEGORY_TEXT)).toEqual([...DATA_CATEGORIES])
    for (const [title, sub] of Object.values(OPTIONAL_TEXT)) { expect(title).toBeTruthy(); expect(sub).toBeTruthy() }
  })
  it('the app and the server agree on which ones a profile switched on', () => {
    const S = { coach: { consent: { agreedAt: 'x', version: 1, extra: { nutrition: 'x' } } } }
    expect(sharedExtras(S)).toEqual(['nutrition'])
    expect(sharedExtras({ coach: { consent: { extra: { nutrition: 'x' } } } })).toEqual([])
  })
})

describe('what the Coach is told about eating is what the diary shows', () => {
  const today = todayISO()
  it('the server averages the same day totals the app computes, from the snapshot the app wrote', () => {
    const nut = emptyNutrition()
    const food = { n: 'x', k: 200, p: 20, f: 5, c: 18 }
    for (const i of [1, 2, 3, 4]) for (const m of [0, 1, 2]) addEntry(nut, entryFrom(food, 300 + i * 50, { d: dayBefore(today, i), m }))
    const S = { unit: 'kg', bodyweight: [{ d: today, w: 80, t: 1 }], bodyProfile: { sex: 'm', born: +today.slice(0, 4) - 30, heightCm: 180, activity: 'moderate' }, measurements: [], workouts: [], nutrition: nut }
    S.nutrition.targets = snapshotTargets({ ...S, nutrition: { ...nut, targets: { mode: 'auto', goal: 'lose', rate: 0.5, cycle: false, t: 1 } } }, today)
    const days = loggedDays(nut)
    const mean = key => Math.round(days.reduce((a, d) => a + d[key], 0) / days.length)
    const section = nutritionSection(S, today)
    expect(section.intake).toMatchObject({ loggedDays: 4, kcal: mean('k'), proteinG: mean('p'), fatG: mean('f'), carbsG: mean('c') })
    expect(section.target).toMatchObject({ kcal: S.nutrition.targets.kcal, proteinG: S.nutrition.targets.p, goal: 'lose' })
    expect(section.expenditure.kcal).toBe(S.nutrition.targets.tdee)
  })
  it('the server reads the person the way the formulas do — and neither reads the diagram', () => {
    const today2 = todayISO()
    const S = { unit: 'kg', body: 'female', bodyweight: [], bodyProfile: { sex: 'm', born: 1990, heightCm: 180, activity: 'active' }, measurements: [{ d: today2, bodyFat: 18, waist: 88 }] }
    expect(bodySection(S, today2).sex).toBe('male')
    expect(personOf(S, today2).sex).toBe('m')
    expect(bodySection(S, today2).bodyFatPercent).toBe(personOf(S, today2).bodyFat)
  })
  it('the measurements the server summarises are ones the app can record', () => {
    const S = { bodyProfile: {}, measurements: [Object.fromEntries([['d', todayISO()], ...MEASURE_KEYS.map(k => [k, 50])])] }
    for (const key of Object.keys(bodySection(S, todayISO()).measurements)) expect(MEASURE_KEYS).toContain(key)
  })
})

describe('what a food can be', () => {
  it('the app’s product form and the server’s validators clamp alike', () => {
    for (const raw of [{ k: 165, p: 31, f: 3.6, c: 0 }, { k: 4000, p: 0, f: 100, c: 0 }, { k: 300, p: 60, f: 60, c: 80 }]) {
      const app = sanitizeFood({ n: 'x', ...raw })
      const srv = cleanPer100({ kcal: raw.k, p: raw.p, f: raw.f, c: raw.c })
      expect(Math.abs(app.p - srv.p)).toBeLessThanOrEqual(0.1)
      expect(Math.abs(app.f - srv.f)).toBeLessThanOrEqual(0.1)
      expect(app.k).toBeLessThanOrEqual(900)
      expect(srv.k).toBeLessThanOrEqual(900)
    }
  })
  it('the meal slots have the same names on both sides', () => {
    expect([...MEAL_SLOTS]).toEqual(MEALS)
  })
})

describe('the demo stands in for the provider honestly', () => {
  it('its canned answers pass the validators a real answer has to pass', async () => {
    const meal = await demoFood({ kind: 'meal', lang: 'ru' })
    // The demo returns the validated shape; fed back in the provider's shape it must validate.
    const asProvider = { items: meal.items.map(i => ({ name: i.name, en: i.en, grams: i.grams, kcal100: i.per100.k, p100: i.per100.p, f100: i.per100.f, c100: i.per100.c, conf: i.conf })) }
    const checked = validateMeal(asProvider)
    expect(checked.ok).toBe(true)
    expect(checked.items.map(i => i.per100)).toEqual(meal.items.map(i => i.per100))
    expect((await demoFood({ kind: 'label', lang: 'en' })).food).toMatchObject({ k: 121, p: 17.2 })
    expect((await demoFood({ kind: 'suggest' })).ideas).toEqual([])
  }, 10000)
  it('every food task has a prompt, and every failure the server names has a sentence', () => {
    for (const kind of FOOD_KINDS) expect(PROMPTS[kind]).toBeTruthy()
    for (const code of ['kind', 'empty', 'noimage', 'badimage', 'toolarge', 'novision', 'busy', 'cap', 'consent', 'off']) {
      if (code !== 'kind') expect(FOOD_ERRORS[code], code).toBeTruthy()
    }
  })
})
