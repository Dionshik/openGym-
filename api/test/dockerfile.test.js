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

test('every module the server imports is copied into the image', () => {
  const dockerfile = fs.readFileSync(path.join(API, 'Dockerfile'), 'utf8');
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
