/* The image is built from an explicit list of files (api/Dockerfile: `COPY server.js … ./`), and
   nothing else in the suite runs inside it. A module added beside server.js and not added to
   that line passes every test here and then kills the container at boot — which is exactly what
   pool.js did. This walks the relative imports from server.js and holds the COPY lines to them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function reachable(entry) {
  const seen = new Set();
  const todo = [path.join(API, entry)];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    // Static and dynamic: `from './x.js'`, `import('./x.js')`, `import './x.js'`.
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const next = path.resolve(path.dirname(file), m[1]);
      if (fs.existsSync(next) && fs.statSync(next).isFile()) todo.push(next);
    }
  }
  return [...seen].map(f => path.relative(API, f).split(path.sep).join('/'));
}

// The Dockerfile as stages: [{ name, body }] in file order.
function stages() {
  const text = fs.readFileSync(path.join(API, 'Dockerfile'), 'utf8').replace(/\r\n/g, '\n');
  const out = [];
  for (const block of text.split(/^(?=FROM\s)/m).filter(b => /^FROM\s/.test(b))) {
    const m = block.match(/^FROM\s+\S+(?:\s+AS\s+(\S+))?/i);
    out.push({ name: m[1] || '', body: block });
  }
  return out;
}

test('every module the server imports is copied into the image', () => {
  // The one list of application files: the `app` stage, which both targets copy from.
  const dockerfile = stages().find(s => s.name === 'app').body;
  const files = new Set(), dirs = new Set();
  for (const m of dockerfile.matchAll(/^COPY\s+(.+)$/gm)) {
    const parts = m[1].trim().split(/\s+/);
    const sources = parts.slice(0, -1);
    for (const s of sources) {
      if (s.startsWith('--')) continue;
      const clean = s.replace(/\*$/, '');
      if (fs.existsSync(path.join(API, clean)) && fs.statSync(path.join(API, clean)).isDirectory()) dirs.add(clean);
      else files.add(clean);
    }
  }
  const missing = reachable('server.js').filter(f => {
    if (f.startsWith('..')) return true;                       // outside the build context entirely
    const top = f.split('/')[0];
    return f.includes('/') ? !dirs.has(top) : !files.has(f);
  });
  assert.deepEqual(missing, [], 'imported by the server but not in a COPY line of api/Dockerfile');
});

/* The image is laid out so a rebuild downloads as little as possible, and that is a property a
   later edit loses quietly — the build still works, it is just slow again. So: both targets take
   the application from the `app` stage as their LAST instruction (nothing that fetches from a
   network may come after the source, or every code change repeats it), the published default
   stays the last stage, and no build argument is declared above a RUN in its own stage (a RUN
   sees every ARG above it, so BUILD_DATE up there is a cache miss on every CI build). */
test('both targets end with the application files, and nothing network-bound follows the source', () => {
  const all = stages();
  assert.equal(all.at(-1).name, 'default', 'a plain `docker build` must keep producing the runtime-free image');
  for (const name of ['coach', 'default']) {
    const stage = all.find(s => s.name === name);
    assert.ok(stage, `no "${name}" stage`);
    const lines = stage.body.split('\n').filter(l => /^[A-Z]+\s/.test(l));
    assert.equal(lines.at(-1), 'COPY --from=app /app/ ./', `the ${name} target must end by copying the app stage`);
    assert.equal(lines.filter(l => l.startsWith('COPY --from=app')).length, 1);
  }
});

test('build arguments come after the last RUN of their stage', () => {
  for (const stage of stages()) {
    const lines = stage.body.split('\n');
    const firstArg = lines.findIndex(l => /^ARG\s/.test(l));
    if (firstArg < 0) continue;
    const runAfter = lines.slice(firstArg).some(l => /^RUN\s/.test(l));
    assert.equal(runAfter, false, `stage "${stage.name}" has a RUN below an ARG — every CI build would miss the cache there`);
  }
});

test('every npm install in the image uses the cache mount', () => {
  const text = stages().map(s => s.body).join('\n');
  const runs = text.split(/^(?=RUN\s)/m).filter(b => /^RUN\s/.test(b)).map(b => b.split(/\n(?![ \t])/)[0]);
  const npm = runs.filter(r => /\bnpm (ci|install)\b/.test(r));
  assert.ok(npm.length >= 3);
  for (const r of npm) assert.match(r, /--mount=type=cache,target=\/root\/\.npm/, r.split('\n')[0]);
});
