import { describe, it, expect } from 'vitest'
import { MEASURE_KEYS, measureUnit, toDisplay, fromDisplay, cmToDisplay, cmFromDisplay, latestMeasures, measureSeries, usedMeasures, measureDelta } from './body.js'

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
    for (const k of ['waist', 'chest', 'hips', 'neck', 'shoulders', 'upperArmLeft', 'upperArmRight', 'thighLeft', 'thighRight', 'calfLeft', 'calfRight', 'bodyFat']) {
      expect(MEASURE_KEYS).toContain(k)
    }
  })
})
