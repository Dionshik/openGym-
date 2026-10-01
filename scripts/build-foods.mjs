#!/usr/bin/env node
/* Generates the built-in food list the nutrition diary searches.
 *
 *   node scripts/build-foods.mjs                 # fetch the source, build, write
 *   node scripts/build-foods.mjs --cache <dir>   # keep/reuse the downloaded archive there
 *   node scripts/build-foods.mjs --check         # build and compare with the committed file
 *
 * Two inputs, both under scripts/food-sources/:
 *
 *   selection.json   which rows of USDA FoodData Central "SR Legacy" (April 2018, the final
 *                    release; public domain, CC0) the app ships, each with the Russian name,
 *                    the short English name and the search aliases written for this project.
 *                    A row names its USDA description as well as its id; if the two ever stop
 *                    belonging together the run fails instead of shipping the wrong food.
 *   supplement.json  everyday foods the USDA table does not have — tvorog, kefir, pelmeni,
 *                    borscht … — hand-authored typical values, marked approximate in the app.
 *
 * The numbers are per 100 g: energy in kcal, protein, fat and carbohydrate in grams. Nothing
 * else is taken; this is a calorie diary, not a micronutrient database.
 *
 * Ids are `u<fdc id>` and `s-<slug>`: stable by construction, so a product logged yesterday is
 * still "the same product" in the recent list after the next regeneration. Never renumber a
 * supplement slug that shipped.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'scripts', 'food-sources');
const outFile = join(root, 'frontend', 'src', 'lib', 'foods-data.js');
const args = process.argv.slice(2);
const cacheDir = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : null;
const check = args.includes('--check');

const SOURCE = {
  name: 'USDA FoodData Central — SR Legacy, April 2018',
  url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip',
  sha256: 'b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0'
};
// FoodData Central nutrient ids: energy (kcal), protein, total fat, carbohydrate by difference.
const NUTRIENTS = { 1008: 'k', 1003: 'p', 1004: 'f', 1005: 'c' };

/* ------------------------------ the archive ------------------------------ */

async function archive() {
  const file = cacheDir && join(cacheDir, 'sr_legacy.zip');
  let buf;
  if (file && existsSync(file)) buf = readFileSync(file);
  else {
    const res = await fetch(SOURCE.url);
    if (!res.ok) throw new Error(`${SOURCE.url}: HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    if (file) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(file, buf); }
  }
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SOURCE.sha256) throw new Error(`the archive is not the pinned one: sha256 ${sha}`);
  return buf;
}

// The two files needed, straight out of the zip: central directory → local header → deflate.
// No dependency, and no Zip64 — the archive is 6 MB.
function unzip(buf, wanted) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const base = name.split('/').pop();
    if (wanted.includes(base)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      out[base] = (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  for (const w of wanted) if (!(w in out)) throw new Error(`${w} is not in the archive`);
  return out;
}

function* csvRows(text) {
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); cell = ''; yield row; row = []; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); yield row; }
}

/* ------------------------------ build ------------------------------ */

const selection = JSON.parse(readFileSync(join(srcDir, 'selection.json'), 'utf8'));
const supplement = JSON.parse(readFileSync(join(srcDir, 'supplement.json'), 'utf8')).rows;

const files = unzip(await archive(), ['food.csv', 'food_nutrient.csv']);
const want = new Map(selection.map(s => [String(s.fdc), { ...s }]));
let header = true;
for (const r of csvRows(files['food.csv'])) {
  if (header) { header = false; continue; }
  const s = want.get(r[0]);
  if (s) s.found = r[2];
}
header = true;
for (const r of csvRows(files['food_nutrient.csv'])) {
  if (header) { header = false; continue; }
  const s = want.get(r[1]), key = NUTRIENTS[r[2]];
  if (s && key) s[key] = +r[3];
}

const problems = [];
const r1 = n => Math.round(n * 10) / 10;
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const rows = [];
const seenId = new Set(), seenName = new Set();
const push = (id, s, vals) => {
  const ru = clean(s.ru), en = clean(s.en);
  if (!ru || !en) problems.push(`${id}: a name is missing`);
  if (seenId.has(id)) problems.push(`${id}: the id is used twice`);
  if (seenName.has(ru.toLowerCase())) problems.push(`${id}: "${ru}" is used twice`);
  seenId.add(id); seenName.add(ru.toLowerCase());
  rows.push([id, ru, en, Math.round(vals.k), r1(vals.p), r1(vals.f), r1(vals.c), clean(s.al).toLowerCase(), s.sv > 0 ? Math.round(s.sv) : 0]);
};

for (const s of want.values()) {
  const id = 'u' + s.fdc;
  if (s.found == null) { problems.push(`${id}: no such food in the source (${s.usda})`); continue; }
  if (s.found !== s.usda) { problems.push(`${id}: the source calls it "${s.found}", the selection "${s.usda}"`); continue; }
  if (s.k == null) { problems.push(`${id}: the source has no energy value`); continue; }
  push(id, s, { k: s.k, p: s.p || 0, f: s.f || 0, c: s.c || 0 });
}
for (const s of supplement) {
  if (!/^[a-z0-9-]+$/.test(s.id || '')) { problems.push(`supplement row without a usable id: ${JSON.stringify(s.ru)}`); continue; }
  const atwater = 4 * s.p + 4 * s.c + 9 * s.f;
  // A hand-typed row that disagrees with its own macros by a quarter is a typo, not a food.
  if (Math.abs(atwater - s.k) > Math.max(12, s.k * 0.25)) problems.push(`s-${s.id}: ${s.k} kcal does not fit its macros (${Math.round(atwater)})`);
  push('s-' + s.id, s, s);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const out = `// GENERATED by scripts/build-foods.mjs — do not edit; change scripts/food-sources/*.json and regenerate.
// The built-in food list of the nutrition diary: energy and macronutrients per 100 g.
//   u…  ${SOURCE.name}. U.S. Department of Agriculture, Agricultural
//       Research Service — public domain (CC0). Russian names and aliases are this project's own.
//   s-… foods that table lacks (tvorog, kefir, pelmeni, borscht …): typical values, hand-authored,
//       approximate. See NOTICE.md.
// Row: [id, Russian name, English name, kcal, protein g, fat g, carbohydrate g, aliases, usual portion g (0 = none)]
export const FOODS = [
${rows.map(r => JSON.stringify(r)).join(',\n')}
]
`;

if (check) {
  const have = existsSync(outFile) ? readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : '';
  if (have !== out) { console.error('frontend/src/lib/foods-data.js is stale — run node scripts/build-foods.mjs'); process.exit(1); }
  console.log(`foods-data.js is in sync (${rows.length} foods)`);
} else {
  writeFileSync(outFile, out);
  console.log(`wrote ${rows.length} foods (${want.size} USDA, ${supplement.length} supplement)`);
}
