import { describe, it, expect } from 'vitest'
import {
  emptyNutrition, nutritionOf, ensureNutrition, atwater, sanitizeFood, scale, per100Of, entryFrom, quickEntry,
  addEntry, editEntry, removeEntry, dayTotals, byMeal, remaining, loggedDays, recentFoods, frequentFoods,
  saveFood, archiveFood, myFoods, rollUp, mergeNutrition, nutritionExtras, dayBefore, ROLL_DAYS, TOMB_DAYS
} from './nutrition.js'

const DAY = 86400000
const buckwheat = { n: 'Гречка варёная', k: 110, p: 4.2, f: 1.1, c: 21.3 }
const chicken = { n: 'Куриная грудка', k: 165, p: 31, f: 3.6, c: 0 }
const row = (id, d, over = {}) => ({ id, d, m: 1, n: 'x', g: 100, k: 100, p: 10, f: 2, c: 8, t: 1000, ...over })

describe('nutritionOf / ensureNutrition', () => {
  it('a profile from before the diary reads as an empty one, and S is not touched', () => {
    const S = { unit: 'kg' }
    expect(nutritionOf(S)).toEqual(emptyNutrition())
    expect('nutrition' in S).toBe(false)
    expect(nutritionOf(null)).toEqual(emptyNutrition())
  })
  it('repairs a diary that lost a field, and creates one inside an update', () => {
    expect(nutritionOf({ nutrition: { log: [row('a', '2026-10-01')] } })).toMatchObject({ days: {}, foods: [], del: {}, rolledTo: null })
    const S = {}
    ensureNutrition(S).log.push(row('a', '2026-10-01'))
    expect(S.nutrition.log).toHaveLength(1)
  })
})

describe('numbers', () => {
  it('scales per-100 g values to the weight eaten', () => {
    expect(scale(buckwheat, 250)).toEqual({ k: 275, p: 10.5, f: 2.8, c: 53.3 })
    expect(scale(chicken, 0)).toEqual({ k: 0, p: 0, f: 0, c: 0 })
    expect(scale(chicken, '150')).toEqual({ k: 248, p: 46.5, f: 5.4, c: 0 })
  })
  it('reads the per-100 g values back off a logged row', () => {
    const e = entryFrom(chicken, 150, { d: '2026-10-01' })
    expect(per100Of(e)).toEqual({ k: 165, p: 31, f: 3.6, c: 0 })
    expect(per100Of(quickEntry({ n: 'lunch out', k: 700 }, { d: '2026-10-01' }))).toBe(null)
  })
  it('atwater counts 4 / 4 / 9', () => {
    expect(atwater({ p: 10, f: 10, c: 10 })).toBe(170)
    expect(atwater({})).toBe(0)
  })
})

describe('sanitizeFood', () => {
  it('keeps a sane product as typed, comma decimals included', () => {
    expect(sanitizeFood({ n: '  Творог  5% ', k: '121', p: '17,2', f: 5, c: '1,8', sv: 180, brand: 'Простоквашино', code: '4607025392408' }))
      .toEqual({ n: 'Творог 5%', k: 121, p: 17.2, f: 5, c: 1.8, sv: 180, brand: 'Простоквашино', code: '4607025392408' })
  })
  it('refuses what cannot be food: more than 900 kcal, more than 100 g of macros in 100 g', () => {
    expect(sanitizeFood({ n: 'oil', k: 2500, p: 0, f: 100, c: 0 }).k).toBe(900)
    const over = sanitizeFood({ n: 'label per pack', k: 400, p: 60, f: 60, c: 80 })
    expect(over.p + over.f + over.c).toBeCloseTo(100, 0)
  })
  it('fills in the energy from the macros when none was given, and needs a name', () => {
    expect(sanitizeFood({ n: 'x', p: 10, f: 10, c: 10 }).k).toBe(170)
    expect(sanitizeFood({ n: 'x', k: 0, p: 10, f: 10, c: 10 }).k).toBe(0)     // a typed zero is a zero
    expect(sanitizeFood({ n: '   ', k: 100 })).toBe(null)
    expect(sanitizeFood(null)).toBe(null)
  })
})

describe('rows', () => {
  it('a weighed row carries its own numbers and where it came from', () => {
    const e = entryFrom(buckwheat, 250, { d: '2026-10-01', m: 1, ref: 'g:u170286', now: 5, id: 'e1' })
    expect(e).toEqual({ id: 'e1', d: '2026-10-01', m: 1, n: 'Гречка варёная', g: 250, k: 275, p: 10.5, f: 2.8, c: 53.3, t: 5, r: 'g:u170286' })
  })
  it('a quick row has no weight; energy falls back to the macros', () => {
    expect(quickEntry({ n: 'Обед в кафе', k: 700 }, { d: '2026-10-01', m: 1, now: 5, id: 'q' }))
      .toEqual({ id: 'q', d: '2026-10-01', m: 1, n: 'Обед в кафе', g: 0, k: 700, p: 0, f: 0, c: 0, t: 5 })
    expect(quickEntry({ n: 'shake', p: 30, c: 5 }, { d: '2026-10-01' }).k).toBe(140)
  })
  it('an unknown meal lands in snacks rather than nowhere', () => {
    expect(entryFrom(chicken, 100, { d: '2026-10-01', m: 9 }).m).toBe(3)
  })
  it('changing the weight rescales; changing the numbers takes them as given', () => {
    const nut = emptyNutrition()
    addEntry(nut, entryFrom(chicken, 100, { d: '2026-10-01', id: 'e1', now: 1 }))
    editEntry(nut, 'e1', { g: 200 }, 9)
    expect(nut.log[0]).toMatchObject({ g: 200, k: 330, p: 62, f: 7.2, t: 9 })
    editEntry(nut, 'e1', { k: 300, m: 2 }, 10)
    expect(nut.log[0]).toMatchObject({ g: 200, k: 300, m: 2, t: 10 })
    expect(editEntry(nut, 'nope', { g: 1 })).toBe(null)
  })
  it('a deleted row leaves a tombstone; deleting nothing leaves none', () => {
    const nut = emptyNutrition()
    addEntry(nut, row('a', '2026-10-01'))
    expect(removeEntry(nut, 'a', 77)).toBe(true)
    expect(nut.log).toEqual([])
    expect(nut.del).toEqual({ a: 77 })
    expect(removeEntry(nut, 'ghost', 78)).toBe(false)
    expect(nut.del).toEqual({ a: 77 })
  })
})

describe('reading a day', () => {
  const nut = emptyNutrition()
  addEntry(nut, row('a', '2026-10-01', { m: 0, t: 2, k: 300, p: 20, f: 10, c: 30 }))
  addEntry(nut, row('b', '2026-10-01', { m: 0, t: 1, k: 100, p: 5.5, f: 1.2, c: 12.1 }))
  addEntry(nut, row('c', '2026-10-01', { m: 2, k: 500, p: 40, f: 15, c: 50 }))
  addEntry(nut, row('d', '2026-10-02', { k: 999 }))

  it('totals only that day', () => {
    expect(dayTotals(nut, '2026-10-01')).toEqual({ k: 900, p: 65.5, f: 26.2, c: 92.1, n: 3 })
    expect(dayTotals(nut, '2026-09-30')).toEqual({ k: 0, p: 0, f: 0, c: 0, n: 0 })
  })
  it('groups by meal in the order logged', () => {
    const meals = byMeal(nut, '2026-10-01')
    expect(meals.map(m => m.map(e => e.id))).toEqual([['b', 'a'], [], ['c'], []])
  })
  it('remaining is target minus eaten, and goes negative over the target', () => {
    expect(remaining({ kcal: 2000, p: 150, f: 70, c: 200 }, dayTotals(nut, '2026-10-01'))).toEqual({ k: 1100, p: 84.5, f: 43.8, c: 107.9 })
    expect(remaining({ kcal: 500, p: 10, f: 10, c: 10 }, dayTotals(nut, '2026-10-01')).k).toBe(-400)
    expect(remaining(null, dayTotals(nut, '2026-10-01'))).toBe(null)
  })
  it('lists the days that have anything, oldest first', () => {
    expect(loggedDays(nut).map(x => [x.d, x.k])).toEqual([['2026-10-01', 900], ['2026-10-02', 999]])
  })
})

describe('recent and frequent', () => {
  const nut = emptyNutrition()
  addEntry(nut, entryFrom(chicken, 150, { d: '2026-09-28', ref: 'g:chicken', now: 1, id: '1' }))
  addEntry(nut, entryFrom(chicken, 200, { d: '2026-09-29', ref: 'g:chicken', now: 5, id: '2' }))
  addEntry(nut, entryFrom(buckwheat, 250, { d: '2026-09-29', now: 4, id: '3' }))
  addEntry(nut, quickEntry({ n: 'Обед в кафе', k: 700 }, { d: '2026-09-30', now: 9, id: '4' }))

  it('recent: newest first, one per product, with the weight used last time', () => {
    const r = recentFoods(nut)
    expect(r.map(x => x.n)).toEqual(['Обед в кафе', 'Куриная грудка', 'Гречка варёная'])
    expect(r[1]).toMatchObject({ g: 200, per100: { k: 165, p: 31, f: 3.6, c: 0 }, r: 'g:chicken' })
    expect(r[0]).toMatchObject({ per100: null, fixed: { k: 700, p: 0, f: 0, c: 0 } })
    expect(recentFoods(nut, 1)).toHaveLength(1)
  })
  it('frequent: most logged first', () => {
    const f = frequentFoods(nut)
    expect(f[0]).toMatchObject({ n: 'Куриная грудка', count: 2, g: 200 })
  })
})

describe('my products', () => {
  it('saves, overwrites by id, archives', () => {
    const nut = emptyNutrition()
    const a = saveFood(nut, { n: 'Мой протеин', k: 380, p: 78, f: 4, c: 6 }, { now: 1, id: 'f1' })
    expect(a).toMatchObject({ id: 'f1', src: 'own', t: 1 })
    saveFood(nut, { id: 'f1', n: 'Мой протеин', k: 390, p: 80, f: 4, c: 6 }, { now: 2 })
    expect(nut.foods).toHaveLength(1)
    expect(nut.foods[0].k).toBe(390)
    expect(saveFood(nut, { n: '' })).toBe(null)
    expect(archiveFood(nut, 'f1', 3)).toBe(true)
    expect(myFoods(nut)).toEqual([])
    expect(nut.foods[0]).toMatchObject({ x: true, t: 3 })
    expect(archiveFood(nut, 'none')).toBe(false)
  })
})

describe('rollUp', () => {
  const today = '2026-10-01'
  const old = dayBefore(today, ROLL_DAYS + 5)
  const edge = dayBefore(today, ROLL_DAYS)

  it('folds days older than the window into totals and keeps the rest as rows', () => {
    const nut = emptyNutrition()
    addEntry(nut, row('a', old, { k: 300 })); addEntry(nut, row('b', old, { k: 200 })); addEntry(nut, row('c', edge)); addEntry(nut, row('d', today))
    rollUp(nut, today)
    expect(nut.log.map(e => e.id)).toEqual(['c', 'd'])
    expect(nut.days[old]).toEqual({ k: 500, p: 20, f: 4, c: 16, n: 2 })
    expect(nut.rolledTo).toBe(edge)
    expect(dayTotals(nut, old).k).toBe(500)
  })
  it('folding twice changes nothing, and a late row for a folded day joins its total', () => {
    const nut = emptyNutrition()
    addEntry(nut, row('a', old, { k: 300 }))
    rollUp(nut, today); rollUp(nut, today)
    expect(nut.days[old].k).toBe(300)
    addEntry(nut, row('late', old, { k: 50 }))
    expect(nut.log).toEqual([])
    expect(nut.days[old]).toMatchObject({ k: 350, n: 2 })
  })
  it('forgets tombstones nobody can still need', () => {
    const now = Date.now()
    const nut = { ...emptyNutrition(), del: { fresh: now - DAY, stale: now - (TOMB_DAYS + 1) * DAY } }
    rollUp(nut, today, { now })
    expect(Object.keys(nut.del)).toEqual(['fresh'])
  })
  it('a tighter window (the quota emergency) folds more', () => {
    const nut = emptyNutrition()
    addEntry(nut, row('a', dayBefore(today, 30))); addEntry(nut, row('b', today))
    rollUp(nut, today, { keep: 14 })
    expect(nut.log.map(e => e.id)).toEqual(['b'])
  })
})

describe('mergeNutrition', () => {
  it('keeps both devices rows; the later edit of a shared row wins', () => {
    const a = { ...emptyNutrition(), log: [row('x', '2026-10-01', { k: 100, t: 1 }), row('a', '2026-10-01')] }
    const b = { ...emptyNutrition(), log: [row('x', '2026-10-01', { k: 150, t: 2 }), row('b', '2026-10-01')] }
    const m = mergeNutrition(a, b)
    expect(m.log.map(e => e.id).sort()).toEqual(['a', 'b', 'x'])
    expect(m.log.find(e => e.id === 'x').k).toBe(150)
  })
  it('a row deleted on one device stays deleted — unless it was edited afterwards', () => {
    const a = { ...emptyNutrition(), log: [], del: { x: 50, y: 50 } }
    const b = { ...emptyNutrition(), log: [row('x', '2026-10-01', { t: 10 }), row('y', '2026-10-01', { t: 60 })] }
    const m = mergeNutrition(a, b)
    expect(m.log.map(e => e.id)).toEqual(['y'])
    expect(m.del).toEqual({ x: 50, y: 50 })
    expect(mergeNutrition(b, a).log.map(e => e.id)).toEqual(['y'])      // either way round
  })
  it('a stale device does not hand back the rows the other one folded, nor count them twice', () => {
    const fresh = { ...emptyNutrition(), rolledTo: '2026-07-01', days: { '2026-06-20': { k: 500, p: 20, f: 4, c: 16, n: 2 } }, log: [row('n', '2026-09-30')] }
    const stale = { ...emptyNutrition(), log: [row('a', '2026-06-20', { k: 300 }), row('b', '2026-06-20', { k: 200 }), row('s', '2026-09-29')] }
    const m = mergeNutrition(fresh, stale)
    expect(m.log.map(e => e.id).sort()).toEqual(['n', 's'])
    expect(m.rolledTo).toBe('2026-07-01')
    expect(m.days['2026-06-20'].k).toBe(500)
    expect(dayTotals(m, '2026-06-20').k).toBe(500)
  })
  it('a day only the stale device knew survives the fold as a total', () => {
    const fresh = { ...emptyNutrition(), rolledTo: '2026-07-01' }
    const stale = { ...emptyNutrition(), log: [row('a', '2026-06-10', { k: 420 })] }
    const m = mergeNutrition(fresh, stale)
    expect(m.log).toEqual([])
    expect(m.days['2026-06-10']).toMatchObject({ k: 420, n: 1 })
  })
  it('products merge by id with the later edit; an archived one stays archived', () => {
    const a = { ...emptyNutrition(), foods: [{ id: 'f', n: 'old', k: 1, p: 0, f: 0, c: 0, t: 1 }, { id: 'g', n: 'g', k: 1, p: 0, f: 0, c: 0, t: 1 }] }
    const b = { ...emptyNutrition(), foods: [{ id: 'f', n: 'old', k: 1, p: 0, f: 0, c: 0, t: 5, x: true }] }
    const m = mergeNutrition(a, b)
    expect(m.foods.find(x => x.id === 'f').x).toBe(true)
    expect(myFoods(m).map(x => x.id)).toEqual(['g'])
  })
  it('targets: whichever was set last', () => {
    const a = { ...emptyNutrition(), targets: { mode: 'manual', kcal: 2000, t: 5 } }
    const b = { ...emptyNutrition(), targets: { mode: 'manual', kcal: 2400, t: 9 } }
    expect(mergeNutrition(a, b).targets.kcal).toBe(2400)
    expect(mergeNutrition(b, a).targets.kcal).toBe(2400)
    expect(mergeNutrition(a, emptyNutrition()).targets.kcal).toBe(2000)
  })
  it('one side without a diary is the other side; neither is nothing', () => {
    const a = { ...emptyNutrition(), log: [row('a', '2026-10-01')] }
    expect(mergeNutrition(a, undefined).log).toHaveLength(1)
    expect(mergeNutrition(null, a).log).toHaveLength(1)
    expect(mergeNutrition(null, undefined)).toBe(null)
  })
})

describe('nutritionExtras', () => {
  it('counts the rows the server copy lacks', () => {
    const local = { ...emptyNutrition(), log: [row('a', '2026-10-01'), row('b', '2026-10-01')] }
    const server = { ...emptyNutrition(), log: [row('a', '2026-10-01')] }
    expect(nutritionExtras(local, server)).toBe(1)
    expect(nutritionExtras(null, server)).toBe(0)
    expect(nutritionExtras(local, null)).toBe(2)
  })
})
