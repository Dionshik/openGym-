import { describe, it, expect } from 'vitest'
import { searchFoods, barcodeOf, words, foodFromRow, loadFoods } from './food-search.js'
import { FOODS } from './foods-data.js'

const names = (q, opts) => searchFoods(q, { generic: FOODS, lang: 'ru', ...opts }).map(x => x.n)

describe('words / barcodeOf', () => {
  it('folds case, ё and accents, and splits on anything that is not a letter or digit', () => {
    expect(words('Творог 5 %, «Простоквашино»')).toEqual(['творог', '5', '%', 'простоквашино'])
    expect(words('Сёмга')).toEqual(['семга'])
    expect(words('  ')).toEqual([])
  })
  it('a run of 8–14 digits is a barcode; anything else is a name', () => {
    expect(barcodeOf('4607025392408')).toBe('4607025392408')
    expect(barcodeOf('4607 0253 92408')).toBe('4607025392408')
    expect(barcodeOf('12345')).toBe(null)
    expect(barcodeOf('творог 5')).toBe(null)
  })
})

describe('the built-in list', () => {
  it('every row is usable: unique id and name, sane numbers, both names present', () => {
    const ids = new Set(), ru = new Set()
    for (const row of FOODS) {
      const [id, r, e, k, p, f, c, al, sv] = row
      expect(row).toHaveLength(9)
      expect(id).toMatch(/^(u\d+|s-[a-z0-9-]+)$/)
      expect(ids.has(id)).toBe(false); ids.add(id)
      expect(ru.has(r.toLowerCase())).toBe(false); ru.add(r.toLowerCase())
      expect(r && e).toBeTruthy()
      expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(902)
      expect(p + f + c).toBeLessThanOrEqual(101)
      expect(typeof al).toBe('string')
      expect(sv).toBeGreaterThanOrEqual(0)
    }
    expect(FOODS.length).toBeGreaterThan(400)
  })
  it('names a row in the profile language, the other language as a search word', () => {
    const row = FOODS.find(r => r[0] === 'u171477')
    expect(foodFromRow(row, 'ru')).toMatchObject({ n: 'Куриная грудка запечённая', alt: 'Chicken breast, roasted', k: 165 })
    expect(foodFromRow(row, 'de').n).toBe('Chicken breast, roasted')
  })
  it('loads lazily and only once', async () => {
    expect(await loadFoods()).toBe(FOODS)
    expect(loadFoods()).toBe(loadFoods())
  })
})

describe('searchFoods', () => {
  it('finds everyday foods the way they are typed, not only in the dictionary form', () => {
    expect(names('гречка')[0]).toMatch(/^Гречка/)
    expect(names('гречку')[0]).toMatch(/^Гречка/)
    expect(names('греча варёная')[0]).toBe('Гречка варёная')
    expect(names('куриную грудку')[0]).toMatch(/^Куриная грудка/)
    expect(names('творога')[0]).toMatch(/^Творог/)
    expect(names('семга')[0]).toMatch(/Лосось/)
    expect(names('борщ')[0]).toBe('Борщ')
    expect(names('борща')[0]).toBe('Борщ')
  })
  it('the plain food comes before the dishes made of it', () => {
    expect(names('рис')[0]).toMatch(/^Рис /)
    expect(names('яйцо')[0]).toMatch(/^Яйцо/)
  })
  it('every query word has to be answered', () => {
    expect(names('творог 5')).toContain('Творог 5 %')
    expect(names('гречка ананас')).toEqual([])
    expect(names('ъъъ')).toEqual([])
  })
  it('an English query works on a Russian profile and the other way round', () => {
    expect(names('chicken breast')[0]).toMatch(/Куриная грудка/)
    expect(searchFoods('гречка', { generic: FOODS, lang: 'en' })[0].n).toMatch(/Buckwheat/)
  })
  it('a result carries what the add sheet needs', () => {
    const [x] = searchFoods('творог 5', { generic: FOODS, lang: 'ru' })
    expect(x).toMatchObject({ kind: 'generic', key: 'g:s-tvorog-5', ref: 'g:s-tvorog-5', per100: { k: 121, p: 17.2, f: 5, c: 1.8 }, g: 180 })
  })
  it('my products and what I logged recently outrank the built-in list, each shown once', () => {
    const own = [{ id: 'f1', n: 'Гречка моя на пару', brand: 'Мистраль', k: 100, p: 4, f: 1, c: 20, sv: 250 }]
    const recent = [{ key: 'g:u170686', n: 'Гречка варёная', g: 300, per100: { k: 92, p: 3.4, f: 0.6, c: 19.9 }, fixed: null, r: 'g:u170686' }]
    const res = searchFoods('гречка', { generic: FOODS, own, recent, lang: 'ru' })
    expect(res.slice(0, 2).map(x => x.kind).sort()).toEqual(['own', 'recent'])
    expect(res.filter(x => x.n === 'Гречка варёная')).toHaveLength(1)
    expect(res.find(x => x.kind === 'recent').g).toBe(300)            // the weight used last time
    expect(searchFoods('мистраль', { own })[0]).toMatchObject({ kind: 'own', ref: 'o:f1', g: 250 })
  })
  it('before anything is typed: recent first, then my products', () => {
    const own = [{ id: 'f1', n: 'Мой протеин', k: 380, p: 78, f: 4, c: 6 }]
    const recent = [{ key: 'n:обед', n: 'Обед', g: 0, per100: null, fixed: { k: 700, p: 0, f: 0, c: 0 }, r: null }]
    const res = searchFoods('', { generic: FOODS, own, recent })
    expect(res.map(x => x.kind)).toEqual(['recent', 'own'])
    expect(res[0].fixed).toEqual({ k: 700, p: 0, f: 0, c: 0 })
    expect(res[1].g).toBe(100)
  })
  it('respects the limit', () => {
    expect(searchFoods('с', { generic: FOODS, lang: 'ru', limit: 5 })).toHaveLength(5)
  })
})
