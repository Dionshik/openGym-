/* Looking a packaged product up online — by the digits under its barcode, or by name.
 *
 * The app never talks to the food database itself: the request goes to this instance's own
 * server, which asks Open Food Facts on the user's behalf and keeps a cache (api/food.js). That
 * is one outgoing address for the whole instance instead of every phone's, it survives the
 * database being slow or unreachable from where the phone is, and it only exists at all when
 * the admin switched it on — `config.food.lookup`. Guests, the demo and the offline phone app have
 * no server to ask, so the whole feature is absent for them.
 */
import { api } from './api.js'
import { t } from './i18n.js'

export const onlineAvailable = (config, user) => !!(user && config?.food?.lookup)

/** → the product as a per-100 g row { n, brand?, code, k, p, f, c, sv? }; throws with `.code`. */
export async function lookupBarcode(code) {
  const r = await api('/api/food/barcode', { method: 'POST', body: JSON.stringify({ code }) })
  return r.food
}
/** → up to 20 products for a typed name. Asked for on a button, never per keystroke. */
export async function searchOnline(q, lang) {
  const r = await api('/api/food/search', { method: 'POST', body: JSON.stringify({ q, lang }) })
  return Array.isArray(r.items) ? r.items : []
}

// One sentence a person can act on for each way the lookup can fail (the server's `error`).
export function onlineErrorText(e) {
  const code = e?.data?.error || ''
  if (e && e.status == null) return t('No connection — add it by hand, or try again later.')
  if (code === 'notfound') return t('Not in the database. Add it by hand — it stays in your products.')
  if (code === 'nonutrition') return t('The database has this product but not its nutrition values. Add it by hand.')
  if (code === 'throttled') return t('Too many lookups right now. Try again in a minute.')
  if (code === 'unreachable') return t('The food database is not answering. Add it by hand, or try again later.')
  if (code === 'disabled') return t('Online lookup is switched off on this server.')
  return t('The lookup failed. Add it by hand.')
}
