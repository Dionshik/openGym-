import { describe, it, expect } from 'vitest'
import { POSES, photosAvailable, bodyByPose, posesUsed, mealPhotos, daysBetween, comparePair, nearestWeight, sizeText } from './photos.js'

const body = (id, d, pose, at = 0) => ({ id, kind: 'body', d, pose, at })
const meal = (id, d, m, at = 0) => ({ id, kind: 'meal', d, m, at })
const items = [
  body('b3', '2026-10-01', 'front', 3), body('b1', '2026-08-01', 'front', 1), body('s1', '2026-09-01', 'side', 2),
  body('b2', '2026-09-01', 'front', 2), meal('m2', '2026-10-01', 1, 9), meal('m1', '2026-10-01', 1, 5), meal('m3', '2026-10-01', 2, 7),
  null, { id: 'x' }
]

describe('where stored photos exist', () => {
  it('only for someone signed in to an instance that keeps them — never the demo', () => {
    expect(photosAvailable({ config: { photos: true }, user: { id: 'u' } })).toBe(true)
    expect(photosAvailable({ config: { photos: true }, user: null })).toBe(false)
    expect(photosAvailable({ config: {}, user: { id: 'u' } })).toBe(false)
    expect(photosAvailable({ config: null, user: { id: 'u' } })).toBe(false)
    expect(photosAvailable({ config: { photos: 'yes' }, user: { id: 'u' } })).toBe(false)
    expect(photosAvailable({ config: { photos: true }, user: { id: 'u' }, demo: true })).toBe(false)
    expect(photosAvailable()).toBe(false)
  })
})

describe('body photos by pose', () => {
  it('one pose, oldest first, whatever order the list came in', () => {
    expect(bodyByPose(items, 'front').map(p => p.id)).toEqual(['b1', 'b2', 'b3'])
    expect(bodyByPose(items, 'side').map(p => p.id)).toEqual(['s1'])
    expect(bodyByPose(items, 'back')).toEqual([])
    expect(bodyByPose(undefined, 'front')).toEqual([])
  })
  it('two on the same day keep the order they were taken in', () => {
    expect(bodyByPose([body('late', '2026-10-01', 'front', 9), body('early', '2026-10-01', 'front', 2)], 'front').map(p => p.id)).toEqual(['early', 'late'])
  })
  it('a photo with no pose is a front photo', () => {
    expect(bodyByPose([{ id: 'n', kind: 'body', d: '2026-10-01' }], 'front').map(p => p.id)).toEqual(['n'])
  })
  it('the poses in use, in the fixed order', () => {
    expect(posesUsed(items)).toEqual(['front', 'side'])
    expect(posesUsed([])).toEqual([])
    expect(POSES).toEqual(['front', 'side', 'back', 'flex'])
  })
  it('a comparison starts with the first and the latest, and needs two', () => {
    const pair = comparePair(items, 'front')
    expect([pair.before.id, pair.after.id, pair.all.length]).toEqual(['b1', 'b3', 3])
    expect(comparePair(items, 'side')).toBe(null)
    expect(comparePair(items, 'back')).toBe(null)
  })
})

describe('meal photos', () => {
  it('of one meal on one day, in the order taken; of the whole day without a meal', () => {
    expect(mealPhotos(items, '2026-10-01', 1).map(p => p.id)).toEqual(['m1', 'm2'])
    expect(mealPhotos(items, '2026-10-01', 2).map(p => p.id)).toEqual(['m3'])
    expect(mealPhotos(items, '2026-10-01').map(p => p.id)).toEqual(['m1', 'm3', 'm2'])
    expect(mealPhotos(items, '2026-10-02', 1)).toEqual([])
    expect(mealPhotos(items, '2026-10-01', 0)).toEqual([])
  })
})

describe('dates, weights and sizes beside a photo', () => {
  it('whole days between two dates, across a clock change', () => {
    expect(daysBetween('2026-08-01', '2026-10-01')).toBe(61)
    expect(daysBetween('2026-10-01', '2026-08-01')).toBe(-61)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(0)
  })
  it('the weigh-in nearest to the photo, within a week of it', () => {
    const S = { bodyweight: [{ d: '2026-09-20', w: 81 }, { d: '2026-09-29', w: 80.4 }, { d: '2026-10-04', w: 80 }, null, { d: '2026-10-01' }] }
    expect(nearestWeight(S, '2026-10-01')).toEqual({ w: 80.4, d: '2026-09-29' })
    expect(nearestWeight(S, '2026-10-03')).toEqual({ w: 80, d: '2026-10-04' })
    expect(nearestWeight(S, '2026-08-01')).toBe(null)
    expect(nearestWeight({}, '2026-10-01')).toBe(null)
  })
  it('megabytes with a decimal while small, gigabytes past a thousand', () => {
    expect(sizeText(0)).toEqual({ n: 0, unit: 'MB' })
    expect(sizeText(1.44 * 1024 * 1024)).toEqual({ n: 1.4, unit: 'MB' })
    expect(sizeText(212.6 * 1024 * 1024)).toEqual({ n: 213, unit: 'MB' })
    expect(sizeText(500 * 1024 * 1024)).toEqual({ n: 500, unit: 'MB' })
    expect(sizeText(2.5 * 1024 * 1024 * 1024)).toEqual({ n: 2.5, unit: 'GB' })
    expect(sizeText(undefined)).toEqual({ n: 0, unit: 'MB' })
  })
})
