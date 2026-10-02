/* The app writes reminders, the server reads them. The api container shares no build step with
 * the frontend, so the rules exist twice — lib/reminders.js here and api/reminders.js there —
 * and this holds them together: a row the app can write must be one the server sends, the two
 * must agree on which reminders count and on what "already logged" means, and a tap must open
 * the address the server put in the notification. Runs under vitest, which can load both.
 */
import { describe, it, expect } from 'vitest'
import * as server from '../../../api/reminders.js'
import * as app from './reminders.js'
import { safeRoute } from './deeplink.js'

describe('the app and the server read reminders alike', () => {
  it('the same sections, addresses and limits', () => {
    expect([...app.LINKS].sort()).toEqual([...server.LINKS].sort())
    expect(app.LINK_URL).toEqual(server.LINK_URL)
    expect(app.MAX_REMINDERS).toBe(server.MAX_REMINDERS)
    expect(app.MAX_TEXT).toBe(server.MAX_TEXT)
  })
  it('every address the server can send is one a tap is allowed to follow', () => {
    for (const l of server.LINKS) expect(safeRoute(server.LINK_URL[l]), l).toBe(server.LINK_URL[l].slice(1))
  })
  it('what the app saves, the server delivers — field for field', () => {
    let S = {}
    const rows = [
      { text: '  Log   food ', time: '13:00', days: [5, 1, 3], link: 'nutrition', skipIfLogged: true },
      { text: 'x'.repeat(300), time: '07:05', days: [], link: null, skipIfLogged: true },
      { text: '', time: '23:59', days: [0, 6], link: 'photos' }
    ]
    rows.forEach((raw, i) => { S = { reminders: app.saveReminder(S, raw, { id: 'r' + i, now: 1000 + i }) } })
    const fromServer = server.cleanReminders(S)
    expect(fromServer.map(r => r.id)).toEqual(app.activeReminders(S).map(r => r.id))
    for (const r of fromServer) {
      const mine = S.reminders.find(x => x.id === r.id)
      expect(r).toEqual({ id: mine.id, time: mine.time, days: mine.days, link: mine.link, text: mine.text, skipIfLogged: mine.skipIfLogged, t: mine.t })
    }
  })
  it('switched off, deleted and broken rows are nobody\'s reminder', () => {
    const S = { reminders: [
      { id: 'a', text: 't', time: '13:00', days: [], on: true, t: 1 },
      { id: 'b', text: 't', time: '13:00', days: [], on: false, t: 1 },
      { id: 'c', x: true, t: 1 },
      { id: 'd', text: 't', time: '1300', days: [], on: true, t: 1 },
      { id: 'has space', text: 't', time: '13:00', days: [], on: true, t: 1 },
      null, 'x'
    ] }
    expect(server.cleanReminders(S).map(r => r.id)).toEqual(['a'])
    expect(app.activeReminders(S).map(r => r.id)).toEqual(['a'])
  })
  it('"already logged today" means the same on both sides', () => {
    const D = '2026-10-07'
    const states = [
      {}, { nutrition: { log: [{ id: 'e', d: D }], days: {} } }, { nutrition: { log: [], days: { [D]: { k: 1 } } } },
      { nutrition: { log: [{ id: 'e', d: '2026-10-06' }] } }, { bodyweight: [{ d: D, w: 80 }] }, { measurements: [{ d: D, waist: 90 }] },
      { nutrition: 'x', bodyweight: {}, measurements: [null] }
    ]
    for (const S of states) for (const l of [...app.LINKS, null]) {
      for (const hasPhoto of [undefined, () => true, () => false]) {
        expect(app.loggedOn(S, l, D, hasPhoto), JSON.stringify([S, l])).toBe(server.loggedOn(S, l, D, hasPhoto))
      }
    }
  })
  it('a weekday the app says it rings on is one the server sends on', () => {
    const S = { reminders: app.saveReminder({}, { text: 't', time: '13:00', days: [1, 4] }, { id: 'a', now: 1 }) }
    const [r] = server.cleanReminders(S)
    for (let wd = 0; wd < 7; wd++) {
      const due = server.dueReminders([r], { date: '2026-10-07', hhmm: '13:00', weekday: wd }).length === 1
      expect(due, 'weekday ' + wd).toBe(app.ringsOn(S.reminders[0], wd))
    }
  })
  it('a reminder switched on after its time is for tomorrow on both sides', () => {
    // 13:10 on the member's clock; the reminder is for 13:00 and was switched on at 13:04
    const at = (h, m) => Date.UTC(2026, 9, 7, h, m)
    const S = { reminders: app.saveReminder({}, { text: 't', time: '13:00', days: [] }, { id: 'a', now: at(13, 4) }) }
    const [r] = server.cleanReminders(S)
    expect(server.dueReminders([r], { date: '2026-10-07', hhmm: '13:10', weekday: 3 }, [], 15, at(13, 10))).toEqual([])
    // the same reminder written in the morning is still owed at 13:10
    const early = server.cleanReminders({ reminders: app.saveReminder({}, { text: 't', time: '13:00', days: [] }, { id: 'a', now: at(8, 0) }) })
    expect(server.dueReminders(early, { date: '2026-10-07', hhmm: '13:10', weekday: 3 }, [], 15, at(13, 10))).toHaveLength(1)
  })
})
