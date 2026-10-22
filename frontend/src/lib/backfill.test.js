import { describe, expect, it } from 'vitest'
import { workoutsOn, backfillStart, backfillEnd, insertChronological, completeBackfill, moveWorkout } from './backfill.js'

const w = (id, d, start = 0) => ({ id, d, start })

describe('workoutsOn', () => {
  it('returns every workout of that day and nothing else', () => {
    const S = { workouts: [w('a', '2026-01-01'), w('b', '2026-01-02'), w('c', '2026-01-02')] }
    expect(workoutsOn(S, '2026-01-02').map(x => x.id)).toEqual(['b', 'c'])
    expect(workoutsOn(S, '2026-01-03')).toEqual([])
    expect(workoutsOn({}, '2026-01-03')).toEqual([])
  })
})

describe('backfillStart / backfillEnd', () => {
  it('lands on the chosen day at the chosen time in local zone', () => {
    const t = new Date(backfillStart('2026-03-10', '07:45'))
    expect([t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes()]).toEqual([2026, 3, 10, 7, 45])
  })
  it('defaults to 18:00 and ends after the given duration', () => {
    const start = backfillStart('2026-03-10')
    expect(new Date(start).getHours()).toBe(18)
    expect(backfillEnd({ start, backfill: { durationMin: 45 } })).toBe(start + 45 * 60000)
    expect(backfillEnd({ start, backfill: {} })).toBe(start + 60 * 60000)
    expect(backfillEnd({ start, backfill: { durationMin: 0 } })).toBe(start + 60 * 60000)
  })
})

describe('insertChronological', () => {
  const list = [w('a', '2026-01-01', 10), w('b', '2026-01-05', 10), w('c', '2026-01-05', 20), w('d', '2026-01-09', 10)]
  it('places by date, then by start time, after equal keys', () => {
    expect(insertChronological(list, w('x', '2026-01-03')).map(x => x.id)).toEqual(['a', 'x', 'b', 'c', 'd'])
    expect(insertChronological(list, w('x', '2026-01-05', 15)).map(x => x.id)).toEqual(['a', 'b', 'x', 'c', 'd'])
    expect(insertChronological(list, w('x', '2026-01-05', 20)).map(x => x.id)).toEqual(['a', 'b', 'c', 'x', 'd'])
  })
  it('appends at the end and inserts at the front', () => {
    expect(insertChronological(list, w('x', '2026-02-01')).at(-1).id).toBe('x')
    expect(insertChronological(list, w('x', '2025-12-31'))[0].id).toBe('x')
    expect(insertChronological([], w('x', '2026-01-01')).map(x => x.id)).toEqual(['x'])
  })
  it('does not mutate the input', () => {
    const copy = [...list]
    insertChronological(list, w('x', '2026-01-03'))
    expect(list).toEqual(copy)
  })
})

describe('completeBackfill', () => {
  const list = [w('a', '2026-01-01', 10), w('b', '2026-01-05', 10), w('d', '2026-01-09', 10)]
  it('adds a second workout on a day in order', () => {
    const out = completeBackfill(list, { backfill: { durationMin: 60, replaceId: null } }, w('x', '2026-01-05', 5))
    expect(out.map(x => x.id)).toEqual(['a', 'x', 'b', 'd'])
  })
  it('replaces the chosen workout', () => {
    const out = completeBackfill(list, { backfill: { durationMin: 60, replaceId: 'b' } }, w('x', '2026-01-05', 30))
    expect(out.map(x => x.id)).toEqual(['a', 'x', 'd'])
    expect(list).toHaveLength(3)
  })
})

describe('moveWorkout', () => {
  const at = (iso, hh, mm = 0) => { const d = new Date(iso + 'T12:00:00'); d.setHours(hh, mm, 0, 0); return d.getTime() }
  const w = (id, d, hh, minutes = 60, extra = {}) => ({ id, d, start: at(d, hh), end: at(d, hh) + minutes * 60000, entries: [], ...extra })
  const hist = () => [w('a', '2026-10-12', 18), w('b', '2026-10-13', 7, 45, { prs: ['0025'], note: 'heavy' }), w('c', '2026-10-15', 19)]

  it('keeps the workout — id, records, note — and its time of day and length, on the new date', () => {
    const out = moveWorkout(hist(), 'b', '2026-10-14')
    const m = out.find(x => x.id === 'b')
    expect(m.d).toBe('2026-10-14')
    expect(new Date(m.start).getHours()).toBe(7)
    expect(m.end - m.start).toBe(45 * 60000)
    expect(m.prs).toEqual(['0025'])
    expect(m.note).toBe('heavy')
    expect(out.map(x => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('files it where its new date puts it, in either direction', () => {
    expect(moveWorkout(hist(), 'b', '2026-10-11').map(x => x.id)).toEqual(['b', 'a', 'c'])
    expect(moveWorkout(hist(), 'a', '2026-10-16').map(x => x.id)).toEqual(['b', 'c', 'a'])
    // onto a day that already has one: both stay, ordered by the time of day
    const same = moveWorkout(hist(), 'b', '2026-10-12')
    expect(same.map(x => x.id)).toEqual(['b', 'a', 'c'])
  })

  it('leaves the history alone for an unknown id, the same day, or a date that is not one', () => {
    const h = hist()
    expect(moveWorkout(h, 'zz', '2026-10-14')).toBe(h)
    expect(moveWorkout(h, 'b', '2026-10-13')).toBe(h)
    expect(moveWorkout(h, 'b', '2026-02-30')).toBe(h)
    expect(moveWorkout(h, 'b', 'tomorrow')).toBe(h)
  })

  it('does not change the other workouts or the array it was given', () => {
    const h = hist()
    const before = JSON.stringify(h)
    moveWorkout(h, 'b', '2026-10-10')
    expect(JSON.stringify(h)).toBe(before)
  })
})
