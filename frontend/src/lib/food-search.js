/* Finding a food to log: my own products, what I logged recently, and the built-in list.
 *
 * Deliberately small. A diary search is typed with one thumb between sets or at the table, in
 * Russian as often as not, and the query is rarely the dictionary form: "гречку", "курицу",
 * "творога". So a word matches when it starts the same — with the last couple of letters of a
 * longer word left out of the comparison — and nothing cleverer than that.
 */

const fold = s => String(s || '').toLowerCase().replace(/ё/g, 'е').normalize('NFD').replace(/\p{M}+/gu, '')
/** Lower-cased words of a string, ё folded into е and accents dropped. */
export const words = s => fold(s).split(/[^\p{L}\p{N}%]+/u).filter(Boolean)

// What is compared for a query word: all of a short one, a long one minus its ending
// ("гречку" → "греч", which "гречка" and "гречневая" both start with).
const stem = w => (w.length >= 5 ? w.slice(0, w.length - 2) : w.length === 4 ? w.slice(0, 3) : w)

/** 8–14 digits and nothing else is a barcode, not a name. */
export const barcodeOf = q => { const s = String(q || '').replace(/[\s-]/g, ''); return /^\d{8,14}$/.test(s) ? s : null }

/** A built-in row as an object, named in the user's language when there is such a name. */
export function foodFromRow(row, lang = 'en') {
  const [id, ru, en, k, p, f, c, al, sv] = row
  return { id, n: lang === 'ru' ? ru : en, alt: lang === 'ru' ? en : ru, k, p, f, c, al, sv: sv || 0 }
}

// How well `hay` (the words of a name and its aliases) answers the query words; 0 = not at all.
function score(q, nameWords, extraWords) {
  let total = 0
  for (const w of q) {
    const st = stem(w)
    let best = 0
    for (const h of nameWords) best = Math.max(best, h === w ? 10 : h.startsWith(w) ? 7 : h.startsWith(st) ? 5 : 0)
    if (best < 5) for (const h of extraWords) best = Math.max(best, h === w ? 4 : h.startsWith(st) ? 3 : 0)
    if (!best) return 0
    total += best
  }
  // Fewer words left unexplained is a closer answer: "рис" should find rice before rice noodles.
  return total * 10 - Math.max(0, nameWords.length - q.length)
}

/**
 * Candidates for a typed query, best first.
 *   own     my products          [{ id, n, brand?, k, p, f, c, sv? }]
 *   recent  recentFoods(nut)     [{ key, n, g, per100, fixed, r }]
 *   generic the built-in rows    [[id, ru, en, k, p, f, c, aliases, sv]]
 * Each result: { kind, key, n, sub?, per100 | null, fixed?, g, ref }. An empty query lists the
 * recent ones, then my products — the two lists worth showing before a letter is typed.
 */
export function searchFoods(query, { own = [], recent = [], generic = [], lang = 'en', limit = 30 } = {}) {
  const q = words(query)
  const out = []
  const seen = new Set()
  const add = (rank, item) => { if (!seen.has(item.key)) { seen.add(item.key); out.push({ rank, ...item }) } }

  const recentItem = r => ({ kind: 'recent', key: r.key, n: r.n, per100: r.per100, fixed: r.fixed || null, g: r.g || 0, ref: r.r || null })
  const ownItem = f => ({ kind: 'own', key: 'o:' + f.id, n: f.n, sub: f.brand || '', per100: { k: f.k, p: f.p, f: f.f, c: f.c }, g: f.sv || 100, ref: 'o:' + f.id })

  if (!q.length) {
    recent.forEach((r, i) => add(1000 - i, recentItem(r)))
    own.forEach((f, i) => add(500 - i, ownItem(f)))
    return out.slice(0, limit)
  }
  for (const r of recent) {
    const s = score(q, words(r.n), [])
    if (s) add(s + 20, recentItem(r))
  }
  for (const f of own) {
    const s = score(q, words(f.n), words(f.brand))
    if (s) add(s + 30, ownItem(f))
  }
  for (const row of generic) {
    const f = foodFromRow(row, lang)
    const s = score(q, words(f.n), [...words(f.alt), ...words(f.al)])
    if (s) add(s, { kind: 'generic', key: 'g:' + f.id, n: f.n, per100: { k: f.k, p: f.p, f: f.f, c: f.c }, g: f.sv || 100, ref: 'g:' + f.id })
  }
  return out.sort((a, b) => b.rank - a.rank || a.n.length - b.n.length).slice(0, limit)
}

let cached = null
/** The built-in list, fetched on first use: 47 KB nobody needs until they open the diary. */
export const loadFoods = () => (cached ||= import('./foods-data.js').then(m => m.FOODS))
