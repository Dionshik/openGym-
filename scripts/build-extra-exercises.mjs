#!/usr/bin/env node
/* Generates the catalogue rows that are NOT in the upstream dataset.
 *
 *   node scripts/build-extra-exercises.mjs                 # fetch, build, write
 *   node scripts/build-extra-exercises.mjs --cache <dir>   # keep/reuse the raw downloads there
 *   node scripts/build-extra-exercises.mjs --prune-lock    # allow a released id to disappear
 *
 * `frontend/src/lib/exercises-data.js` (EXDB) is the upstream ExerciseDB v1 file and is never
 * touched: every pinned count, every translated pack and every upstream merge keys on it. What
 * that dataset lacks — Olympic lifts, strongman, modern accessory variants, mobility work —
 * comes from three open sources and lands in sibling files that `exercises.js` appends:
 *
 *   yuhonas/free-exercise-db        Unlicense      text only (its photographs are not theirs to give)
 *     + leadpioneer/RU-free-exercise-db            Russian names, aliases and steps (machine draft)
 *   longhaul-fitness/exercises      MIT
 *   wger.de                         CC-BY-SA       its own output file, with per-entry attribution
 *
 * Three rules the output is built to keep:
 *
 *   No new vocabulary. Every body part, equipment and muscle value is one the catalogue already
 *   uses, so the equipment filter, the muscle map, fourteen locale packs and the Coach's closed
 *   lists need nothing. A source value with no mapping fails the run rather than being guessed.
 *
 *   No duplicates. A row is dropped when its movement — the name with equipment words taken
 *   out — matches something already in the catalogue or already accepted from an earlier
 *   source, on the same class of equipment. A near match is dropped too; the only way to keep
 *   one is to name it in overrides.json after reading the report this script writes.
 *
 *   Ids are forever. History stores an id and nothing else for a built-in exercise, so an id
 *   that shipped once must keep resolving. ids.lock.json remembers every id ever written and
 *   the run fails if one would vanish.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'scripts', 'exercise-extra-sources');
const args = process.argv.slice(2);
const cacheDir = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : null;
const pruneLock = args.includes('--prune-lock');

const { EXDB } = await import(pathToFileURL(join(root, 'frontend', 'src', 'lib', 'exercises-data.js')).href);
const { tokens } = await import(pathToFileURL(join(root, 'api', 'coach', 'core', 'match.js')).href);

/* The manual pass, kept as data: rows a person looked at and decided about.
 *   forceKeep   keep although the name is close to an existing row (it is a different exercise)
 *   forceDrop   drop although nothing matched (same exercise under another name, or not an exercise)
 *   equipment   the implement for a row whose source does not say
 *   rename      a clearer name than the source's ("row" → "rowing")
 *   wgerKeep    the wger rows that are taken at all (see the run loop); the value names what
 *               the row is, so the list can be read without the source open
 * Keys are `<source>:<source id>` — fedb:<id>, lh:<slug>, wg:<uuid>. */
const overrides = JSON.parse(readFileSync(join(srcDir, 'overrides.json'), 'utf8'));
const equipmentOverride = overrides.equipment || {};

/* ------------------------------ sources ------------------------------ */

const SOURCES = {
  fedb: { repo: 'yuhonas/free-exercise-db', sha: 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5', path: 'dist/exercises.json', licence: 'Unlicense' },
  fedbRu: { repo: 'leadpioneer/RU-free-exercise-db', sha: '8d5c7ad5b8d4b4396189bbd07a85bf42bb1f6fcc', path: 'dist/exercises.ru.json', licence: 'Unlicense' },
  longhaul: { repo: 'longhaul-fitness/exercises', sha: '2c77d52a8c412eb2e8614e2d2f4f2f6edcea2b42', licence: 'MIT' },
  // wger has no versioned dump; the API is read as it stands and the date goes into the header.
  wger: { url: 'https://wger.de/api/v2/exerciseinfo/?limit=2000&format=json', licence: 'CC-BY-SA (per entry)' }
};
const raw = s => `https://raw.githubusercontent.com/${s.repo}/${s.sha}/`;

async function load(name, url) {
  const file = cacheDir && join(cacheDir, name);
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  if (file) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(file, text); }
  return JSON.parse(text);
}

/* ------------------------------ the catalogue's vocabulary ------------------------------ */

const uniq = f => new Set(EXDB.flatMap(e => [].concat(f(e) ?? [])));
const BP = uniq(e => e.bp), EQ = uniq(e => e.eq), TG = uniq(e => e.tg), SM = uniq(e => e.sm);
// A target implies its body part; the dataset is consistent about it, so it is read off EXDB.
const BP_OF = Object.fromEntries(EXDB.map(e => [e.tg, e.bp]));
const must = (set, v, what, row) => { if (!set.has(v)) throw new Error(`unmapped ${what} "${v}" on "${row}" — add it to the mapping tables`); return v; };

/* target (tg vocabulary) and secondary (sm vocabulary) for every muscle name the sources use */
const MUSCLE = {
  // free-exercise-db
  abdominals: ['abs', 'abdominals'], hamstrings: ['hamstrings', 'hamstrings'], adductors: ['adductors', 'inner thighs'],
  quadriceps: ['quads', 'quadriceps'], biceps: ['biceps', 'biceps'], shoulders: ['delts', 'shoulders'],
  chest: ['pectorals', 'chest'], 'middle back': ['upper back', 'upper back'], calves: ['calves', 'calves'],
  glutes: ['glutes', 'glutes'], 'lower back': ['spine', 'lower back'], lats: ['lats', 'lats'],
  triceps: ['triceps', 'triceps'], traps: ['traps', 'traps'], forearms: ['forearms', 'forearms'],
  neck: ['levator scapulae', null], abductors: ['abductors', 'glutes'],
  // longhaul-fitness
  lat: ['lats', 'lats'], glute: ['glutes', 'glutes'], quad: ['quads', 'quadriceps'], 'thigh - inner': ['adductors', 'inner thighs'],
  'shoulder - front': ['delts', 'shoulders'], 'shoulder - side': ['delts', 'shoulders'], 'shoulder - back': ['delts', 'rear deltoids'],
  tricep: ['triceps', 'triceps'], hamstring: ['hamstrings', 'hamstrings'], calf: ['calves', 'calves'],
  'rotator cuff - back': ['delts', 'rotator cuff'], 'rotator cuff - front': ['delts', 'rotator cuff'], trap: ['traps', 'traps'],
  abdominal: ['abs', 'abdominals'], bicep: ['biceps', 'biceps'], oblique: ['abs', 'obliques'],
  'forearm - inner': ['forearms', 'forearms'], 'forearm - outer': ['forearms', 'forearms'], 'thigh - outer': ['abductors', 'glutes'],
  // wger (anatomical names)
  'biceps femoris': ['hamstrings', 'hamstrings'], 'gluteus maximus': ['glutes', 'glutes'], 'quadriceps femoris': ['quads', 'quadriceps'],
  'rectus abdominis': ['abs', 'abdominals'], 'anterior deltoid': ['delts', 'shoulders'], trapezius: ['traps', 'trapezius'],
  'triceps brachii': ['triceps', 'triceps'], 'obliquus externus abdominis': ['abs', 'obliques'], 'pectoralis major': ['pectorals', 'chest'],
  'biceps brachii': ['biceps', 'biceps'], gastrocnemius: ['calves', 'calves'], 'serratus anterior': ['serratus anterior', null],
  soleus: ['calves', 'soleus'], 'latissimus dorsi': ['lats', 'latissimus dorsi'], brachialis: ['biceps', 'brachialis']
};
function muscles(primary, secondary, row) {
  const known = m => { const k = String(m || '').toLowerCase().trim(); if (!MUSCLE[k]) throw new Error(`unmapped muscle "${m}" on "${row}"`); return MUSCLE[k]; };
  const p = primary.map(known);
  if (!p.length) return null;
  const tg = must(TG, p[0][0], 'target', row);
  // Further primaries and the secondaries, in the sm spelling, without repeating the target's own.
  const sm = [...new Set([...p.slice(1).map(x => x[1]), ...secondary.map(m => known(m)[1])].filter(Boolean))]
    .filter(s => s !== p[0][1]).map(s => must(SM, s, 'secondary muscle', row));
  return { tg, bp: BP_OF[tg], sm };
}

/* ------------------------------ equipment ------------------------------ */

// Name keywords → catalogue equipment, for rows whose source says "other", nothing at all, or
// just "machine". First hit wins, so the specific ones come first.
const EQ_BY_NAME = [
  [/\bsmith\b/, 'smith machine'], [/\b(leg press|hack squat)\b/, 'sled machine'],
  [/\b(trap|hex) bar\b/, 'trap bar'], [/\b(ez|e-z|sz)[ -]?(bar|curl)\b/, 'ez barbell'],
  [/\bkettlebells?\b/, 'kettlebell'], [/\bdumbbells?\b/, 'dumbbell'], [/\bbarbell\b|\baxle\b|\blandmine\b|\bt-bar\b/, 'barbell'],
  [/\bcables?\b|\bpulley\b/, 'cable'], [/\b(resistance )?bands?\b/, 'band'],
  [/\b(medicine|med) ball\b/, 'medicine ball'], [/\b(stability|swiss|exercise) ball\b/, 'stability ball'], [/\bbosu\b/, 'bosu ball'],
  [/\b(foam roll(er)?|smr)\b/, 'roller'], [/\bab wheel\b|\bab roll(er|out)\b|\bwheel roll/, 'wheel roller'],
  [/\b(battling|battle) ropes?\b|\brope (wave|climb|jump)|\bjump(ing)? rope\b|\brope jumping\b/, 'rope'],
  [/\btire\b/, 'tire'], [/\bsledgehammer\b/, 'hammer'],
  [/\b(bike|bicycling|cycling|recumbent)\b/, 'stationary bike'], [/\belliptical\b/, 'elliptical machine'], [/\bstair ?(master|climb|mill)|\bstep ?mill\b/, 'stepmill machine'],
  [/\b(machine|lever|pec deck|leg extension|leg curl|treadmill|rowing)\b/, 'leverage machine']
];
const eqByName = name => { const n = name.toLowerCase(); for (const [re, eq] of EQ_BY_NAME) if (re.test(n)) return eq; return null; };

/* ------------------------------ duplicates ------------------------------ */

// Words that say what the exercise is done WITH. They are taken out before two names are
// compared, and the equipment class is compared on its own — "leg extensions" on a machine and
// "lever leg extension" are one exercise, a dumbbell curl and a cable curl are two.
const EQ_WORDS = new Set(['barbell', 'dumbbell', 'cable', 'lever', 'band', 'resistance', 'kettlebell', 'body', 'weight', 'olympic']);
// Words a name can carry without being a different exercise.
const FILLER = new Set(['exercise', 'left', 'right', 'side', 'sided', 'two', 'both', 'double', 'alternate', 'alternating', 'standard', 'regular', 'classic', 'traditional', 'conventional', 'normal', 'basic', 'full', 'style']);
const CLASS = {
  barbell: 'bar', 'olympic barbell': 'bar', 'ez barbell': 'bar', 'trap bar': 'bar',
  dumbbell: 'db', cable: 'cable', kettlebell: 'kb', band: 'band', 'resistance band': 'band',
  'leverage machine': 'machine', 'smith machine': 'machine', 'sled machine': 'machine',
  'body weight': 'bw', assisted: 'bw', weighted: 'bw',
  'stability ball': 'ball', 'medicine ball': 'ball', 'bosu ball': 'ball'
};
const classOf = eq => CLASS[eq] || eq;
const movement = name => new Set([...tokens(name)].filter(w => !EQ_WORDS.has(w) && !FILLER.has(w)));
const keyOf = set => [...set].sort().join(' ');
function jaccard(a, b) { let hit = 0; for (const w of a) if (b.has(w)) hit++; return hit / (a.size + b.size - hit); }
// One name is the other plus a single qualifier: "bench press – medium grip" is a bench press
// until somebody says otherwise.
function oneApart(a, b) {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  if (l.size - s.size > 1 || s.size < 2) return false;
  for (const w of s) if (!l.has(w)) return false;
  return true;
}

class Reference {
  constructor() { this.rows = []; this.byKey = new Map(); this.byName = new Map(); }
  add(row) {
    const m = movement(row.n);
    const ref = { id: row.id, n: row.n, cls: classOf(row.eq), m };
    this.rows.push(ref);
    const full = keyOf(tokens(row.n));
    if (!this.byName.has(full)) this.byName.set(full, ref);
    const k = keyOf(m);
    if (!this.byKey.has(k)) this.byKey.set(k, []);
    this.byKey.get(k).push(ref);
  }
  /** → { kind: 'exact'|'near', ref } or null. */
  find(name, eq) {
    // The same name is the same exercise whatever each source says it is done with.
    const named = this.byName.get(keyOf(tokens(name)));
    if (named) return { kind: 'exact', ref: named };
    const m = movement(name), cls = classOf(eq);
    if (!m.size) return null;
    const same = (this.byKey.get(keyOf(m)) || []).find(r => r.cls === cls);
    if (same) return { kind: 'exact', ref: same };
    let best = null, score = 0;
    for (const r of this.rows) {
      if (r.cls !== cls) continue;
      const j = jaccard(m, r.m);
      const s = oneApart(m, r.m) ? Math.max(j, 0.6) : j;
      if (s > score) { score = s; best = r; }
    }
    if (score >= 0.85) return { kind: 'exact', ref: best };
    if (score >= 0.6) return { kind: 'near', ref: best, score };
    return null;
  }
}

/* ------------------------------ normalising the three sources ------------------------------ */

const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const lower = s => clean(s).toLowerCase();
const steps = list => (list || []).map(clean).filter(Boolean).slice(0, 12).map(s => s.slice(0, 700));
const idFor = (prefix, sid) => `${prefix}_${createHash('sha1').update(sid).digest('hex').slice(0, 8)}`;
const CARDIO = { tg: 'cardiovascular system', bp: 'cardio', sm: [] };

function fromFedb(list, ruList) {
  const ru = new Map(ruList.map(r => [r.id, r]));
  const EQMAP = {
    'body only': 'body weight', kettlebells: 'kettlebell', dumbbell: 'dumbbell', cable: 'cable', barbell: 'barbell',
    bands: 'band', 'medicine ball': 'medicine ball', 'exercise ball': 'stability ball', 'e-z curl bar': 'ez barbell', 'foam roll': 'roller'
  };
  // No implement named and nothing in the name gives one away: a stretch or a jump is done
  // with the body; a strongman or strength row is loaded with something the catalogue has no
  // word for, and "weighted" is its word for "some external load".
  const FALLBACK = { stretching: 'body weight', plyometrics: 'body weight', cardio: 'body weight', strongman: 'weighted', powerlifting: 'weighted', 'olympic weightlifting': 'barbell' };
  // "strength" with no implement is mostly bars, rings and straps — the body is the load —
  // unless the name says a plate, a chain or a sled is.
  const LOADED = /\b(plate|chains?|weighted|harness|svend|otis|sled|drag|squeeze)\b/;
  return list.map(e => {
    const n = lower(e.name);
    let eq = EQMAP[e.equipment], guessed = false;
    if (e.equipment === 'machine') eq = eqByName(n) || 'leverage machine';
    if (!eq) { eq = eqByName(n); if (!eq) { eq = FALLBACK[e.category] || (LOADED.test(n) ? 'weighted' : 'body weight'); guessed = true; } }
    if (!eq) throw new Error(`fedb: no equipment for "${e.name}" (${e.equipment} / ${e.category})`);
    const cardio = e.category === 'cardio';
    const m = cardio ? CARDIO : muscles(e.primaryMuscles || [], e.secondaryMuscles || [], e.name);
    const r = ru.get(e.id);
    const cyr = s => /[а-яё]/i.test(s);
    return {
      key: 'fedb:' + e.id, id: idFor('fe', 'fedb:' + e.id), src: 'fedb', n, eq, guessed, ...(m || {}), noMuscle: !m,
      st: steps(e.instructions),
      // The source's two photographs — start and end position. Only their PATHS are recorded:
      // the files are fetched by each instance at run time (docker compose `media`), never
      // committed here, because nobody upstream can say whose they are (see NOTICE.md).
      frames: (e.images || []).length >= 2 && e.images.slice(0, 2).every(p => /^[A-Za-z0-9_-]+\/[01]\.jpg$/.test(p)) ? e.images.slice(0, 2) : null,
      ru: r && cyr(r.name_ru || '') ? {
        n: clean(r.name_ru),
        alt: [...new Set((r.aliases_ru || []).map(clean).filter(a => cyr(a) && a.toLowerCase() !== clean(r.name_ru).toLowerCase()))].slice(0, 4),
        st: Array.isArray(r.instructions_ru) && r.instructions_ru.length ? steps(r.instructions_ru) : null
      } : null
    };
  });
}

function fromLonghaul(strength, flexibility, cardio) {
  // "Squat – Barbell": the implement is a suffix. → [catalogue equipment, word put in front of the name]
  const SUFFIX = {
    barbell: ['barbell', 'barbell'], dumbbell: ['dumbbell', 'dumbbell'], bodyweight: ['body weight', ''], machine: ['leverage machine', 'machine'],
    bar: ['body weight', ''], bosu: ['bosu ball', 'bosu'], rope: ['rope', 'rope'], 'medicine ball': ['medicine ball', 'medicine ball'],
    't-bar': ['barbell', 't-bar'], belt: ['weighted', 'belt'], landmine: ['barbell', 'landmine'], 'feet in rings': ['body weight', 'ring (feet)'],
    'hands in rings': ['body weight', 'ring'], ring: ['body weight', 'ring'], rings: ['body weight', 'ring'], band: ['band', 'band'],
    'smith machine': ['smith machine', 'smith'], 'cable with bar': ['cable', 'cable bar'], cable: ['cable', 'cable'], bench: ['body weight', 'bench'],
    'trap bar high handles': ['trap bar', 'trap bar (high handles)'], 'trap bar low handles': ['trap bar', 'trap bar (low handles)'], 'trap bar': ['trap bar', 'trap bar'],
    'cable with rope': ['cable', 'cable rope'], 'fat bar': ['barbell', 'fat bar'], box: ['body weight', 'box'], plate: ['weighted', 'plate'],
    kettlebell: ['kettlebell', 'kettlebell'], 'double kettlebell': ['kettlebell', 'double kettlebell'], 'leg press machine': ['sled machine', 'sled'],
    'stability ball': ['stability ball', 'stability ball'], 'hand weights': ['dumbbell', 'dumbbell'],
    // flexibility.json: props, none of them a load
    'foam roller': ['roller', 'foam roller'], 'lacrosse ball': ['roller', 'lacrosse ball'], dowel: ['body weight', 'dowel'],
    'yoga block': ['body weight', 'yoga block'], pillow: ['body weight', 'pillow']
  };
  const out = [];
  for (const [kind, list] of [['strength', strength], ['flexibility', flexibility]]) {
    for (const e of list) {
      const [base, suffix] = clean(e.name).split(/\s+[–-]\s+/);
      let eq, n = lower(base), guessed = false;
      if (suffix) {
        const s = SUFFIX[suffix.toLowerCase().trim()];
        if (!s) throw new Error(`longhaul: unmapped equipment suffix "${suffix}" on "${e.name}"`);
        // "Cable Curl – Rope": the rope is the attachment, the cable is the implement.
        eq = s[0] === 'rope' && /\bcable\b/.test(n) ? 'cable' : s[0];
        if (s[1] && !n.includes(s[1])) n = `${s[1]} ${n}`;
      } else {
        // No suffix does not mean no implement: "Clean", "Face Pull" and "Leg Extension" are
        // listed bare. Those are named in overrides.json (`equipment`); what is left after the
        // name keywords really is done with the body.
        eq = equipmentOverride['lh:' + e.slug] || eqByName(n) || 'body weight';
      }
      const m = muscles(e.primaryMuscles || [], e.secondaryMuscles || [], e.name);
      out.push({ key: 'lh:' + e.slug, id: idFor('lh', 'lh:' + e.pk), src: 'longhaul', n, eq, guessed, ...(m || {}), noMuscle: !m, st: steps(e.steps) });
    }
  }
  for (const e of cardio) {
    const n = lower(e.name);
    out.push({ key: 'lh:cardio-' + e.slug, id: idFor('lh', 'lh:cardio:' + e.slug), src: 'longhaul', n, eq: eqByName(n) || 'body weight', ...CARDIO, st: steps(e.instructions || e.steps) });
  }
  return out;
}

function fromWger(results) {
  const EQMAP = { barbell: 'barbell', 'sz-bar': 'ez barbell', dumbbell: 'dumbbell', kettlebell: 'kettlebell', 'cable machine': 'cable', 'resistance band': 'band', 'swiss ball': 'stability ball', 'pull-up bar': 'body weight', 'none (bodyweight exercise)': 'body weight', bench: null, 'incline bench': null, 'gym mat': null };
  const ORDER = ['barbell', 'sz-bar', 'dumbbell', 'kettlebell', 'cable machine', 'resistance band', 'swiss ball', 'pull-up bar', 'none (bodyweight exercise)'];
  const text = html => String(html || '').replace(/<\s*(\/p|\/li|br\s*\/?|\/h\d)\s*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  // The English slot holds whatever the contributor typed; a fair number are Spanish or German.
  const FOREIGN = /\b(der|die|das|und|mit|nicht|eine[nrm]?|auf|oder|el|los|las|con|para|una|del|y|que|por|le|les|des|avec|pour)\b/gi;
  const out = [], rejected = [];
  for (const e of results) {
    const en = (e.translations || []).find(tr => tr.language === 2);
    const reject = why => { rejected.push({ name: en?.name || `#${e.id}`, why }); };
    if (!en || !clean(en.name)) { reject('no English name'); continue; }
    const name = clean(en.name);
    if (/[^\x20-\x7e]/.test(name)) { reject('name is not plain English'); continue; }
    const body = text(en.description);
    const st = steps(body.split('\n'));
    const plain = st.join(' ');
    if (plain.length < 80) { reject('no real description'); continue; }
    if ((plain.match(FOREIGN) || []).length >= 4 && !/\b(the|and|your|with)\b/i.test(plain)) { reject('description is not English'); continue; }
    const cardio = e.category?.name === 'Cardio';
    const prim = (e.muscles || []).map(m => m.name), sec = (e.muscles_secondary || []).map(m => m.name);
    const m = cardio && !prim.length ? CARDIO : muscles(prim, sec, name);
    if (!m) { reject('no primary muscle'); continue; }
    const have = (e.equipment || []).map(q => q.name.toLowerCase());
    for (const h of have) if (!(h in EQMAP)) throw new Error(`wger: unmapped equipment "${h}" on "${name}"`);
    const first = ORDER.find(o => have.includes(o));
    const n = lower(name);
    let eq = eqByName(n) || (first ? EQMAP[first] : null) || (have.length ? 'body weight' : null);
    if (!eq && cardio) eq = 'body weight';
    if (!eq) { reject('no equipment'); continue; }
    const authors = [...new Set([e.license_author, ...(e.author_history || []), en.license_author, ...(en.author_history || [])].map(clean).filter(Boolean))];
    out.push({
      key: 'wg:' + e.uuid, id: idFor('wg', 'wg:' + e.uuid), src: 'wger', n, eq, ...m, st,
      attribution: { wger: e.id, url: `https://wger.de/en/exercise/${e.id}/view/`, licence: e.license?.short_name || 'CC-BY-SA 4', authors }
    });
  }
  return { rows: out, rejected };
}

/* ------------------------------ run ------------------------------ */

const forceKeep = new Set(overrides.forceKeep || []), forceDrop = new Set(overrides.forceDrop || []);

const fedb = fromFedb(await load('fedb.json', raw(SOURCES.fedb) + SOURCES.fedb.path), await load('fedb-ru.json', raw(SOURCES.fedbRu) + SOURCES.fedbRu.path));
const longhaul = fromLonghaul(
  await load('lh-strength.json', raw(SOURCES.longhaul) + 'strength.json'),
  await load('lh-flexibility.json', raw(SOURCES.longhaul) + 'flexibility.json'),
  await load('lh-cardio.json', raw(SOURCES.longhaul) + 'cardio.json'));
const wger = fromWger((await load('wger.json', SOURCES.wger.url)).results);

const ref = new Reference();
for (const e of EXDB) ref.add(e);

const kept = [], report = { exact: [], near: [], forced: [], dropped: [], guessed: [], noMuscle: [], unvetted: [], wgerRejected: wger.rejected };
const seenId = new Set(EXDB.map(e => e.id));
const vetted = overrides.wgerKeep || {};
for (const row of [...fedb, ...longhaul, ...wger.rows]) {
  // A row dropped by hand still joins the reference set: it was dropped for being something the
  // catalogue already has under another name, and the next source's copy of it must meet the
  // same fate rather than slip in behind it.
  if (forceDrop.has(row.key)) { report.dropped.push(row); ref.add({ ...row, id: '(dropped by hand)' }); continue; }
  // wger is the one source taken by invitation: its English slot holds swim drills, breathing
  // exercises and half-translated names next to the good rows, and its muscle and equipment
  // fields are often missing or wrong. A row is in only if a person read it and listed it.
  if (row.src === 'wger' && !(row.key in vetted)) { report.unvetted.push(row); continue; }
  if (equipmentOverride[row.key]) row.eq = equipmentOverride[row.key];
  if (overrides.rename?.[row.key]) row.n = overrides.rename[row.key];
  if (row.noMuscle) { report.noMuscle.push(row); continue; }
  must(BP, row.bp, 'body part', row.n); must(EQ, row.eq, 'equipment', row.n);
  if (!row.st.length) { report.dropped.push({ ...row, why: 'no instructions' }); continue; }
  const hit = ref.find(row.n, row.eq);
  if (hit && !(forceKeep.has(row.key))) { report[hit.kind].push({ row, hit }); continue; }
  if (hit) report.forced.push({ row, hit });
  if (seenId.has(row.id)) throw new Error(`id collision on ${row.id} (${row.key})`);
  seenId.add(row.id);
  if (row.guessed) report.guessed.push(row);
  kept.push(row);
  ref.add(row);
}

/* ------------------------------ the id lock ------------------------------ */

const lockFile = join(srcDir, 'ids.lock.json');
const lock = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, 'utf8')) : {};
const now = Object.fromEntries(kept.map(r => [r.id, r.key]));
const gone = Object.keys(lock).filter(id => !(id in now));
if (gone.length && !pruneLock) {
  console.error(`${gone.length} released id(s) would disappear:\n` + gone.map(id => `  ${id}  ${lock[id]}`).join('\n') +
    '\nAn id that shipped is permanent. Put the row in overrides.json forceKeep, or pass --prune-lock if it never shipped.');
  process.exit(1);
}
const sorted = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(lockFile, JSON.stringify(sorted(pruneLock ? now : { ...lock, ...now }), null, 1) + '\n');

/* ------------------------------ output ------------------------------ */

const today = new Date().toISOString().slice(0, 10);
const rowOf = r => ({
  id: r.id, n: r.n, bp: r.bp, eq: r.eq, tg: r.tg, ...(r.sm.length ? { mg: r.sm[0], sm: r.sm } : { sm: [] }), st: r.st, src: r.src,
  // Relative to the instance's image folder, under a directory of their own.
  ...(r.frames ? { img: 'fedb/' + r.frames[0], img2: 'fedb/' + r.frames[1] } : {})
});
const dataFile = (name, exportName, rows, header) => {
  const body = header + `export const ${exportName} = [\n` + rows.map(r => JSON.stringify(rowOf(r))).join(',\n') + '\n];\n';
  writeFileSync(join(root, 'frontend', 'src', 'lib', name), body);
  return body.length;
};
const GEN = '// GENERATED by scripts/build-extra-exercises.mjs — do not edit; change the generator or its overrides.json.\n';
const open = kept.filter(r => r.src !== 'wger'), cc = kept.filter(r => r.src === 'wger');

const sizeOpen = dataFile('exercises-extra.js', 'EXTRA', open, GEN +
  `// Catalogue rows the upstream dataset lacks, in its own row shape. No animation; the\n` +
  `// free-exercise-db rows name two photographs (img, img2 — start and end position) that an\n` +
  `// instance downloads itself and that are NOT in this repository.\n` +
  `//   free-exercise-db   ${SOURCES.fedb.repo}@${SOURCES.fedb.sha.slice(0, 12)}   Unlicense (public domain)\n` +
  `//   longhaul-fitness   ${SOURCES.longhaul.repo}@${SOURCES.longhaul.sha.slice(0, 12)}   MIT, © Longhaul Fitness contributors\n` +
  `// Names, muscles and equipment are mapped onto this catalogue's vocabulary; see NOTICE.md.\n`);
const sizeCc = dataFile('exercises-extra-wger.js', 'EXTRA_WGER', cc, GEN +
  `// Catalogue rows adapted from the wger exercise database (https://wger.de), read ${today}.\n` +
  `// LICENCE: unlike the rest of this repository, the rows in THIS FILE are licensed under\n` +
  `// Creative Commons Attribution-ShareAlike (CC BY-SA 4.0, a few 3.0 / CC0 — per entry), not AGPL.\n` +
  `// Authors and the licence of every row: licenses/wger-attribution.json. Changes made: the\n` +
  `// description was split into steps and muscles/equipment were mapped onto this catalogue's vocabulary.\n`);

const withRu = open.filter(r => r.ru);
writeFileSync(join(root, 'frontend', 'src', 'exercise-names', 'ru.js'),
  '// generated by scripts/build-extra-exercises.mjs — do not edit\n' +
  '// Russian names for the catalogue rows that came from free-exercise-db, from the\n' +
  `// ${SOURCES.fedbRu.repo} overlay (machine draft, Unlicense). A partial pack on purpose: the\n` +
  '// upstream rows have no Russian names and keep their English ones.\n' +
  'export default ' + JSON.stringify(Object.fromEntries(withRu.map(r => [r.id, r.ru.n]))) + '\n' +
  '// Other things the same exercise is called, for the search box only.\n' +
  'export const ALIASES = ' + JSON.stringify(Object.fromEntries(withRu.filter(r => r.ru.alt.length).map(r => [r.id, r.ru.alt.join(' ')]))) + '\n');
mkdirSync(join(root, 'frontend', 'src', 'instr-extra'), { recursive: true });
writeFileSync(join(root, 'frontend', 'src', 'instr-extra', 'ru.js'),
  '// generated by scripts/build-extra-exercises.mjs — do not edit\n' +
  '// Russian steps for the rows in lib/exercises-extra.js (machine draft, same overlay as the names).\n' +
  'export default ' + JSON.stringify(Object.fromEntries(withRu.filter(r => r.ru.st).map(r => [r.id, r.ru.st]))) + '\n');

mkdirSync(join(root, 'licenses'), { recursive: true });
writeFileSync(join(root, 'licenses', 'wger-attribution.json'), JSON.stringify({
  source: 'https://wger.de', read: today,
  note: 'Exercise rows in frontend/src/lib/exercises-extra-wger.js, adapted from the wger exercise database. Each is licensed as stated here.',
  exercises: cc.map(r => ({ id: r.id, name: r.n, ...r.attribution }))
}, null, 1) + '\n');

const line = ({ row, hit }) => `- \`${row.key}\` **${row.n}** [${row.eq}] ≈ ${hit.ref.id} *${hit.ref.n}*${hit.score ? ` (${hit.score.toFixed(2)})` : ''}`;
const bySrc = list => ['fedb', 'longhaul', 'wger'].map(s => `${s} ${list.filter(r => (r.row || r).src === s).length}`).join(', ');
writeFileSync(join(srcDir, 'report.md'), [
  '# Extra exercises — what was kept and what was dropped', '',
  `Generated ${today}. Catalogue: ${EXDB.length} upstream + ${kept.length} extra = ${EXDB.length + kept.length}.`, '',
  `| | total | by source |`, `|---|---|---|`,
  `| read | ${fedb.length + longhaul.length + wger.rows.length + wger.rejected.length} | fedb ${fedb.length}, longhaul ${longhaul.length}, wger ${wger.rows.length + wger.rejected.length} |`,
  `| **kept** | ${kept.length} | ${bySrc(kept)} |`,
  `| duplicate | ${report.exact.length} | ${bySrc(report.exact)} |`,
  `| near-duplicate (dropped) | ${report.near.length} | ${bySrc(report.near)} |`,
  `| kept by override | ${report.forced.length} | ${bySrc(report.forced)} |`,
  `| no primary muscle | ${report.noMuscle.length} | ${bySrc(report.noMuscle)} |`,
  `| dropped by hand (overrides.json) | ${report.dropped.length} | ${bySrc(report.dropped)} |`,
  `| wger: failed the quality filter | ${wger.rejected.length} | |`,
  `| wger: not on the vetted list | ${report.unvetted.length} | |`, '',
  '## Near-duplicates — dropped unless listed in overrides.json `forceKeep`', '', ...report.near.sort((a, b) => b.hit.score - a.hit.score).map(line), '',
  '## Kept by override', '', ...report.forced.map(line), '',
  '## Dropped by hand (overrides.json `forceDrop`)', '', ...report.dropped.map(r => `- \`${r.key}\` **${r.n}** [${r.eq}]${r.why ? ' — ' + r.why : ''}`), '',
  '## Equipment guessed (source named none)', '', ...report.guessed.map(r => `- \`${r.key}\` ${r.n} → ${r.eq}`), '',
  '## Duplicates', '', ...report.exact.map(line), '',
  '## Kept', '', ...kept.map(r => `- \`${r.key}\` ${r.id} ${r.n} [${r.eq} · ${r.tg}]`), ''
].join('\n'));

console.log(`kept ${kept.length} (${bySrc(kept)}); duplicates ${report.exact.length}; near ${report.near.length}; forced ${report.forced.length}`);
console.log(`exercises-extra.js ${(sizeOpen / 1024).toFixed(0)} KB, exercises-extra-wger.js ${(sizeCc / 1024).toFixed(0)} KB, ru names ${withRu.length}`);
