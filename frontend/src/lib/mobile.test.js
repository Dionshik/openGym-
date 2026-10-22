import { describe, expect, it } from 'vitest'
import { isoOf } from './format.js'
import { buildReminderNotifications, buildCustomReminderNotifications, buildNudgeNotifications, pendingNotifications, CUSTOM_REMINDER_MAX, CUSTOM_REMINDER_ID_BASE, PENDING_BUDGET } from './mobile.js'

const push = { id: 'push', name: 'Push' }
const pull = { id: 'pull', name: 'Pull' }
const legs = { id: 'legs', name: 'Legs' }
const state = (patch = {}) => ({
  routines: [push, pull, legs], week: {}, dayPlan: {}, workouts: [],
  reminder: { on: true, time: '08:00' }, ...patch,
})
const iso = d => isoOf(d)

describe('buildReminderNotifications', () => {
  it('expands the weekly baseline into future dated notifications', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const notifications = buildReminderNotifications(state({ week: { 1: 'push', 3: 'pull' } }), now)

    expect(notifications.slice(0, 2).map(n => iso(n.schedule.at))).toEqual([
      iso(now), iso(new Date(2026, 5, 3)),
    ])
    expect(notifications[0].body).toContain('Push')
    expect(notifications[0].schedule.allowWhileIdle).toBe(true)
  })

  it('uses rest today and a routine override tomorrow when rescheduling', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const today = iso(now), tomorrow = iso(new Date(2026, 5, 2))
    const notifications = buildReminderNotifications(state({
      week: { 1: 'push' }, dayPlan: { [today]: 'rest', [tomorrow]: 'pull' },
    }), now)

    expect(notifications.slice(0, 1).map(n => [iso(n.schedule.at), n.body])).toEqual([
      [tomorrow, expect.stringContaining('Pull')],
    ])
  })

  it('schedules a valid override on a weekly rest day', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const wednesday = new Date(2026, 5, 3)
    const notifications = buildReminderNotifications(state({ dayPlan: { [iso(wednesday)]: 'legs' } }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(wednesday) && n.body.includes('Legs'))).toBe(true)
  })

  it('suppresses dates that already have a completed workout', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const notifications = buildReminderNotifications(state({
      week: { 1: 'push' }, workouts: [{ d: iso(now) }],
    }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(now))).toBe(false)
  })

  it("skips today's reminder after the configured local time has passed", () => {
    const now = new Date(2026, 5, 1, 9, 0) // Monday
    const notifications = buildReminderNotifications(state({ week: { 1: 'push' } }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(now))).toBe(false)
    expect(notifications.some(n => iso(n.schedule.at) === iso(new Date(2026, 5, 8)))).toBe(true)
  })

  it('names both routines of a combined day, and reads a legacy scalar day the same', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const combined = buildReminderNotifications(state({ week: { 1: ['push', 'pull'] } }), now)[0]
    expect(combined.body).toContain('Push + Pull')

    const legacy = buildReminderNotifications(state({ week: { 1: 'push' } }), now)[0]
    expect(legacy.body).toContain('Push')
  })

  it('falls back to a count for three or more routines on one day', () => {
    const now = new Date(2026, 5, 1, 7, 0)
    const n = buildReminderNotifications(state({ week: { 1: ['push', 'pull', 'legs'] } }), now)[0]
    expect(n.body).toContain('3 routines')
  })

  it("a coach week's next session is reminded every day until it is done, with no weekday behind it", () => {
    const now = new Date(2026, 8, 7, 7, 0)   // Monday 07:00, before the 08:00 reminder
    const queue = { ids: ['push', 'pull'], since: 0, startsOn: iso(now), label: 'US W1' }
    const notifications = buildReminderNotifications(state({ week: {}, queue }), now)
    expect(notifications.length).toBeGreaterThanOrEqual(3)
    expect(notifications.every(n => n.body.includes('Push'))).toBe(true)
    expect(notifications[0].schedule.at.getDate()).toBe(7)
    expect(notifications[1].schedule.at.getDate()).toBe(8)
    // …and nothing before the week starts; the weekday plan speaks for those days.
    const waiting = buildReminderNotifications(state({ week: { 2: 'legs' }, queue: { ...queue, startsOn: iso(new Date(2026, 8, 9)) } }), now)
    expect(waiting[0].body).toContain('Legs')            // Tue: weekday plan
    expect(waiting[1].body).toContain('Push')            // Wed: startsOn — the queue takes over
  })
})

describe('buildCustomReminderNotifications', () => {
  const rem = (id, time, over = {}) => ({ id, text: 'Log food', time, days: [], on: true, link: null, skipIfLogged: false, t: 1, ...over })
  const S = (reminders, over = {}) => ({ reminders, ...over })
  const monday7 = new Date(2026, 5, 1, 7, 0)

  it('schedules each ringing day of the next two weeks as a dated one-off, nearest first', () => {
    const n = buildCustomReminderNotifications(S([rem('a', '13:00', { days: [1, 4] })]), monday7)
    expect(n.map(x => iso(x.schedule.at))).toEqual([iso(monday7), iso(new Date(2026, 5, 4)), iso(new Date(2026, 5, 8)), iso(new Date(2026, 5, 11))])
    expect(n[0].schedule.at.getHours()).toBe(13)
    expect(n[0].schedule.allowWhileIdle).toBe(true)
    expect(n[0].title).toBe('Log food')
    expect(n.map(x => x.id)).toEqual([0, 1, 2, 3].map(i => CUSTOM_REMINDER_ID_BASE + i))
  })

  it('every day when no weekday is picked, and not at a time already past', () => {
    const n = buildCustomReminderNotifications(S([rem('a', '06:30')]), monday7)
    expect(n).toHaveLength(13)
    expect(iso(n[0].schedule.at)).toBe(iso(new Date(2026, 5, 2)))
  })

  it('carries the section address for the tap, and none for a plain reminder', () => {
    const n = buildCustomReminderNotifications(S([rem('a', '13:00', { link: 'nutrition' }), rem('b', '14:00')]), monday7)
    expect(n[0].extra).toEqual({ url: '#/nutrition' })
    expect(n[1].extra).toEqual({})
  })

  it('"skip if already logged" drops today when today has an entry, and only today', () => {
    const logged = { nutrition: { log: [{ id: 'e', d: iso(monday7) }], days: {} } }
    const n = buildCustomReminderNotifications(S([rem('a', '13:00', { link: 'nutrition', skipIfLogged: true })], logged), monday7)
    expect(iso(n[0].schedule.at)).toBe(iso(new Date(2026, 5, 2)))
    const plain = buildCustomReminderNotifications(S([rem('a', '13:00', { link: 'nutrition' })], logged), monday7)
    expect(iso(plain[0].schedule.at)).toBe(iso(monday7))
  })

  it('leaves out reminders that are off, deleted or unreadable, and never exceeds its share', () => {
    expect(buildCustomReminderNotifications(S([rem('a', '13:00', { on: false }), { id: 'b', x: true, t: 1 }, rem('c', 'noon'), null]), monday7)).toEqual([])
    expect(buildCustomReminderNotifications({}, monday7)).toEqual([])
    const many = Array.from({ length: 6 }, (_, i) => rem('r' + i, `1${i}:00`))
    const n = buildCustomReminderNotifications(S(many), monday7)
    expect(n).toHaveLength(CUSTOM_REMINDER_MAX)
    expect(new Set(n.map(x => x.id)).size).toBe(CUSTOM_REMINDER_MAX)
    expect(n.at(-1).id).toBe(CUSTOM_REMINDER_ID_BASE + CUSTOM_REMINDER_MAX - 1)
    // the nearest are kept: nothing scheduled is later than something left out
    expect(iso(n.at(-1).schedule.at)).toBe(iso(new Date(2026, 5, 5)))
  })

  it('a reminder with no words of its own still has a title', () => {
    expect(buildCustomReminderNotifications(S([rem('a', '13:00', { text: '' })]), monday7)[0].title).toBe('Reminder')
  })
})

describe('pendingNotifications', () => {
  const rem = (id, time) => ({ id, text: 'Log food', time, days: [], on: true, link: null, skipIfLogged: false, t: 1 })
  const now = new Date(2026, 5, 1, 7, 0)   // Monday 07:00

  it('the three kinds never share an id', () => {
    const S = state({ week: { 1: ['push'], 2: ['pull'], 3: ['legs'], 4: ['push'], 5: ['pull'] }, reminder: { on: true, time: '08:00', nudge: true },
      reminders: [rem('a', '13:00'), rem('b', '14:00')], workouts: [{ id: 'w0', d: '2026-05-29', start: 1, entries: [] }] })
    const nudges = buildNudgeNotifications(S, now)
    expect(nudges.length).toBeGreaterThan(0)
    const all = [...buildReminderNotifications(S, now), ...nudges, ...buildCustomReminderNotifications(S, now)]
    expect(new Set(all.map(n => n.id)).size).toBe(all.length)
  })

  it('stays within the budget, the person\'s own reminders first and the nearest workout days kept', () => {
    const S = state({ week: { 0: ['push'], 1: ['push'], 2: ['pull'], 3: ['legs'], 4: ['push'], 5: ['pull'], 6: ['legs'] },
      reminders: Array.from({ length: 6 }, (_, i) => rem('r' + i, `1${i}:00`)) })
    const n = pendingNotifications(S, now)
    expect(n).toHaveLength(PENDING_BUDGET)
    expect(n.slice(0, CUSTOM_REMINDER_MAX).every(x => x.id >= CUSTOM_REMINDER_ID_BASE)).toBe(true)
    const days = n.filter(x => x.id < CUSTOM_REMINDER_ID_BASE)
    expect(days[0].schedule.at.getDate()).toBe(1)
    expect(days).toHaveLength(PENDING_BUDGET - CUSTOM_REMINDER_MAX)
  })
})
