import { describe, it, expect } from 'vitest'
import { GENERAL, GUIDE, guideFor } from './measure-guide.js'
import { MEASURES } from './body.js'

describe('measuring instructions', () => {
  it('every tape measurement has a site with at least two steps', () => {
    for (const m of MEASURES.filter(x => !x.kind)) {
      const steps = guideFor(m.site)
      expect(steps.length, m.key).toBeGreaterThanOrEqual(2)
      for (const s of steps) expect(typeof s === 'string' && s.length > 10, m.key).toBe(true)
    }
  })
  it('no instruction is written for a site nothing measures', () => {
    const sites = new Set(MEASURES.map(m => m.site).filter(Boolean))
    expect(Object.keys(GUIDE).filter(s => !sites.has(s))).toEqual([])
  })
  it('the relaxed and the flexed arm are told apart', () => {
    expect(guideFor('upperArm').join(' ')).toMatch(/Do not tense/)
    expect(guideFor('upperArmFlexed').join(' ')).toMatch(/Tense the biceps/)
    expect(guideFor('upperArm')).not.toEqual(guideFor('upperArmFlexed'))
  })
  it('the general rules stand on their own, and composition has no tape steps', () => {
    expect(GENERAL().length).toBeGreaterThanOrEqual(5)
    expect(guideFor(null)).toEqual([])
    expect(guideFor('bodyFat')).toEqual([])
  })
})
