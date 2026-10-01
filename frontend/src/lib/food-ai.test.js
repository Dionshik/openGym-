import { describe, it, expect } from 'vitest'
import { hasFoodConsent, foodAiState, draftFromMeal, suggestContext, ideasFromAi, FOOD_ERRORS, FOOD_CONSENT_VERSION } from './food-ai.js'
import { fitSize } from './image-prep.js'
import { FOODS } from './foods-data.js'

describe('availability and consent', () => {
  it('needs a server that says it has the feature, and a signed-in user', () => {
    const config = { coach: { enabled: true, food: true, vision: true } }
    expect(foodAiState({ config, user: { id: 'u' } })).toEqual({ available: true, vision: true })
    expect(foodAiState({ config, user: null })).toEqual({ available: false, vision: false })
    expect(foodAiState({ config: { coach: { enabled: true } }, user: { id: 'u' } }).available).toBe(false)   // an older server
    expect(foodAiState({ config: null, user: { id: 'u' } }).available).toBe(false)
  })
  it('a provider that cannot be sent pictures still reads a description', () => {
    expect(foodAiState({ config: { coach: { enabled: true, food: true, vision: false } }, user: { id: 'u' } })).toEqual({ available: true, vision: false })
  })
  it('the demo and a phone with its own key have it without a server', () => {
    expect(foodAiState({ demo: true })).toEqual({ available: true, vision: true })
    expect(foodAiState({ mobile: true, coachMode: 'byok' })).toEqual({ available: true, vision: true })
    expect(foodAiState({ mobile: true, coachMode: 'off' }).available).toBe(false)
  })
  it('the food go-ahead is its own: the Coach consent is not it, nor is an older version', () => {
    expect(hasFoodConsent({ coach: { foodConsent: { agreedAt: 'x', version: FOOD_CONSENT_VERSION } } })).toBe(true)
    expect(hasFoodConsent({ coach: { consent: { agreedAt: 'x', version: 1 }, lookupConsent: { agreedAt: 'x', version: 1 } } })).toBe(false)
    expect(hasFoodConsent({ coach: { foodConsent: { agreedAt: 'x', version: 0 } } })).toBe(false)
    expect(hasFoodConsent({})).toBe(false)
  })
})

describe('draftFromMeal', () => {
  const item = (name, en, per100, grams = 200, conf = 'medium') => ({ name, en, grams, per100, conf })

  it('a food the table has is priced by the table, and remembers which row it was', () => {
    const [row] = draftFromMeal([item('Гречка', 'buckwheat, cooked', { k: 110, p: 4, f: 1, c: 21 })], { generic: FOODS, lang: 'ru' })
    expect(row).toMatchObject({ n: 'Гречка', g: 200, src: 'table', ref: 'g:u170686', per100: { k: 92, p: 3.4, f: 0.6, c: 19.9 }, fixed: false })
  })
  it('a food the table does not have keeps the numbers the model gave', () => {
    const [row] = draftFromMeal([item('Фо бо', 'pho bo', { k: 60, p: 4, f: 2, c: 7 }, 400, 'low')], { generic: FOODS, lang: 'ru' })
    expect(row).toMatchObject({ src: 'ai', ref: null, conf: 'low', per100: { k: 60, p: 4, f: 2, c: 7 } })
  })
  it('a match that disagrees wildly with the model is the wrong food: the model numbers stand', () => {
    // "rice white dry" is in the table at 365 kcal; the model said 130 for what is on the plate
    const [row] = draftFromMeal([item('Рис', 'white rice, dry', { k: 130, p: 2.7, f: 0.3, c: 28 })], { generic: FOODS, lang: 'ru' })
    expect(row.src).toBe('ai')
    expect(row.per100.k).toBe(130)
  })
  it('half the words is a neighbour, not the food', () => {
    const [row] = draftFromMeal([item('Курица в кисло-сладком соусе', 'chicken sweet sour sauce', { k: 180, p: 12, f: 8, c: 15 })], { generic: FOODS, lang: 'ru' })
    expect(row.src).toBe('ai')
  })
  it('carries the corrected flag for numbers of the model, and survives junk', () => {
    expect(draftFromMeal([item('X', 'xyzzy', { k: 99, p: 3, f: 1, c: 20, fixed: true })], { generic: FOODS })[0].fixed).toBe(true)
    expect(draftFromMeal(null)).toEqual([])
    expect(draftFromMeal([item('X', 'buckwheat, cooked', { k: 92, p: 3, f: 1, c: 20 })], {})[0].src).toBe('ai')   // no table loaded
  })
})

describe('suggest', () => {
  const foods = [
    { n: 'Куриная грудка', ref: 'g:u171477', per100: { k: 165, p: 31, f: 3.6, c: 0 } },
    { n: 'Быстрый перекус', per100: null },
    { n: 'Гречка', ref: 'o:f1', per100: { k: 92, p: 3.4, f: 0.6, c: 19.9 } }
  ]
  it('the context names foods by a short id and carries only numbers and names', () => {
    const { context, byId } = suggestContext({ remaining: { k: 700, p: 50, f: 20, c: 80 }, target: { kcal: 2400, p: 150, f: 70, c: 290, tdee: 2600, basis: 'formula' }, meal: 'dinner', foods, wish: 'x'.repeat(500) })
    expect(context.foods).toEqual([
      { id: 'f0', name: 'Куриная грудка', kcal100: 165, p100: 31, f100: 3.6, c100: 0 },
      { id: 'f1', name: 'Гречка', kcal100: 92, p100: 3.4, f100: 0.6, c100: 19.9 }
    ])
    expect(context.remaining).toEqual({ kcal: 700, p: 50, f: 20, c: 80 })
    expect(context.target).toEqual({ kcal: 2400, p: 150, f: 70, c: 290 })
    expect(context.wish).toHaveLength(200)
    expect(byId.get('f1').ref).toBe('o:f1')
  })
  it('an idea is priced with the user numbers for their own foods, the model numbers for the rest', () => {
    const { byId } = suggestContext({ remaining: { k: 700, p: 50, f: 20, c: 80 }, target: { kcal: 2400, p: 150, f: 70, c: 290 }, meal: 'dinner', foods })
    const [idea] = ideasFromAi([{ title: 'Ужин', why: 'ok', items: [
      { id: 'f0', name: 'anything the model wrote', grams: 150, per100: { k: 999, p: 0, f: 0, c: 0 } },
      { name: 'Помидор', grams: 100, per100: { k: 18, p: 0.9, f: 0.2, c: 3.9 } }
    ] }], byId)
    expect(idea.items[0]).toMatchObject({ n: 'Куриная грудка', g: 150, k: 248, p: 46.5, ref: 'g:u171477' })
    expect(idea.items[1]).toMatchObject({ n: 'Помидор', k: 18, ref: null })
    expect(idea.k).toBe(266)
    expect(idea.title).toBe('Ужин')
  })
  it('an idea with nothing usable in it is dropped', () => {
    expect(ideasFromAi([{ title: 'x', items: [{ name: 'Вода', grams: 200, per100: { k: 0, p: 0, f: 0, c: 0 } }] }], new Map())).toEqual([])
    expect(ideasFromAi(undefined, new Map())).toEqual([])
  })
})

describe('the rest', () => {
  it('every failure class the server can answer has a sentence', () => {
    for (const code of ['off', 'consent', 'busy', 'cap', 'empty', 'noimage', 'badimage', 'toolarge', 'novision', 'timeout', 'auth', 'missing', 'provider', 'unusable', 'restart', 'cancelled', 'network', 'shared', 'unprivileged', 'internal']) {
      expect(FOOD_ERRORS[code], code).toBeTruthy()
    }
  })
  it('fitSize brings the long edge down to the limit and never scales up', () => {
    expect(fitSize(4032, 3024)).toEqual({ w: 1024, h: 768 })
    expect(fitSize(3024, 4032)).toEqual({ w: 768, h: 1024 })
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 })
    expect(fitSize(5000, 10, 1000)).toEqual({ w: 1000, h: 2 })
    expect(fitSize(0, 100)).toEqual({ w: 0, h: 0 })
  })
})
