// @vitest-environment happy-dom

/* The food diary, the body profile and the Health deliveries in the real store: every write
   goes through nutrition-actions.js, which folds old days and refreshes the target snapshot;
   Health deliveries are fetched when their revision moves and copied into the profile once;
   and a device whose storage is full loses nothing it was just told. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore, hasData } from './useStore.js'
import { nutritionOf, dayTotals, dayBefore, myFoods, ROLL_DAYS } from '../lib/nutrition.js'
import { todayISO } from '../lib/format.js'
import { logFood, logQuick, logMany, changeEntry, deleteEntry, saveMyFood, archiveMyFood, setTargets, saveBodyProfile, saveMeasurement, deleteMeasurement } from '../nutrition-actions.js'

const clone = value => JSON.parse(JSON.stringify(value))
const S = () => useStore.getState().S
const nut = () => nutritionOf(S())
const chicken = { n: 'Куриная грудка', per100: { k: 165, p: 31, f: 3.6, c: 0 }, ref: 'g:u171477' }
const today = todayISO()

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  toast.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: true, config: null, health: null })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

describe('the diary', () => {
  it('a new profile has no diary until something is logged, and a diary alone counts as data', () => {
    expect(S().nutrition).toBe(null)
    expect(hasData(S())).toBe(false)
    logFood(chicken, 150, { d: today, m: 1 })
    expect(nut().log).toHaveLength(1)
    expect(nut().log[0]).toMatchObject({ n: 'Куриная грудка', g: 150, k: 248, p: 46.5, m: 1, r: 'g:u171477' })
    expect(hasData(S())).toBe(true)
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).nutrition.log).toHaveLength(1)
  })

  it('edits rescale, deletes leave a tombstone, several rows go in at once', () => {
    const e = logFood(chicken, 100, { d: today, m: 1 })
    changeEntry(e.id, { g: 200 })
    expect(dayTotals(nut(), today)).toMatchObject({ k: 330, n: 1 })
    logQuick({ n: 'Обед в кафе', k: 700 }, { d: today, m: 1 })
    logMany([{ item: chicken, grams: 50 }, { quick: { n: 'Кофе', k: 40 } }, { copy: { ...e, id: 'old' } }], { d: today, m: 3 })
    expect(dayTotals(nut(), today).n).toBe(5)
    expect(new Set(nut().log.map(x => x.id)).size).toBe(5)          // the copied row got an id of its own
    deleteEntry(e.id)
    expect(nut().log.find(x => x.id === e.id)).toBeUndefined()
    expect(nut().del[e.id]).toBeGreaterThan(0)
  })

  it('every write folds the days that have aged out', () => {
    const old = dayBefore(today, ROLL_DAYS + 3)
    logFood(chicken, 100, { d: old, m: 1 })
    // the row for the old day went straight in, and the same write folded it
    expect(nut().log).toEqual([])
    expect(nut().days[old]).toMatchObject({ k: 165, n: 1 })
    expect(nut().rolledTo).toBe(dayBefore(today, ROLL_DAYS))
  })

  it('my products: saved, found, archived — and one without a name is refused', () => {
    const row = saveMyFood({ n: 'Мой протеин', k: 380, p: 78, f: 4, c: 6, sv: 30 })
    expect(row).toMatchObject({ n: 'Мой протеин', src: 'own', sv: 30 })
    expect(saveMyFood({ n: '  ' })).toBe(null)
    expect(myFoods(nut()).map(f => f.n)).toEqual(['Мой протеин'])
    archiveMyFood(row.id)
    expect(myFoods(nut())).toEqual([])
  })
})

describe('the target', () => {
  it('a manual target is kept as typed, with a snapshot a reader without the formulas can use', () => {
    setTargets({ mode: 'manual', kcal: 2200, p: 160, f: 70, c: 230 })
    expect(nut().targets).toMatchObject({ mode: 'manual', kcal: 2200, p: 160, f: 70, c: 230, basis: 'manual' })
    expect(nut().targets.t).toBeGreaterThan(0)
  })

  it('an automatic target appears once the body profile can carry it, and follows the profile', () => {
    setTargets({ mode: 'auto', goal: 'maintain', cycle: false })
    expect(nut().targets.kcal).toBe(null)                       // no weight, no height, no age yet
    useStore.getState().update(s => { s.bodyweight = [{ d: today, w: 80, t: 1 }] })
    saveBodyProfile({ sex: 'm', born: +today.slice(0, 4) - 30, heightCm: 180, activity: 'moderate' })
    expect(nut().targets).toMatchObject({ kcal: 2759, p: 144, tdee: 2759, basis: 'formula' })
    setTargets({ goal: 'lose', rate: 0.5 })
    expect(nut().targets.kcal).toBe(2319)
    expect(S().bodyProfile.t).toBeGreaterThan(0)
  })
})

describe('measurements', () => {
  it('one row per day: a second save edits it, an emptied field drops the key, an empty row goes', () => {
    saveMeasurement(today, { waist: 90.04, bodyFat: 18 })
    saveMeasurement(today, { waist: 89.5, bodyFat: 0, chest: 104 })
    expect(S().measurements).toHaveLength(1)
    expect(S().measurements[0]).toMatchObject({ d: today, waist: 89.5, chest: 104 })
    expect('bodyFat' in S().measurements[0]).toBe(false)
    saveMeasurement(today, { waist: 0, chest: 0 })
    expect(S().measurements).toEqual([])
    saveMeasurement(today, { waist: 90 })
    deleteMeasurement(today)
    expect(S().measurements).toEqual([])
  })

  it('editing a row Health delivered makes it the person’s own', () => {
    useStore.getState().update(s => { s.measurements = [{ d: today, t: 1, src: 'hk', waist: 88 }] })
    saveMeasurement(today, { waist: 89 })
    expect('src' in S().measurements[0]).toBe(false)
  })
})

describe('Apple Health deliveries', () => {
  const delivery = (rev, days) => ({ rev, days, height: null, lastIngest: 5, tokens: [], shortcutUrl: '' })
  const signedIn = (config = { health: true }) => useStore.setState({ user: { id: 'u1' }, config })

  it('are fetched and copied into the profile once', async () => {
    signedIn()
    api.mockResolvedValue(delivery(1, { [today]: { weight: { v: 80.5, at: 100 }, waist: { v: 88, at: 100 } } }))
    await useStore.getState().pullHealth()
    expect(S().bodyweight).toEqual([{ d: today, w: 80.5, t: 100, src: 'hk' }])
    expect(S().measurements).toEqual([{ d: today, t: 100, src: 'hk', waist: 88 }])
    expect(S().healthSync).toEqual({ applied: 100 })
    expect(useStore.getState().health.rev).toBe(1)
    expect(localStorage.getItem('gym_health_rev')).toBe('1')
    // the same delivery again changes nothing — not even the profile's timestamp
    const ts = S()._ts
    await useStore.getState().pullHealth()
    expect(S()._ts).toBe(ts)
  })

  it('nobody is asked on an instance without the feature, or for a guest', async () => {
    signedIn({})
    await useStore.getState().pullHealth()
    useStore.setState({ user: null, config: { health: true } })
    await useStore.getState().pullHealth()
    expect(api).not.toHaveBeenCalled()
  })

  it('a failed fetch leaves the profile alone and is asked again next time', async () => {
    signedIn()
    api.mockRejectedValueOnce(new Error('offline'))
    expect(await useStore.getState().pullHealth()).toBe(null)
    expect(S().bodyweight).toEqual([])
    expect(localStorage.getItem('gym_health_rev')).toBe(null)
  })
})

describe('a device out of storage', () => {
  it('keeps the change in memory, folds the diary hard, and says so once', async () => {
    logFood(chicken, 100, { d: dayBefore(today, 30), m: 1 })
    logFood(chicken, 100, { d: today, m: 1 })
    let fail = 2
    // A stand-in for the browser's storage that refuses the profile twice, then behaves.
    const real = localStorage
    vi.stubGlobal('localStorage', {
      getItem: k => real.getItem(k), removeItem: k => real.removeItem(k), clear: () => real.clear(),
      setItem: (k, v) => {
        if (k === 'gym_state_v1' && fail-- > 0) throw new DOMException('quota', 'QuotaExceededError')
        real.setItem(k, v)
      }
    })
    logFood(chicken, 200, { d: today, m: 2 })
    expect(nut().log.filter(e => e.d === today)).toHaveLength(2)                 // the new row is there
    expect(nut().days[dayBefore(today, 30)]).toMatchObject({ k: 165, n: 1 })     // the old day was folded to make room
    await new Promise(r => setTimeout(r, 0))
    expect(toast).toHaveBeenCalledTimes(1)
    logFood(chicken, 50, { d: today, m: 2 })
    await new Promise(r => setTimeout(r, 0))
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
