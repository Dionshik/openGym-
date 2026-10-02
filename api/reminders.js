/* Reminders a member wrote themselves: "log your food" at 13:00 on weekdays.
 *
 * They live in the profile's own state (`S.reminders`), written by the app like everything else
 * there; the server only reads them, on the same tick that sends the workout-day reminder, and
 * sends a push when one is due. This file is the part of that which can be tested without a
 * clock or a socket: reading the list out of a state file that answers to nobody, deciding what
 * is due, and remembering what was already sent.
 *
 *   The list is read defensively. PUT /api/data stores `reminders` unexamined, and a file from an
 *   older client, a hand-edited backup or a bug must cost that one profile its reminders, never
 *   the tick. cleanReminders returns only rows it fully understands and throws on nothing.
 *
 *   What was sent is kept in a file of its own, reminder-log.json — the server never writes a
 *   profile's state, which the app PUTs back whole. One entry per profile, replaced when that
 *   profile's local date changes, so it never grows. Written before the send, like the day
 *   reminder's marker: a failed send is not retried, and a restart inside the 15-minute window
 *   does not send twice.
 *
 *   The address a notification opens is looked up from `link` in LINK_URL. Nothing a member typed
 *   ever becomes a URL.
 *
 * frontend/src/lib/reminders.js writes the rows this reads; reminders-parity.test.js over there
 * holds the two to the same links and limits.
 */
import fs from 'node:fs';
import path from 'node:path';

export const LINKS = ['nutrition', 'body', 'weight', 'photos'];
export const LINK_URL = { nutrition: '#/nutrition', body: '#/body?do=measure', weight: '#/body?do=weigh', photos: '#/body?do=photo' };
export const MAX_REMINDERS = 20;
export const MAX_TEXT = 120;

const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The reminders of a state that are switched on and make sense — at most MAX_REMINDERS. */
export function cleanReminders(S) {
  const list = record(S) && Array.isArray(S.reminders) ? S.reminders : [];
  const out = [];
  const seen = new Set();
  for (const r of list) {
    if (out.length >= MAX_REMINDERS) break;
    if (!record(r) || r.x || r.on !== true) continue;
    if (typeof r.id !== 'string' || !ID.test(r.id) || seen.has(r.id)) continue;
    if (typeof r.time !== 'string' || !TIME.test(r.time)) continue;
    const days = Array.isArray(r.days) ? [...new Set(r.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
    const link = LINKS.includes(r.link) ? r.link : null;
    seen.add(r.id);
    out.push({
      id: r.id, time: r.time, days, link,
      text: typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '',
      skipIfLogged: r.skipIfLogged === true && !!link,
      t: Number.isFinite(r.t) ? r.t : 0
    });
  }
  return out;
}

/**
 * Which of `list` are owed right now: on a weekday they are set for (none set = every day), from
 * their minute up to `windowMin` minutes after it on the same local date, and not sent yet.
 * `now` is { date, hhmm, weekday } on the member's clock; `sent` is that date's keys.
 *
 * `nowMs`, when given, is the same instant as epoch milliseconds. It keeps the catch-up window
 * from firing a reminder that was written after its time: created, switched on or moved at 13:10
 * to "13:00" or "13:05", it is for tomorrow, not owed at once. The window exists for a server
 * that was down at 13:00, not for an appointment that did not exist then.
 * @returns {{ r: object, key: string }[]}
 */
export function dueReminders(list, now, sent = [], windowMin = 15, nowMs = null) {
  if (!now || typeof now.hhmm !== 'string' || !TIME.test(now.hhmm)) return [];
  const at = minutes(now.hhmm);
  const out = [];
  for (const r of list) {
    if (r.days.length && !r.days.includes(now.weekday)) continue;
    const late = at - minutes(r.time);
    if (!(late >= 0 && late <= windowMin)) continue;
    // Every zone in use is a whole number of minutes from UTC, so the minute boundary of the
    // epoch clock is the minute boundary of the member's clock too.
    if (Number.isFinite(nowMs) && r.t > Math.floor(nowMs / 60000) * 60000 - late * 60000) continue;
    // The time is part of the key: a reminder moved from 13:00 to 14:00 after it fired is a new
    // appointment, and is kept.
    const key = `${r.id}@${r.time}`;
    if (!sent.includes(key)) out.push({ r, key });
  }
  return out;
}

/** Whether the thing a reminder is about was already done on `date` — it then stays quiet. */
export function loggedOn(S, link, date, hasPhoto) {
  if (!record(S)) return false;
  const onDay = v => Array.isArray(v) && v.some(e => record(e) && e.d === date);
  if (link === 'nutrition') return onDay(S.nutrition?.log) || (record(S.nutrition?.days) && record(S.nutrition.days[date]));
  if (link === 'weight') return onDay(S.bodyweight);
  if (link === 'body') return onDay(S.measurements);
  if (link === 'photos') return typeof hasPhoto === 'function' && hasPhoto(date) === true;
  return false;
}

/** What was sent today, per profile: { [uid]: { d, keys } } in reminder-log.json. */
export function createReminderLog({ dataDir, atomicWrite }) {
  const file = path.join(dataDir, 'reminder-log.json');
  let log = {};
  try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); if (record(raw)) log = raw; } catch { /* nothing sent yet */ }
  const save = () => atomicWrite(file, JSON.stringify(log), 0o600);
  return {
    sent: (uid, date) => (record(log[uid]) && log[uid].d === date && Array.isArray(log[uid].keys) ? log[uid].keys : []),
    mark(uid, date, key) {
      if (!record(log[uid]) || log[uid].d !== date || !Array.isArray(log[uid].keys)) log[uid] = { d: date, keys: [] };
      if (!log[uid].keys.includes(key)) log[uid].keys.push(key);
      save();
    },
    dropUser(uid) { if (uid in log) { delete log[uid]; save(); } }
  };
}
