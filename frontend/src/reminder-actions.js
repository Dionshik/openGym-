/* Every write to the person's own reminders (lib/reminders.js has the rules).
 *
 * Each one also stamps the timezone the reminders ring by — S.reminder.tz, the field the
 * workout-day reminder already keeps — because the server reads the clock in that zone and a
 * profile that never switched the workout reminder on has none stored. On the native app the
 * store reschedules the phone's local notifications after every write (lib/mobile.js).
 */
import { useStore, DEF } from './store/useStore.js'
import { localTZ, uid } from './lib/format.js'
import { saveReminder, removeReminder } from './lib/reminders.js'

const stampZone = s => { s.reminder = { ...(s.reminder || DEF.reminder), tz: localTZ() } }

/** Adds a reminder or changes the one with `raw.id`. Returns false when it could not be saved. */
export function putReminder(raw) {
  let ok = false
  useStore.getState().update(s => {
    const next = saveReminder(s, raw, { id: uid() })
    if (!next) return
    s.reminders = next
    stampZone(s)
    ok = true
  })
  return ok
}
export const toggleReminder = (r, on) => putReminder({ ...r, on })
export const deleteReminder = id => useStore.getState().update(s => { s.reminders = removeReminder(s, id) })
