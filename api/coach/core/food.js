/* The three things the food diary asks a model: what is on this plate, what does this label
 * say, and what could I eat with what is left of today.
 *
 * None of them is coaching, none reads the training log, and none changes anything — the
 * answer is a draft the user edits and confirms. So, like the exercise lookup (match.js), each
 * has a prompt that stands alone, a payload built from the request and nothing else, and its
 * own validator. What the validator returns is the only thing the app will act on, and it is
 * deliberately forgiving about form and strict about substance: a model that estimates is
 * expected to be imprecise, but it does not get to claim 4000 kcal in 100 g, or more than
 * 100 g of macronutrients in 100 g of food. Those are clamped here, not sent back for repair —
 * the repair round is for an answer that has no usable shape at all.
 *
 * Pure: shared by the server (food-jobs.js) and the phone that brings its own key.
 */
import { CONTRACT } from './payload.js';

export const FOOD_KINDS = ['meal', 'label', 'suggest'];
export const MAX_CAPTION = 300;
export const MAX_ITEMS = 12;        // foods read off one plate
export const MAX_IDEAS = 4;
export const MAX_IDEA_ITEMS = 5;
export const MAX_OWN_FOODS = 40;    // of the user's own foods offered to `suggest`
export const MAX_IMAGE_B64 = 1_500_000;   // about 1.1 MB of JPEG — the app sends ~200 KB
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, n) : '');
const num = v => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const r1 = n => Math.round(n * 10) / 10;
const atwater = (p, f, c) => 4 * p + 4 * c + 9 * f;

/**
 * Per-100 g values as food can have them. Macros are clamped and, together, held to 100 g;
 * energy is held to what pure fat carries, and replaced by what the macros add up to when the
 * two disagree by more than a quarter (`fixed` says so). A food with energy and no macros —
 * spirits — keeps its energy: alcohol is not one of the three.
 */
export function cleanPer100({ kcal, p, f, c }) {
  let P = clamp(num(p) ?? 0, 0, 100), F = clamp(num(f) ?? 0, 0, 100), C = clamp(num(c) ?? 0, 0, 100);
  const sum = P + F + C;
  if (sum > 100) { P = P * 100 / sum; F = F * 100 / sum; C = C * 100 / sum; }
  const fromMacros = atwater(P, F, C);
  let k = num(kcal);
  let fixed = false;
  if (k == null || k < 0) { k = fromMacros; fixed = k > 0; }
  k = clamp(k, 0, 900);
  if (fromMacros > 20 && Math.abs(k - fromMacros) > Math.max(15, fromMacros * 0.25)) { k = fromMacros; fixed = true; }
  return { k: Math.round(clamp(k, 0, 900)), p: r1(P), f: r1(F), c: r1(C), ...(fixed ? { fixed: true } : {}) };
}

/* ------------------------------ requests ------------------------------ */

/** What the user typed beside a photo, or instead of one. Data for the model, never rules. */
export const cleanCaption = v => str(v, MAX_CAPTION);

/** The `suggest` context as the client sent it, reduced to numbers and short names. */
export function cleanSuggestContext(ctx) {
  const c = isObj(ctx) ? ctx : {};
  const macros = o => {
    const m = isObj(o) ? o : {};
    return { kcal: Math.round(clamp(num(m.kcal) ?? 0, -5000, 10000)), p: Math.round(clamp(num(m.p) ?? 0, -500, 1000)), f: Math.round(clamp(num(m.f) ?? 0, -500, 1000)), c: Math.round(clamp(num(m.c) ?? 0, -500, 2000)) };
  };
  const foods = [];
  const seen = new Set();
  for (const f of Array.isArray(c.foods) ? c.foods : []) {
    if (!isObj(f) || foods.length >= MAX_OWN_FOODS) continue;
    const id = str(f.id, 40), name = str(f.name, 80);
    if (!/^[A-Za-z0-9:_-]{1,40}$/.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    const v = cleanPer100({ kcal: f.kcal100, p: f.p100, f: f.f100, c: f.c100 });
    foods.push({ id, name, kcal100: v.k, p100: v.p, f100: v.f, c100: v.c });
  }
  return { meal: MEAL_SLOTS.includes(c.meal) ? c.meal : 'snack', remaining: macros(c.remaining), target: macros(c.target), foods, wish: str(c.wish, 200) };
}

/** The payload a food task carries. `lang` is the app language: names come back in it. */
export function buildFoodPayload(kind, { caption = '', context = null, lang = 'en', hasPhoto = false } = {}) {
  const base = { coach_contract: CONTRACT, task: kind, meta: { lang: str(lang, 8) || 'en' } };
  if (kind === 'meal') return { ...base, photo: !!hasPhoto, caption: cleanCaption(caption) };
  if (kind === 'label') return { ...base, photo: true };
  return { ...base, ...cleanSuggestContext(context) };
}

/** The image a request may carry: JPEG, PNG or WebP by its own first bytes, within the size cap. */
export function checkImage(b64) {
  if (typeof b64 !== 'string' || !b64) return { ok: false, code: 'noimage' };
  const data = b64.replace(/^data:[^,]*,/, '');
  if (data.length > MAX_IMAGE_B64) return { ok: false, code: 'toolarge' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { ok: false, code: 'badimage' };
  // The first twelve bytes are in the first sixteen characters.
  const head = data.slice(0, 16);
  const mime = head.startsWith('/9j/') ? 'image/jpeg' : head.startsWith('iVBORw0KGgo') ? 'image/png' : /^UklGR.{6}XRUJQ/.test(head) ? 'image/webp' : null;
  if (!mime) return { ok: false, code: 'badimage' };
  return { ok: true, image: { mime, data } };
}

/* ------------------------------ answers ------------------------------ */

const CONF = ['high', 'medium', 'low'];

/** @returns {{ ok:true, items:object[], note:string } | { ok:false, errors:string[] }} */
export function validateMeal(data) {
  if (!isObj(data)) return { ok: false, errors: ['the answer must be one JSON object'] };
  if (!Array.isArray(data.items)) return { ok: false, errors: ['`items` must be an array (empty when there is no food to see)'] };
  const errors = [];
  const items = [];
  data.items.slice(0, MAX_ITEMS).forEach((it, i) => {
    if (!isObj(it)) { errors.push(`items[${i}] must be an object`); return; }
    const name = str(it.name, 80) || str(it.en, 80);
    if (!name) { errors.push(`items[${i}].name is missing`); return; }
    const grams = num(it.grams);
    if (grams == null || grams <= 0) { errors.push(`items[${i}].grams must be the weight of that food in grams, as a number`); return; }
    items.push({
      name, en: str(it.en, 60).toLowerCase(),
      grams: Math.round(clamp(grams, 1, 3000)),
      per100: cleanPer100({ kcal: it.kcal100, p: it.p100, f: it.f100, c: it.c100 }),
      conf: CONF.includes(it.conf) ? it.conf : 'low'
    });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, items, note: str(data.note, 240) };
}

/** @returns {{ ok:true, food:object|null, note:string } | { ok:false, errors:string[] }} */
export function validateLabel(data) {
  if (!isObj(data)) return { ok: false, errors: ['the answer must be one JSON object'] };
  const note = str(data.note, 240);
  if (data.found === false) return { ok: true, food: null, note };
  let kcal = num(data.kcal);
  const kj = num(data.kj);
  if (kcal == null && kj != null) kcal = kj / 4.184;
  const p = num(data.protein), f = num(data.fat), c = num(data.carbs);
  if (kcal == null && p == null && f == null && c == null) return { ok: false, errors: ['give the label’s energy (kcal or kj) or its protein, fat and carbs — or say "found": false'] };
  // A label printed per serving is turned into per 100 g here, which needs the serving's weight.
  const per = ['100g', '100ml', 'serving'].includes(data.per) ? data.per : '100g';
  const serving = num(data.servingGrams);
  let scale = 1;
  if (per === 'serving') {
    if (!(serving > 0)) return { ok: false, errors: ['the values are per serving, so `servingGrams` must say how many grams a serving is'] };
    scale = 100 / serving;
  }
  const raw = { kcal: kcal == null ? null : kcal * scale, p: (p ?? 0) * scale, f: (f ?? 0) * scale, c: (c ?? 0) * scale };
  const v = cleanPer100(raw);
  const food = { n: str(data.name, 80), k: v.k, p: v.p, f: v.f, c: v.c };
  const brand = str(data.brand, 40);
  if (brand) food.brand = brand;
  if (serving > 0 && serving <= 2000) food.sv = Math.round(serving);
  // `check` asks the user to look again: the printed energy and the printed macros disagreed.
  if (v.fixed) food.check = true;
  return { ok: true, food, note };
}

/** @returns {{ ok:true, ideas:object[] } | { ok:false, errors:string[] }} */
export function validateSuggest(data, { ids = [] } = {}) {
  if (!isObj(data)) return { ok: false, errors: ['the answer must be one JSON object'] };
  if (!Array.isArray(data.ideas)) return { ok: false, errors: ['`ideas` must be an array'] };
  const own = new Set(ids);
  const errors = [];
  const ideas = [];
  data.ideas.slice(0, MAX_IDEAS).forEach((idea, i) => {
    if (!isObj(idea) || !Array.isArray(idea.items) || !idea.items.length) { errors.push(`ideas[${i}].items must list at least one food`); return; }
    const items = [];
    for (const it of idea.items.slice(0, MAX_IDEA_ITEMS)) {
      if (!isObj(it)) continue;
      const grams = num(it.grams);
      const id = typeof it.id === 'string' && own.has(it.id) ? it.id : null;
      const name = str(it.name, 80);
      if (!(grams > 0) || (!id && !name)) continue;
      items.push({
        ...(id ? { id } : {}), name, grams: Math.round(clamp(grams, 5, 1500)),
        // For one of the user's own foods the app uses its own numbers; these are for the rest.
        per100: cleanPer100({ kcal: it.kcal100, p: it.p100, f: it.f100, c: it.c100 })
      });
    }
    if (!items.length) { errors.push(`ideas[${i}] has no item with a name and a weight in grams`); return; }
    ideas.push({ title: str(idea.title, 60), items, why: str(idea.why, 200) });
  });
  if (!ideas.length && errors.length) return { ok: false, errors };
  return { ok: true, ideas };
}

/** The validator for a food kind, with the payload it has to answer. */
export function validateFood(kind, data, payload) {
  if (kind === 'meal') { const r = validateMeal(data); return r.ok ? { ok: true, result: { items: r.items, note: r.note } } : r; }
  if (kind === 'label') { const r = validateLabel(data); return r.ok ? { ok: true, result: { food: r.food, note: r.note } } : r; }
  const r = validateSuggest(data, { ids: (payload.foods || []).map(f => f.id) });
  return r.ok ? { ok: true, result: { ideas: r.ideas } } : r;
}
