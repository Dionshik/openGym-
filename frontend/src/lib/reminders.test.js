import { describe, it, expect } from 'vitest'
import { remindersOf, activeReminders, canAddReminder, saveReminder, removeReminder, mergeReminders, loggedOn, ringsOn, daysSummary, cleanText, cleanDays, MAX_REMINDERS, MAX_TEXT } from './reminders.js'
import { mergeStates } from './sync-merge.js'

const NOW = 1_800_000_000_000
const DAY = 86400000
const rem = (id, over = {}) => ({ id, text: 'Log food', time: '13:00', days: [], on: true, link: null, skipIfLogged: false, t: 1, ...over })

describe('writing a reminder', () => {
  it('a new one gets the id it is handed, cleaned fields and a stamp', () => {
    const list = saveReminder({}, { text: '  Log   food \n', time: '13:00', days: [3, 1, 1, 9], link: 'nutrition', skipIfLogged: true }, { id: 'abc', now: NOW })
    expect(list).toEqual([{ id: 'abc', text: 'Log food', time: '13:00', days: [1, 3], on: true, link: 'nutrition', skipIfLogged: true, t: NOW }])
  })
  it('editing replaces the row in place and keeps the others', () => {
    const S = { reminders: [rem('a'), rem('b'), rem('c')] }
    const list = saveReminder(S, { id: 'b', text: 'Weigh in', time: '07:30', days: [], on: false, link: 'weight' }, { now: NOW })
    expect(list.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(list[1]).toMatchObject({ text: 'Weigh in', time: '07:30', on: false, link: 'weight', t: NOW })
    expect(S.reminders[1].text).toBe('Log food')        // the input is not mutated
  })
  it('refuses a row without a usable time or id, and a list that is full', () => {
    expect(saveReminder({}, { text: 'x', time: '' }, { id: 'a' })).toBe(null)
    expect(saveReminder({}, { text: 'x', time: '24:00' }, { id: 'a' })).toBe(null)
    expect(saveReminder({}, { text: 'x', time: '13:00' }, { id: 'has space' })).toBe(null)
    expect(saveReminder({}, { text: 'x', time: '13:00' }, {})).toBe(null)
    const full = { reminders: Array.from({ length: MAX_REMINDERS }, (_, i) => rem('r' + i)) }
    expect(canAddReminder(full)).toBe(false)
    expect(saveReminder(full, { text: 'x', time: '13:00' }, { id: 'new' })).toBe(null)
    expect(saveReminder(full, { id: 'r3', text: 'still editable', time: '13:00' }, { now: NOW })[3].text).toBe('still editable')
  })
  it('an unknown section is no section, and "skip if logged" needs one', () => {
    const [r] = saveReminder({}, { text: 'x', time: '13:00', link: 'javascript:alert(1)', skipIfLogged: true }, { id: 'a', now: NOW })
    expect(r.link).toBe(null)
    expect(r.skipIfLogged).toBe(false)
  })
  it('text is one line of at most the limit; days are unique weekday indices', () => {
    expect(cleanText('a\n\tb')).toBe('a b')
    expect(cleanText('x'.repeat(500))).toHaveLength(MAX_TEXT)
    expect(cleanText(42)).toBe('')
    expect(cleanDays([6, 0, 0, 7, -1, 2.5, '3', null])).toEqual([0, 6])
    expect(cleanDays('mon')).toEqual([])
  })
})

describe('deleting, and what a merge makes of it', () => {
  it('a deleted reminder leaves a marker and disappears from every reading', () => {
    const S = { reminders: removeReminder({ reminders: [rem('a'), rem('b')] }, 'a', { now: NOW }) }
    expect(S.reminders).toEqual([{ id: 'a', x: true, t: NOW }, rem('b')])
    expect(remindersOf(S).map(r => r.id)).toEqual(['b'])
    expect(activeReminders(S).map(r => r.id)).toEqual(['b'])
  })
  it('the other device\'s older copy does not bring it back; a later edit there does', () => {
    const deleted = [{ id: 'a', x: true, t: 50 }]
    expect(remindersOf({ reminders: mergeReminders(deleted, [rem('a', { t: 10 })]) })).toEqual([])
    expect(remindersOf({ reminders: mergeReminders(deleted, [rem('a', { t: 90 })]) }).map(r => r.id)).toEqual(['a'])
  })
  it('two devices: per id the later row, both sides\' own reminders kept', () => {
    const a = [rem('x', { text: 'old', t: 1 }), rem('onlyA', { t: 5 })]
    const b = [rem('x', { text: 'new', t: 9 }), rem('onlyB', { t: 2 })]
    const m = mergeReminders(a, b)
    expect(m.map(r => r.id).sort()).toEqual(['onlyA', 'onlyB', 'x'])
    expect(m.find(r => r.id === 'x').text).toBe('new')
    expect(mergeReminders(undefined, null)).toEqual([])
    expect(mergeReminders([null, 5, { text: 'no id' }], [])).toEqual([])
  })
  it('mergeStates keeps reminders of both copies, whichever is newer overall', () => {
    const m = mergeStates({ _ts: 100, reminders: [rem('a', { t: 1 })] }, { _ts: 50, reminders: [rem('b', { t: 2 })] })
    expect(m.reminders.map(r => r.id).sort()).toEqual(['a', 'b'])
    expect('reminders' in mergeStates({ _ts: 1 }, { _ts: 2 })).toBe(false)
  })
  it('markers older than a month and a half are dropped on the next write', () => {
    const S = { reminders: [{ id: 'old', x: true, t: NOW - 46 * DAY }, { id: 'recent', x: true, t: NOW - 10 * DAY }, rem('a')] }
    expect(saveReminder(S, { text: 'x', time: '08:00' }, { id: 'n', now: NOW }).map(r => r.id)).toEqual(['recent', 'a', 'n'])
    expect(removeReminder(S, 'a', { now: NOW }).map(r => r.id)).toEqual(['recent', 'a'])
  })
})

describe('reading the list', () => {
  it('active means switched on with a time that parses; a broken profile has none', () => {
    const S = { reminders: [rem('a'), rem('b', { on: false }), rem('c', { time: 'soon' }), rem('d', { on: 'yes' }), null, 'x', { text: 'no id' }] }
    expect(remindersOf(S).map(r => r.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(activeReminders(S).map(r => r.id)).toEqual(['a'])
    for (const bad of [{}, { reminders: null }, { reminders: {} }, null, undefined]) {
      expect(remindersOf(bad)).toEqual([])
      expect(activeReminders(bad)).toEqual([])
    }
  })
  it('rings on its weekdays, or every day when none is picked', () => {
    expect(ringsOn(rem('a', { days: [1, 3] }), 3)).toBe(true)
    expect(ringsOn(rem('a', { days: [1, 3] }), 4)).toBe(false)
    expect(ringsOn(rem('a'), 0)).toBe(true)
  })
  it('summarises the days the way a person would say them', () => {
    expect(daysSummary(rem('a'))).toBe('daily')
    expect(daysSummary(rem('a', { days: [0, 1, 2, 3, 4, 5, 6] }))).toBe('daily')
    expect(daysSummary(rem('a', { days: [5, 4, 3, 2, 1] }))).toBe('weekdays')
    expect(daysSummary(rem('a', { days: [6, 0] }))).toBe('weekend')
    expect(daysSummary(rem('a', { days: [0, 3, 1] }))).toEqual({ days: [1, 3, 0] })           // Monday-first
    expect(daysSummary(rem('a', { days: [0, 3, 1] }), [0, 1, 2, 3, 4, 5, 6])).toEqual({ days: [0, 1, 3] })
  })
  it('"already logged" looks at the section the reminder points at', () => {
    const D = '2026-10-07'
    expect(loggedOn({ nutrition: { log: [{ id: 'a', d: D }] } }, 'nutrition', D)).toBe(true)
    expect(loggedOn({ nutrition: { log: [], days: { [D]: { k: 1 } } } }, 'nutrition', D)).toBe(true)
    expect(loggedOn({ bodyweight: [{ d: D, w: 80 }] }, 'weight', D)).toBe(true)
    expect(loggedOn({ measurements: [{ d: D, waist: 90 }] }, 'body', D)).toBe(true)
    expect(loggedOn({ measurements: [{ d: D, waist: 90 }] }, 'weight', D)).toBe(false)
    expect(loggedOn({}, 'photos', D, d => d === D)).toBe(true)
    expect(loggedOn({}, 'photos', D)).toBe(false)
    expect(loggedOn({}, null, D)).toBe(false)
    expect(loggedOn(null, 'nutrition', D)).toBe(false)
  })
})
