/* Reminders a person writes for themselves: "log your food" at 13:00 on weekdays.
 *
 * S.reminders is a list of
 *   { id, text, time: 'HH:MM', days: [0..6], on, link, skipIfLogged, t, x? }
 *     days          getDay() indices; none = every day
 *     link          the section it is about — 'nutrition' | 'weight' | 'body' | 'photos' | null.
 *                   A tap on the notification opens that section.
 *     skipIfLogged  stay quiet on a day when that section already has an entry
 *     t             when the row was last changed; decides between two devices
 *     x             deleted — kept for a while so the other device's copy does not bring it back
 *
 * Who delivers them depends on the build. In a browser the server does (api/reminders.js reads
 * this list on its tick and sends a Web Push); in the native app the phone does, from local
 * notifications lib/mobile.js schedules. Both read the rows the same way, which is why the
 * reading rules live here as pure functions and reminders-parity.test.js compares them with the
 * server's.
 *
 * The timezone is not stored per reminder: it is S.reminder.tz, the one the workout-day
 * reminder already keeps current (see stampZone).
 */

export const LINKS = ['nutrition', 'weight', 'body', 'photos']
// Where a tap on the notification lands, per link — the same table the server sends from
// (api/reminders.js). lib/deeplink.js decides whether an address may be followed at all.
export const LINK_URL = { nutrition: '#/nutrition', body: '#/body?do=measure', weight: '#/body?do=weigh', photos: '#/body?do=photo' }
export const MAX_REMINDERS = 20
export const MAX_TEXT = 120
const TOMB_DAYS = 45
const DAY = 86400000
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const ID = /^[A-Za-z0-9_-]{1,40}$/
const list = v => (Array.isArray(v) ? v : [])
const record = x => !!x && typeof x === 'object' && !Array.isArray(x)

export const cleanText = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '')
export const cleanDays = v => [...new Set(list(v).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)

/** Every reminder that was not deleted, in the order they were written. */
export const remindersOf = S => list(S?.reminders).filter(r => record(r) && typeof r.id === 'string' && !r.x)
/** The ones that will actually be delivered: switched on, with a time that parses. */
export const activeReminders = S => remindersOf(S).filter(r => r.on === true && ID.test(r.id) && TIME.test(r.time || '')).slice(0, MAX_REMINDERS)
export const canAddReminder = S => remindersOf(S).length < MAX_REMINDERS

/**
 * Adds a reminder, or changes the one with `raw.id`. Returns the new list, or null when the row
 * is not one a reminder can be made from (no time) or the list is full.
 */
export function saveReminder(S, raw, { id, now = Date.now() } = {}) {
  if (!TIME.test(raw?.time || '')) return null
  const link = LINKS.includes(raw.link) ? raw.link : null
  const row = {
    id: raw.id || id, text: cleanText(raw.text), time: raw.time, days: cleanDays(raw.days),
    on: raw.on !== false, link, skipIfLogged: !!raw.skipIfLogged && !!link, t: now
  }
  if (!ID.test(row.id || '')) return null
  const all = prune(list(S?.reminders), now)
  const at = all.findIndex(r => record(r) && r.id === row.id)
  if (at < 0 && remindersOf({ reminders: all }).length >= MAX_REMINDERS) return null
  return at < 0 ? [...all, row] : all.map((r, i) => (i === at ? row : r))
}

/** Deletes a reminder: the row stays as a marker (`x`) so a merge does not resurrect it. */
export function removeReminder(S, id, { now = Date.now() } = {}) {
  return prune(list(S?.reminders), now).map(r => (record(r) && r.id === id ? { id: r.id, x: true, t: now } : r))
}

// Markers of deleted reminders older than this have done their job on every device that syncs.
const prune = (rows, now) => rows.filter(r => record(r) && !(r.x && now - (r.t || 0) > TOMB_DAYS * DAY))

/** Two copies of the list: per id, the row changed later — including a deletion. */
export function mergeReminders(a, b) {
  const byId = new Map()
  for (const r of [...list(a), ...list(b)]) {
    if (!record(r) || typeof r.id !== 'string') continue
    const cur = byId.get(r.id)
    if (!cur || (r.t || 0) > (cur.t || 0)) byId.set(r.id, r)
  }
  return [...byId.values()]
}

/** Whether the section a reminder points at already has an entry on `date`. */
export function loggedOn(S, link, date, hasPhoto) {
  const onDay = v => list(v).some(e => record(e) && e.d === date)
  if (link === 'nutrition') return onDay(S?.nutrition?.log) || (record(S?.nutrition?.days) && record(S.nutrition.days[date]))
  if (link === 'weight') return onDay(S?.bodyweight)
  if (link === 'body') return onDay(S?.measurements)
  if (link === 'photos') return typeof hasPhoto === 'function' && hasPhoto(date) === true
  return false
}

/** Does the reminder ring on this weekday (a getDay() index)? */
export const ringsOn = (r, weekday) => !list(r.days).length || r.days.includes(weekday)

/**
 * The days a reminder rings on, for its one-line summary: 'daily', 'weekdays' (Mon–Fri),
 * 'weekend', or { days: [...] } in the profile's week order.
 */
export function daysSummary(r, order = [1, 2, 3, 4, 5, 6, 0]) {
  const days = cleanDays(r?.days)
  if (!days.length || days.length === 7) return 'daily'
  if (days.join() === '1,2,3,4,5') return 'weekdays'
  if (days.join() === '0,6') return 'weekend'
  return { days: order.filter(d => days.includes(d)) }
}
