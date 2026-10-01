import { describe, it, expect } from 'vitest'
import { applyHealth, healthPending } from './health-apply.js'

const health = (days, height = null) => ({ rev: 1, days, height, lastIngest: 999 })
const base = (over = {}) => ({ unit: 'kg', bodyweight: [], measurements: [], bodyProfile: null, healthSync: null, ...over })

describe('applyHealth', () => {
  it('a reading becomes a weigh-in and a measurement row, marked as coming from Health', () => {
    const S = base()
    const out = applyHealth(S, health({ '2026-10-01': { weight: { v: 80.5, at: 100 }, bodyFat: { v: 18.2, at: 100 }, waist: { v: 88, at: 110 } } }))
    expect(out).toEqual({ weighIns: 1, measures: 2, height: false })
    expect(S.bodyweight).toEqual([{ d: '2026-10-01', w: 80.5, t: 100, src: 'hk' }])
    expect(S.measurements).toEqual([{ d: '2026-10-01', t: 110, src: 'hk', bodyFat: 18.2, waist: 88 }])
    expect(S.healthSync).toEqual({ applied: 110 })
  })
  it('weight arrives in kilograms and is stored in the profile unit', () => {
    const S = base({ unit: 'lb' })
    applyHealth(S, health({ '2026-10-01': { weight: { v: 80, at: 100 } } }))
    expect(S.bodyweight[0].w).toBe(176.4)
  })
  it('a weigh-in typed by hand that day wins; a later Health reading replaces only its own', () => {
    const S = base({ bodyweight: [{ d: '2026-10-01', w: 81, t: 50 }, { d: '2026-10-02', w: 80.9, t: 60, src: 'hk' }] })
    const out = applyHealth(S, health({ '2026-10-01': { weight: { v: 80.5, at: 100 } }, '2026-10-02': { weight: { v: 80.2, at: 120 } } }))
    expect(out.weighIns).toBe(1)
    expect(S.bodyweight.map(b => [b.d, b.w, b.src || null])).toEqual([['2026-10-01', 81, null], ['2026-10-02', 80.2, 'hk']])
  })
  it('a measurement taken by hand stays, and an empty slot on that day is filled', () => {
    const S = base({ measurements: [{ d: '2026-10-01', t: 50, waist: 90 }] })
    applyHealth(S, health({ '2026-10-01': { waist: { v: 88, at: 100 }, bodyFat: { v: 18, at: 100 } } }))
    expect(S.measurements[0]).toEqual({ d: '2026-10-01', t: 100, waist: 90, bodyFat: 18 })
  })
  it('nothing is applied twice — a weigh-in deleted afterwards stays deleted', () => {
    const S = base()
    const h = health({ '2026-10-01': { weight: { v: 80.5, at: 100 } } })
    applyHealth(S, h)
    S.bodyweight = []                                     // the person deletes it
    expect(healthPending(S, h)).toBe(false)
    expect(applyHealth(S, h)).toEqual({ weighIns: 0, measures: 0, height: false })
    expect(S.bodyweight).toEqual([])
    // a genuinely new reading still arrives
    const next = health({ '2026-10-01': { weight: { v: 80.5, at: 100 } }, '2026-10-02': { weight: { v: 80.1, at: 200 } } })
    expect(healthPending(S, next)).toBe(true)
    applyHealth(S, next)
    expect(S.bodyweight.map(b => b.d)).toEqual(['2026-10-02'])
    expect(S.healthSync.applied).toBe(200)
  })
  it('height fills an empty profile and never overwrites one', () => {
    const S = base()
    expect(applyHealth(S, health({}, { v: 180, at: 100 })).height).toBe(true)
    expect(S.bodyProfile).toEqual({ heightCm: 180, t: 100 })
    const T = base({ bodyProfile: { heightCm: 178, sex: 'm', t: 5 } })
    expect(applyHealth(T, health({}, { v: 180, at: 100 })).height).toBe(false)
    expect(T.bodyProfile.heightCm).toBe(178)
    expect(T.healthSync.applied).toBe(100)                // seen, so not asked about again
  })
  it('keeps both lists in day order and survives a profile without them', () => {
    const S = { unit: 'kg' }
    applyHealth(S, health({ '2026-10-03': { weight: { v: 80, at: 300 } }, '2026-10-01': { weight: { v: 81, at: 400 }, waist: { v: 88, at: 400 } } }))
    expect(S.bodyweight.map(b => b.d)).toEqual(['2026-10-01', '2026-10-03'])
    expect(S.measurements.map(m => m.d)).toEqual(['2026-10-01'])
  })
  it('ignores junk and an unknown metric', () => {
    const S = base()
    expect(applyHealth(S, health({ '2026-10-01': { steps: { v: 9000, at: 100 }, weight: { v: 0, at: 100 }, waist: null } }))).toEqual({ weighIns: 0, measures: 0, height: false })
    expect(applyHealth(S, null)).toEqual({ weighIns: 0, measures: 0, height: false })
    expect(healthPending(S, null)).toBe(false)
  })
})
