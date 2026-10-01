/* "What should I eat?" without asking anyone: portions of foods the user already eats that fit
 * what is left of today's target.
 *
 * Deliberately arithmetic, not advice. It takes the foods logged most often and the user's own
 * products, pairs a protein source with a carbohydrate source (or takes a dish on its own), and
 * sizes the portions so the meal lands on the protein and energy still open — one meal's worth,
 * not the whole remainder at once. The AI version (api/coach/core/food.js) can be more
 * imaginative; this one always works, offline, and never names a food the user has not eaten.
 */

const r1 = n => Math.round(n * 10) / 10
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const round10 = g => Math.max(10, Math.round(g / 10) * 10)
const MAX_PORTION = 300      // of any one food: more than that is not a serving, it is the arithmetic showing
const MAX_REPEATS = 2        // ideas one food may appear in — four meals of the same rice are one idea

/** 'protein' | 'carb' | 'fat' | 'mixed' — by where a food's energy comes from. */
export function kindOf(per100) {
  const k = Math.max(1, 4 * per100.p + 4 * per100.c + 9 * per100.f)
  if (4 * per100.p / k >= 0.4) return 'protein'
  if (9 * per100.f / k >= 0.6) return 'fat'
  if (4 * per100.c / k >= 0.55) return 'carb'
  return 'mixed'
}

/** One meal's share of what is left: at most about a third of the day, at least a snack. */
export function mealBudget(remaining, target) {
  const k = clamp(remaining.k, 0, Math.max(300, (target?.kcal || 2000) * 0.35))
  const share = remaining.k > 0 ? k / remaining.k : 0
  return { k: Math.round(k), p: r1(Math.max(0, remaining.p) * share), f: r1(Math.max(0, remaining.f) * share), c: r1(Math.max(0, remaining.c) * share) }
}

const totalOf = items => items.reduce((a, x) => ({ k: a.k + x.k, p: r1(a.p + x.p), f: r1(a.f + x.f), c: r1(a.c + x.c) }), { k: 0, p: 0, f: 0, c: 0 })
const portion = (food, g) => {
  const q = g / 100
  return { n: food.n, ref: food.ref || null, per100: food.per100, g, k: Math.round(food.per100.k * q), p: r1(food.per100.p * q), f: r1(food.per100.f * q), c: r1(food.per100.c * q) }
}

/**
 * Up to `limit` ideas, best fit first: [{ items: [{ n, g, per100, ref, k, p, f, c }], k, p, f, c }].
 *   remaining  { k, p, f, c } still open today (lib/nutrition.js remaining)
 *   foods      [{ n, per100, ref?, g? }] — frequentFoods / my products, anything with per-100 g values
 * An empty list means there is nothing sensible left to fit (the day is full) or nothing to fit it with.
 */
export function suggestFromOwn(remaining, foods, { target = null, limit = 5 } = {}) {
  if (!remaining || remaining.k < 80) return []
  const pool = foods.filter(f => f && f.per100 && f.per100.k > 0).map(f => ({ ...f, kind: kindOf(f.per100) }))
  const want = mealBudget(remaining, target)
  const ideas = []
  const push = items => {
    const parts = items.filter(x => x.g >= 10)
    if (!parts.length) return
    const sum = totalOf(parts)
    // How far the meal is from the budget: energy first, protein nearly as much, and a meal
    // that spends more fat than is left is marked down — fat is the macro that runs out unnoticed.
    const miss = Math.abs(sum.k - want.k) / Math.max(want.k, 1)
      + 0.8 * Math.abs(sum.p - want.p) / Math.max(want.p, 10)
      + (sum.f > remaining.f + 5 ? 0.5 : 0)
      + (sum.k > remaining.k + 50 ? 1 : 0)
    ideas.push({ items: parts, ...sum, miss, key: parts.map(x => x.n).sort().join('|') })
  }

  const proteins = pool.filter(f => f.kind === 'protein'), carbs = pool.filter(f => f.kind === 'carb')
  for (const a of proteins) {
    for (const b of carbs) {
      // Two unknown weights, two wishes — the meal's protein and its energy (per gram):
      //   pa·x + pb·y = P     ka·x + kb·y = K
      const pa = a.per100.p / 100, pb = b.per100.p / 100, ka = a.per100.k / 100, kb = b.per100.k / 100
      const det = pa * kb - pb * ka
      if (Math.abs(det) < 1e-6) continue
      const x = (want.p * kb - pb * want.k) / det, y = (pa * want.k - want.p * ka) / det
      if (x <= 0 || y <= 0) continue
      push([portion(a, round10(clamp(x, 30, MAX_PORTION))), portion(b, round10(clamp(y, 30, MAX_PORTION)))])
    }
  }
  // A single food sized to the energy: dishes ("mixed"), and a protein source alone when the
  // day is short of protein but nearly out of energy.
  for (const f of pool) {
    if (f.kind === 'fat') continue
    const g = f.kind === 'protein' && want.p > 0 ? Math.min(want.p / f.per100.p, want.k / f.per100.k) * 100 : want.k / f.per100.k * 100
    push([portion(f, round10(clamp(g, 30, MAX_PORTION)))])
  }

  const seen = new Set(), uses = new Map(), out = []
  for (const idea of ideas.sort((p, q) => p.miss - q.miss)) {
    if (out.length >= limit) break
    if (seen.has(idea.key) || idea.items.some(x => (uses.get(x.n) || 0) >= MAX_REPEATS)) continue
    seen.add(idea.key)
    idea.items.forEach(x => uses.set(x.n, (uses.get(x.n) || 0) + 1))
    const { miss, key, ...rest } = idea
    out.push(rest)
  }
  return out
}
