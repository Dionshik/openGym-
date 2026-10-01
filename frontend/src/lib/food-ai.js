/* What sits between the AI's answer and the diary.
 *
 * The provider is asked three things (api/coach/core/food.js): what is on a plate, what a label
 * says, what to eat next. This file is the app's side of each — whether the feature is there at
 * all, whether the person agreed to it, and how an answer becomes rows the user can edit.
 *
 * The one judgement made here: a model is decent at naming food and poor at remembering what
 * 100 g of it contains, and the app carries a table that is good at exactly that. So when a food
 * the model named is one the built-in table has, the table's numbers are used and the model's
 * are kept only as a cross-check — unless the two disagree wildly, which means the match was
 * the wrong food and the model's own numbers stand.
 */
import { searchFoods, words } from './food-search.js'

export const FOOD_CONSENT_VERSION = 1
/** The go-ahead for sending food photos and descriptions. Its own, apart from the Coach's. */
export const hasFoodConsent = S => !!S?.coach?.foodConsent?.agreedAt && S.coach.foodConsent.version === FOOD_CONSENT_VERSION

/**
 * { available, vision } — is there an AI to ask, and can it be sent a picture?
 * The demo answers from a script; a phone with its own key talks to an API provider, which
 * takes pictures; a server says so itself (`config.coach.food`, `config.coach.vision`).
 */
export function foodAiState({ config, user, coachMode, demo = false, mobile = false } = {}) {
  if (demo) return { available: true, vision: true }
  if (mobile && coachMode === 'byok') return { available: true, vision: true }
  const c = config?.coach
  return c?.enabled && c.food && user ? { available: true, vision: !!c.vision } : { available: false, vision: false }
}

const r1 = n => Math.round(n * 10) / 10

/**
 * The model's reading of a plate, as rows for the draft sheet:
 *   [{ n, g, per100: { k, p, f, c }, ref, src: 'table' | 'ai', conf, fixed }]
 * `src: 'table'` means the numbers are the built-in table's (and `ref` names the row, so the
 * entry groups with that food in "recent"); `fixed` means the model's own numbers contradicted
 * themselves and were corrected on arrival.
 */
export function draftFromMeal(items, { generic = [], lang = 'en' } = {}) {
  return (Array.isArray(items) ? items : []).map(it => {
    const own = { k: it.per100.k, p: it.per100.p, f: it.per100.f, c: it.per100.c }
    const row = { n: it.name, g: it.grams, per100: own, ref: null, src: 'ai', conf: it.conf || 'low', fixed: !!it.per100.fixed }
    // The model's English name against the table's English names, then its local name against
    // the local ones — a match has to be on the food's own name in one language or the other.
    const hit = tableMatch(it.en, generic, 'en') || tableMatch(it.name, generic, lang)
    if (!hit) return row
    // The table and the model within shouting distance: the same food, take the table. Far
    // apart: "rice" matched dry rice, or the plate holds something the name does not say.
    const near = own.k <= 0 || (hit.per100.k >= own.k * 0.6 && hit.per100.k <= own.k * 1.6)
    return near ? { ...row, per100: hit.per100, ref: hit.ref, src: 'table', fixed: false } : row
  })
}
function tableMatch(query, generic, lang) {
  const q = words(query)
  if (!q.length || !generic.length) return null
  const [best] = searchFoods(query, { generic, lang, limit: 1 })
  // Every word of the query has to be found in the food's own name — an alias hit, or half the
  // words, is a neighbour rather than the food.
  return best && best.rank >= q.length * 70 - 20 ? best : null
}

/** The `suggest` request's context, and the way back from the ids in the answer to the foods. */
export function suggestContext({ remaining, target, meal, foods = [], wish = '' }) {
  const byId = new Map()
  const list = []
  foods.filter(f => f && f.per100 && f.per100.k > 0).slice(0, 40).forEach((f, i) => {
    const id = 'f' + i
    byId.set(id, f)
    list.push({ id, name: f.n, kcal100: f.per100.k, p100: f.per100.p, f100: f.per100.f, c100: f.per100.c })
  })
  return {
    byId,
    context: {
      meal, wish: String(wish || '').slice(0, 200),
      remaining: { kcal: remaining.k, p: remaining.p, f: remaining.f, c: remaining.c },
      target: { kcal: target.kcal, p: target.p, f: target.f, c: target.c },
      foods: list
    }
  }
}

/**
 * The model's ideas in the shape suggestFromOwn returns, so one list renders both:
 *   [{ title, why, items: [{ n, g, per100, ref, k, p, f, c }], k, p, f, c }]
 * One of the user's own foods is priced with the user's numbers, whatever the model wrote.
 */
export function ideasFromAi(ideas, byId) {
  return (Array.isArray(ideas) ? ideas : []).map(idea => {
    const items = idea.items.map(it => {
      const mine = it.id ? byId.get(it.id) : null
      const per100 = mine ? mine.per100 : { k: it.per100.k, p: it.per100.p, f: it.per100.f, c: it.per100.c }
      const q = it.grams / 100
      return { n: mine ? mine.n : it.name, g: it.grams, per100, ref: mine?.ref || null, k: Math.round(per100.k * q), p: r1(per100.p * q), f: r1(per100.f * q), c: r1(per100.c * q) }
    }).filter(x => x.n && x.per100.k > 0)
    const sum = items.reduce((a, x) => ({ k: a.k + x.k, p: r1(a.p + x.p), f: r1(a.f + x.f), c: r1(a.c + x.c) }), { k: 0, p: 0, f: 0, c: 0 })
    return { title: idea.title || '', why: idea.why || '', items, ...sum }
  }).filter(i => i.items.length)
}

// The failure classes of a food request, in the app's voice (wrapped in t() where shown).
export const FOOD_ERRORS = {
  off: 'The AI isn’t set up on this instance.',
  consent: 'This needs your go-ahead first.',
  busy: 'The last one is still being read — give it a moment.',
  cap: 'That is enough for today — you can still add food by hand.',
  empty: 'Add a photo or describe the meal first.',
  noimage: 'Add a photo first.',
  badimage: 'That picture could not be read — try another one.',
  toolarge: 'That picture is too large.',
  novision: 'The AI on this instance cannot read pictures. Describe the meal in words instead.',
  timeout: 'The AI took too long and gave up.',
  auth: 'The AI couldn’t sign in to its provider — the instance owner needs to check its setup.',
  missing: 'The AI isn’t installed properly on this instance.',
  provider: 'The AI couldn’t answer — the instance owner needs to check its setup.',
  unusable: 'The AI answered with something the app couldn’t use. Try again, or add it by hand.',
  restart: 'The server restarted while the AI was working. Try again.',
  cancelled: 'Cancelled.',
  network: 'No connection — this needs the server.',
  shared: 'The AI on this instance is set up for one profile only — ask the instance owner.',
  unprivileged: 'The AI is switched off on this instance for safety reasons.',
  internal: 'Something went wrong on the server.'
}
