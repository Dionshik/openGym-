/* Where a tapped notification may take the app.
 *
 * A push payload and a local notification can each carry an address (`url`, e.g.
 * '#/nutrition'). It arrives from outside the page — the service worker hands over whatever the
 * push contained — so it is not navigated to as given: it is matched against the routes a
 * notification is allowed to open, and anything else opens nothing in particular. The server
 * builds these from a fixed table (api/reminders.js LINK_URL) and never from what a member
 * typed; this is the same rule held from the receiving end.
 */

/**
 * Whether a navigate message from the service worker is a second copy of what the app already
 * did. A tap that has to start the app opens it at the address AND leaves the address with the
 * worker, for a browser that starts the app at its front page regardless; the worker marks that
 * kept copy `replay`. If the app did start at that address, following the copy would act on one
 * tap twice — a second identical sheet on top of the first.
 */
export const isRepeat = (msg, bootHash) => !!msg && msg.replay === true && typeof msg.url === 'string' && msg.url === bootHash

const ROUTES = ['/nutrition', '/body', '/coach', '/stats', '/plan', '/']
const DO = ['weigh', 'measure', 'photo']

/**
 * '#/body?do=weigh' → '/body?do=weigh'. Returns the path for the router, or null for an address
 * that is not one of ours.
 */
export function safeRoute(url) {
  if (typeof url !== 'string' || url.length > 80 || !url.startsWith('#/')) return null
  const [path, query = ''] = url.slice(1).split('?')
  if (!ROUTES.includes(path)) return null
  if (!query) return path
  const m = /^do=([a-z]+)$/.exec(query)
  return m && DO.includes(m[1]) && path === '/body' ? `${path}?do=${m[1]}` : path
}
