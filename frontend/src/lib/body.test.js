import { describe, it, expect } from 'vitest'
import { otherSide, sidePairs, TAPE_DETECTABLE_CM, SIDES_MAX_APART_DAYS, MEASURES, MEASURE_KEYS, SITE_MUSCLES, siteOf, isGirth, goalOf, mergeGoals, deltaToDisplay, measureUnit, toDisplay, fromDisplay, cmToDisplay, cmFromDisplay, latestMeasures, measureSeries, usedMeasures, measureDelta } from './body.js'
import { MUSCLES } from './muscles.js'

const S = (unit = 'kg') => ({
  unit,
  measurements: [
    { d: '2026-08-01', t: 1, waist: 92, bodyFat: 22, upperArmLeft: 38 },
    { d: '2026-09-01', t: 2, waist: 90, leanMass: 62 },
    { d: '2026-10-01', t: 3, waist: 88.5, bodyFat: 20 }
  ]
})

describe('units', () => {
  it('lengths are centimetres for a kg profile and inches for a lb profile; percent is percent', () => {
    expect(measureUnit('waist', 'kg')).toBe('cm')
    expect(measureUnit('waist', 'lb')).toBe('in')
    expect(measureUnit('bodyFat', 'lb')).toBe('%')
    expect(measureUnit('leanMass', 'lb')).toBe('lb')
    expect(measureUnit('leanMass', 'kg')).toBe('kg')
  })
  it('converts at the edge and stores centimetres, percent and kilograms', () => {
    expect(toDisplay('waist', 91.4, 'lb')).toBe(36)
    expect(fromDisplay('waist', 36, 'lb')).toBe(91.4)
    expect(fromDisplay('waist', 90, 'kg')).toBe(90)
    expect(fromDisplay('bodyFat', 18.5, 'lb')).toBe(18.5)
    expect(fromDisplay('leanMass', 140, 'lb')).toBe(63.5)
    expect(toDisplay('leanMass', 63.5, 'lb')).toBe(140)
  })
  it('nothing typed, zero and nonsense are no value', () => {
    expect(fromDisplay('waist', '', 'kg')).toBe(null)
    expect(fromDisplay('waist', 0, 'kg')).toBe(null)
    expect(fromDisplay('waist', 900, 'kg')).toBe(null)
    expect(fromDisplay('bodyFat', 95, 'kg')).toBe(null)
    expect(toDisplay('waist', null, 'kg')).toBe(null)
  })
  it('height uses the same conversion', () => {
    expect(cmToDisplay(180, 'lb')).toBe(70.9)
    expect(cmFromDisplay(70.9, 'lb')).toBe(180.1)
    expect(cmFromDisplay(180, 'kg')).toBe(180)
    expect(cmToDisplay(0, 'kg')).toBe(null)
  })
})

describe('reading the list', () => {
  it('the latest value of each measurement, with its day', () => {
    expect(latestMeasures(S())).toEqual({
      waist: { v: 88.5, d: '2026-10-01' }, bodyFat: { v: 20, d: '2026-10-01' },
      upperArmLeft: { v: 38, d: '2026-08-01' }, leanMass: { v: 62, d: '2026-09-01' }
    })
    expect(latestMeasures({})).toEqual({})
  })
  it('a series skips the days without that measurement and comes out in the display unit', () => {
    expect(measureSeries(S(), 'bodyFat').map(p => [p.d, p.y])).toEqual([['2026-08-01', 22], ['2026-10-01', 20]])
    expect(measureSeries(S('lb'), 'waist').map(p => p.y)).toEqual([36.2, 35.4, 34.8])
  })
  it('lists the measurements in use in a fixed order, and the last change', () => {
    expect(usedMeasures(S())).toEqual(['waist', 'upperArmLeft', 'bodyFat', 'leanMass'])
    expect(measureDelta(S(), 'waist')).toBe(-1.5)
    expect(measureDelta(S(), 'upperArmLeft')).toBe(null)
  })
  it('uses the field names upstream uses for the same thing', () => {
    for (const k of ['waist', 'chest', 'hips', 'neck', 'shoulders', 'upperArmLeft', 'upperArmRight', 'thighLeft', 'thighRight', 'calfLeft', 'calfRight', 'bodyFat',
      'abdomen', 'forearmLeft', 'forearmRight', 'wristLeft', 'wristRight', 'ankleLeft', 'ankleRight']) {
      expect(MEASURE_KEYS).toContain(k)
    }
  })
})

describe('sites, goals and differences', () => {
  it('a left and a right key share a site; composition has none', () => {
    expect(siteOf('upperArmLeft')).toBe('upperArm')
    expect(siteOf('upperArmRight')).toBe('upperArm')
    expect(siteOf('upperArmFlexedRight')).toBe('upperArmFlexed')
    expect(siteOf('bodyFat')).toBe(null)
    expect(siteOf('nonsense')).toBe(null)
    expect(isGirth('forearmLeft')).toBe(true)
    expect(isGirth('bodyFat')).toBe(false)
    expect(isGirth('leanMass')).toBe(false)
    expect(isGirth('nonsense')).toBe(false)
  })
  it('every tape site says which muscles lie under it, in slugs the muscle map knows', () => {
    for (const m of MEASURES.filter(x => !x.kind)) {
      expect(Array.isArray(SITE_MUSCLES[m.site]), m.key).toBe(true)
      for (const slug of SITE_MUSCLES[m.site]) expect(MUSCLES, m.site).toContain(slug)
    }
    expect(SITE_MUSCLES.upperArmFlexed).toEqual(['biceps', 'triceps'])
    expect(SITE_MUSCLES.waist).toEqual([])
  })
  it('wrist and ankle stay out of the way until asked for', () => {
    expect(MEASURES.filter(m => m.extra).map(m => m.key)).toEqual(['wristLeft', 'wristRight', 'ankleLeft', 'ankleRight'])
  })
  it('a goal is read in the stored unit; a removed goal is no goal', () => {
    const S = { measureGoals: { waist: { v: 85, t: 1 }, chest: { v: null, t: 2 } } }
    expect(goalOf(S, 'waist')).toBe(85)
    expect(goalOf(S, 'chest')).toBe(null)
    expect(goalOf(S, 'hips')).toBe(null)
    expect(goalOf({}, 'waist')).toBe(null)
  })
  it('merging goals keeps the later decision per measurement, including a removal', () => {
    expect(mergeGoals({ waist: { v: 85, t: 5 } }, { waist: { v: null, t: 9 }, hips: { v: 100, t: 1 } }))
      .toEqual({ waist: { v: null, t: 9 }, hips: { v: 100, t: 1 } })
    expect(mergeGoals(undefined, undefined)).toEqual({})
  })
  it('a difference converts like a value but may be negative or zero', () => {
    expect(deltaToDisplay('waist', -1.27, 'lb')).toBe(-0.5)
    expect(deltaToDisplay('waist', 0.456, 'kg')).toBe(0.46)
    expect(deltaToDisplay('waist', 0, 'kg')).toBe(0)
    expect(deltaToDisplay('bodyFat', -1.5, 'lb')).toBe(-1.5)
    expect(deltaToDisplay('leanMass', 1, 'lb')).toBe(2.2)
    expect(deltaToDisplay('waist', NaN, 'kg')).toBe(null)
  })
})

describe('left against right', () => {
  const S = rows => ({ unit: 'kg', measurements: rows })

  it('every left key has its right, and the other way round; a single measurement has no pair', () => {
    expect(otherSide('upperArmLeft')).toBe('upperArmRight')
    expect(otherSide('upperArmFlexedRight')).toBe('upperArmFlexedLeft')
    expect(otherSide('waist')).toBe(null)
    expect(otherSide('bodyFat')).toBe(null)
    expect(otherSide('nonsenseLeft')).toBe(null)
    expect(otherSide(undefined)).toBe(null)
    for (const m of MEASURES.filter(x => /(Left|Right)$/.test(x.key))) expect(siteOf(otherSide(m.key)), m.key).toBe(m.site)
  })

  it('compares the latest reading of each side, site by site, in the order of the list', () => {
    const pairs = sidePairs(S([
      { d: '2026-09-01', upperArmLeft: 37.5, upperArmRight: 38.5, calfLeft: 38 },
      { d: '2026-10-01', upperArmLeft: 38, upperArmRight: 38.4, thighLeft: 58, thighRight: 59.5, waist: 90 }
    ]))
    expect(pairs.map(p => p.site)).toEqual(['upperArm', 'thigh'])       // the calf was measured on one side only
    expect(pairs[0]).toMatchObject({ left: { key: 'upperArmLeft', v: 38, d: '2026-10-01' }, right: { key: 'upperArmRight', v: 38.4 }, diff: 0.4, apartDays: 0, comparable: true, within: true })
    expect(pairs[1]).toMatchObject({ diff: 1.5, comparable: true, within: false })
  })

  it('a difference smaller than the tape can tell is "within"; at that size and beyond it is a difference', () => {
    const one = (l, r) => sidePairs(S([{ d: '2026-10-01', calfLeft: l, calfRight: r }]))[0]
    expect(one(38, 38)).toMatchObject({ diff: 0, within: true })
    expect(one(38, 38.6)).toMatchObject({ diff: 0.6, within: true })
    expect(one(38.6, 38)).toMatchObject({ diff: -0.6, within: true })
    expect(one(38, 38 + TAPE_DETECTABLE_CM)).toMatchObject({ diff: 0.7, within: false })
    expect(one(39, 38)).toMatchObject({ diff: -1, within: false })
  })

  it('sides measured weeks apart are not a comparison, whatever the numbers say', () => {
    const [p] = sidePairs(S([{ d: '2026-08-01', forearmLeft: 30 }, { d: '2026-10-01', forearmRight: 30.2 }]))
    expect(p).toMatchObject({ apartDays: 61, comparable: false, within: false, diff: 0.2 })
    const [near] = sidePairs(S([{ d: '2026-09-20', forearmLeft: 30 }, { d: '2026-10-01', forearmRight: 30.2 }]))
    expect(near).toMatchObject({ apartDays: 11, comparable: true, within: true })
    expect(SIDES_MAX_APART_DAYS).toBe(14)
  })

  it('nothing measured on both sides, nothing to compare', () => {
    expect(sidePairs(S([{ d: '2026-10-01', waist: 90, upperArmLeft: 38 }]))).toEqual([])
    expect(sidePairs({})).toEqual([])
  })
})
