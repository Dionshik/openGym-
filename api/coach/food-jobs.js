/* The food diary's provider calls: a meal read off a photo or a description, a nutrition label
 * transcribed, a meal suggested for what is left of the day.
 *
 * They have a lane of their own, between the two shapes jobs.js already has.
 *
 *   Not the Coach's queue: that one holds a single job per profile across every kind and writes
 *   its result into the one `pending` proposal — a plate being read would be refused while a
 *   review runs, and would overwrite a proposal waiting to be decided.
 *
 *   Not an awaited request like the exercise lookup either: a local vision model on a home
 *   server can take minutes, and every proxy in front of this API gives up on a request after
 *   sixty seconds. So the request returns an id at once and the app asks for the result.
 *
 * And nothing here touches a disk. The photograph lives in this process's memory for as long as
 * the provider call takes and is dropped when it ends; the result waits in memory for a few
 * minutes to be collected and is gone. It is not written to the profile's Coach file, not to
 * the job log (which gets the kind, the outcome and the time, as for every other call), and a
 * restart forgets it — the app is told so, and the person takes the picture again.
 *
 * (An instance may let members keep photos — ../photos.js. That is a different module reached by
 * a different request, sent only when the person asks for the picture to be kept. Nothing here
 * calls it, and test/food-ai.test.js still walks the data directory for the bytes.)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import * as cfgStore from './config.js';
import * as jobs from './jobs.js';
import { adapterFor } from './adapters/index.js';
import { runPipeline } from './core/pipeline.js';
import { FOOD_KINDS, buildFoodPayload, checkImage, cleanCaption } from './core/food.js';
import { extractJSON } from './core/parse.js';
import { fetchFor } from './node-fetch.js';

const { CoachError } = jobs;
const RESULT_TTL_MS = 10 * 60000;      // how long a finished job waits to be collected
const FOOD_MAX_TOKENS = 3000;          // a dozen foods is a few hundred tokens; a rambling model is cut short
const POLL_GRACE_MS = 30000;

const store = new Map();               // job id → { uid, kind, state, startedAt, endedAt?, result?, code?, ctl }
const active = new Map();              // uid → job id, one food job per profile at a time
const waiting = [];

function sweep() {
  const now = Date.now();
  for (const [id, j] of store) if (j.endedAt && now - j.endedAt > RESULT_TTL_MS) store.delete(id);
}
setInterval(sweep, 60000).unref();

/**
 * Start a food job. Throws CoachError (`off`, `kind`, `empty`, `noimage`, `badimage`, `toolarge`,
 * `novision`, `busy`, `consent`, `shared`, `unprivileged`, `cap`) for a request that will not run.
 *
 * @param {{ kind:string, caption?:string, image?:string, context?:object, lang?:string }} req
 * @returns {{ id:string }}
 */
export function start(uid, req = {}) {
  if (!cfgStore.isEnabled() || !cfgStore.isConnected()) throw new CoachError('off', 'the Coach is not set up on this instance');
  const kind = String(req.kind || '');
  if (!FOOD_KINDS.includes(kind)) throw new CoachError('kind', 'unknown request');
  const caption = cleanCaption(req.caption);
  let image = null;
  if (req.image != null && req.image !== '') {
    const img = checkImage(req.image);
    if (!img.ok) throw new CoachError(img.code, 'the picture could not be used');
    image = img.image;
  }
  if (kind === 'label' && !image) throw new CoachError('noimage', 'a label needs a photograph');
  if (kind === 'meal' && !image && !caption) throw new CoachError('empty', 'nothing to read');

  const cfg = cfgStore.load();
  const adapter = adapterFor(cfg.provider);
  if (!adapter) throw new CoachError('off', 'the Coach is not set up on this instance');
  if (image && adapter.images !== true) throw new CoachError('novision', 'this provider cannot read pictures');
  if (active.has(uid)) throw new CoachError('busy', 'the last one is still being read');

  // The same gates as every other provider call — whose account pays, the privilege drop — with
  // the go-ahead that covers this and nothing else (`foodConsent`).
  const S = jobs.admit(uid, { food: true });
  const caps = cfg.caps || {};
  const { used, limit } = jobs.foodCapState(uid);
  if (limit > 0 && used >= limit) throw new CoachError('cap', 'daily limit reached');
  if (caps.instanceDaily > 0 && jobs.instanceUsedToday() >= caps.instanceDaily) throw new CoachError('cap', 'this instance has reached its daily limit');
  jobs.bumpFoodDaily(uid);

  const id = crypto.randomBytes(9).toString('hex');
  const job = { id, uid, kind, state: 'queued', startedAt: Date.now(), ctl: new AbortController() };
  store.set(id, job);
  active.set(uid, id);
  const payload = buildFoodPayload(kind, { caption, context: req.context, lang: req.lang || S?.lang || 'en', hasPhoto: !!image });
  waiting.push({ job, payload, image });
  pump();
  return { id };
}

function pump() {
  while (waiting.length && jobs.acquireSlot()) {
    const next = waiting.shift();
    run(next)
      .catch(e => { console.error('food job crashed', next.job.id, e); end(next.job, { code: 'internal' }); })
      .finally(() => { jobs.releaseSlot(); pump(); });
  }
}
// A slot freed by the Coach's own queue is a slot a waiting food job can take.
jobs.onSlotFree(pump);

function end(job, { result = null, code = null, detail = null }) {
  if (job.endedAt) return;
  job.state = result ? 'done' : 'failed';
  job.result = result;
  job.code = code;
  job.endedAt = Date.now();
  job.ctl = null;
  if (active.get(job.uid) === job.id) active.delete(job.uid);
  // Counts and outcomes only, as for every other call: what was photographed is not logged.
  cfgStore.logJob({
    at: new Date().toISOString(), uid: job.uid, kind: job.kind, trigger: 'manual',
    outcome: result ? 'ready' : 'failed', errorClass: code, ms: job.endedAt - job.startedAt, detail: detail || null
  });
}

async function run({ job, payload, image }) {
  if (job.endedAt) return;                       // cancelled while it waited
  job.state = 'running';
  const cfg = cfgStore.load();
  const adapter = adapterFor(cfg.provider);
  if (!adapter || !cfgStore.isEnabled()) return end(job, { code: 'off' });
  const jobDir = adapter.spawns === false ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'coach-'));
  try {
    const env = cfgStore.jobEnv(jobDir || os.tmpdir(), cfgStore.credentialFor(job.uid));
    jobs.prepareJobDir(jobDir);
    const attempt = await runPipeline({
      adapter, cfg, kind: job.kind, payload,
      model: image ? cfgStore.visionModelFor(cfg) : cfgStore.modelFor(cfg),
      timeoutMs: jobs.TIMEOUT_MS, images: image ? [image] : null, maxTokens: FOOD_MAX_TOKENS,
      invokeOpts: { jobDir, env, fetch: fetchFor(jobs.TIMEOUT_MS), signal: job.ctl.signal }
    });
    if (job.endedAt) return;                     // cancelled while the provider was thinking
    if (!attempt.ok) return end(job, { code: attempt.errorClass || 'provider', detail: attempt.detail });
    end(job, { result: attempt.result });
  } finally {
    jobs.cleanJobDir(jobDir);
  }
}

/** What the app polls. A job nobody knows — or one a restart forgot — is `restart`. */
export function get(uid, id) {
  const job = store.get(String(id || ''));
  if (!job || job.uid !== uid) return { state: 'failed', code: 'restart' };
  if (job.state === 'done') return { state: 'done', kind: job.kind, result: job.result };
  if (job.state === 'failed') return { state: 'failed', code: job.code || 'provider' };
  return { state: job.state, kind: job.kind, waitedMs: Date.now() - job.startedAt, budgetMs: jobs.TIMEOUT_MS + POLL_GRACE_MS };
}

/** The sheet was closed: stop the call where it can be stopped, and forget the picture. */
export function cancel(uid, id) {
  const job = store.get(String(id || ''));
  if (!job || job.uid !== uid || job.endedAt) return { ok: true };
  const i = waiting.findIndex(w => w.job === job);
  if (i >= 0) waiting.splice(i, 1);
  job.ctl?.abort();
  end(job, { code: 'cancelled' });
  return { ok: true };
}

/** Consent withdrawn or the account removed: nothing of theirs keeps running or waits here. */
export function dropUser(uid) {
  for (const [id, job] of store) if (job.uid === uid) { cancel(uid, id); store.delete(id); }
}

/* ------------------------------ the admin's vision check ------------------------------ */

// A 64×64 picture of one flat colour, made here so the check needs no file and no network:
// a provider that receives pictures names the colour, one that does not cannot.
function solidPng(r, g, b, size = 64) {
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) {
  let c = ~0;
  for (const byte of buf) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

/**
 * "Can the configured model actually see?" — one small request with a red square in it.
 * `seen` is the honest part: true only when the answer names the colour.
 */
export async function probeVision() {
  const cfg = cfgStore.load();
  const adapter = adapterFor(cfg.provider);
  if (!adapter) return { ok: false, error: 'no provider configured' };
  if (adapter.images !== true) return { ok: false, error: 'this provider cannot be sent pictures — pick one of the API providers' };
  const model = cfgStore.visionModelFor(cfg);
  if (adapter.spawns !== false) return { ok: true, seen: true, model, note: 'the built-in test provider answers from a script and looks at nothing' };
  const env = cfgStore.jobEnv(os.tmpdir(), cfgStore.credentialFor(cfgStore.boundUidFor(cfg)));
  const r = await adapter.invoke({
    cfg, env, model, timeoutMs: 120000, fetch: fetchFor(120000), maxTokens: 200,
    system: 'You are shown one picture. Answer with JSON only.',
    prompt: 'The picture is a square of a single flat colour. Reply with exactly this JSON object, naming the colour in English: {"coach_contract":1,"colour":"<colour>"}',
    images: [{ mime: 'image/png', data: solidPng(220, 30, 30).toString('base64') }]
  });
  if (r.timedOut) return { ok: false, model, error: 'the provider did not answer in time' };
  if (r.code !== 0) return { ok: false, model, error: (r.stderr || r.text || '').trim().slice(0, 300) || 'the provider refused the request' };
  const parsed = extractJSON(r.text);
  const colour = parsed.error ? '' : String(parsed.value?.colour || parsed.value?.color || '').toLowerCase();
  return { ok: true, model, seen: /red|crimson|scarlet/.test(colour), answer: colour.slice(0, 40) || String(r.text || '').slice(0, 80) };
}

// A forget (consent withdrawn, "reset everything", the account deleted) reaches this lane too.
jobs.onForget(dropUser);
