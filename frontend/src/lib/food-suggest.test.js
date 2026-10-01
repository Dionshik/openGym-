import { describe, it, expect } from 'vitest'
import { kindOf, mealBudget, suggestFromOwn } from './food-suggest.js'

const chicken = { n: 'Куриная грудка', ref: 'g:u171477', per100: { k: 165, p: 31, f: 3.6, c: 0 } }
const buckwheat = { n: 'Гречка варёная', ref: 'g:u170686', per100: { k: 92, p: 3.4, f: 0.6, c: 19.9 } }
const rice = { n: 'Рис варёный', per100: { k: 130, p: 2.7, f: 0.3, c: 28 } }
const tvorog = { n: 'Творог 5 %', per100: { k: 121, p: 17.2, f: 5, c: 1.8 } }
const oil = { n: 'Масло оливковое', per100: { k: 884, p: 0, f: 100, c: 0 } }
const pelmeni = { n: 'Пельмени', per100: { k: 250, p: 11.5, f: 12, c: 24 } }
const target = { kcal: 2400, p: 150, f: 70, c: 290 }

describe('kindOf', () => {
  it('sorts foods by where their energy comes from', () => {
    expect(kindOf(chicken.per100)).toBe('protein')
    expect(kindOf(tvorog.per100)).toBe('protein')
    expect(kindOf(buckwheat.per100)).toBe('carb')
    expect(kindOf(oil.per100)).toBe('fat')
    expect(kindOf(pelmeni.per100)).toBe('mixed')
  })
})

describe('mealBudget', () => {
  it('one meal is at most about a third of the day, scaled across the macros', () => {
    expect(mealBudget({ k: 1680, p: 100, f: 50, c: 200 }, target)).toEqual({ k: 840, p: 50, f: 25, c: 100 })
  })
  it('a small remainder is taken whole; an overshot macro counts as nothing left', () => {
    expect(mealBudget({ k: 400, p: 30, f: -5, c: 40 }, target)).toEqual({ k: 400, p: 30, f: 0, c: 40 })
  })
})

describe('suggestFromOwn', () => {
  const remaining = { k: 700, p: 50, f: 20, c: 80 }

  it('pairs a protein source with a carbohydrate source and sizes both to the meal', () => {
    const [best] = suggestFromOwn({ k: 600, p: 45, f: 20, c: 80 }, [chicken, rice], { target })
    expect(best.items.map(x => x.n).sort()).toEqual(['Куриная грудка', 'Рис варёный'])
    expect(Math.abs(best.k - 600)).toBeLessThan(40)
    expect(Math.abs(best.p - 45)).toBeLessThan(6)
    for (const it of best.items) { expect(it.g % 10).toBe(0); expect(it.g).toBeGreaterThanOrEqual(30); expect(it.g).toBeLessThanOrEqual(300) }
  })
  it('would rather fall short than serve 600 g of buckwheat', () => {
    const [best] = suggestFromOwn(remaining, [chicken, buckwheat], { target })
    expect(best.items.find(x => x.n === 'Гречка варёная').g).toBeLessThanOrEqual(300)
    expect(best.k).toBeLessThan(700)
  })
  it('each idea carries its totals and what the add sheet needs to log it', () => {
    const [best] = suggestFromOwn(remaining, [chicken, buckwheat], { target })
    const sum = best.items.reduce((a, x) => a + x.k, 0)
    expect(best.k).toBe(sum)
    expect(best.items[0]).toHaveProperty('per100')
    expect(best.items.find(x => x.n === 'Куриная грудка').ref).toBe('g:u171477')
    expect(best).not.toHaveProperty('miss')
  })
  it('offers several different meals, never the same one twice, and respects the limit', () => {
    const ideas = suggestFromOwn(remaining, [chicken, buckwheat, rice, tvorog, pelmeni], { target, limit: 4 })
    expect(ideas).toHaveLength(4)
    expect(new Set(ideas.map(i => i.items.map(x => x.n).sort().join('|'))).size).toBe(4)
  })
  it('no food carries more than two of the ideas', () => {
    const ideas = suggestFromOwn(remaining, [chicken, buckwheat, rice, tvorog, pelmeni], { target, limit: 6 })
    const count = {}
    ideas.forEach(i => i.items.forEach(x => { count[x.n] = (count[x.n] || 0) + 1 }))
    expect(Math.max(...Object.values(count))).toBeLessThanOrEqual(2)
  })
  it('a dish goes on its own, sized to the energy left', () => {
    const [only] = suggestFromOwn({ k: 500, p: 20, f: 25, c: 50 }, [pelmeni], { target })
    expect(only.items).toHaveLength(1)
    expect(only.items[0].g).toBe(200)
  })
  it('never builds a meal out of pure fat, and never exceeds a sane portion', () => {
    expect(suggestFromOwn(remaining, [oil], { target })).toEqual([])
    const [big] = suggestFromOwn({ k: 3000, p: 20, f: 100, c: 600 }, [buckwheat], { target: { kcal: 9000 } })
    expect(big.items[0].g).toBe(300)
  })
  it('says nothing when the day is full or there is nothing to choose from', () => {
    expect(suggestFromOwn({ k: 40, p: 5, f: 0, c: 0 }, [chicken, buckwheat], { target })).toEqual([])
    expect(suggestFromOwn(remaining, [], { target })).toEqual([])
    expect(suggestFromOwn(null, [chicken])).toEqual([])
  })
  it('short of protein with little energy left: the lean protein source alone ranks first', () => {
    const [best] = suggestFromOwn({ k: 200, p: 40, f: 5, c: 5 }, [chicken, buckwheat, pelmeni], { target })
    expect(best.items.map(x => x.n)).toEqual(['Куриная грудка'])
  })
})
