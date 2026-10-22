/* "Describe the workout you did": the provider call that reads a typed-out session.
 *
 * The exercise lookup's question asked about a whole workout, so it passes the lookup's gates —
 * the lookup go-ahead (`lookupConsent`, which covers exactly this: the typed words and the names
 * of the person's own exercises), the lookup's daily count — but it runs in a lane like the food
 * diary's rather than as an awaited request. A lookup is one sentence; a session is fifteen
 * exercises with their sets, and a local model on a home server can take longer over that than
 * the sixty seconds every proxy in front of this API waits. So the request returns an id at once
 * and the app asks for the result.
 *
 * Nothing is stored and nothing is logged in the diary: the answer waits in memory for a few
 * minutes to be collected, and the person checks every exercise and every set on the draft
 * before the workout is saved. The job log gets the kind, the outcome and the time — never the
 * text.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cfgStore from './config.js';
import * as jobs from './jobs.js';
import { adapterFor } from './adapters/index.js';
import { runPipeline } from './core/pipeline.js';
import { buildLogPayload, cleanLogText, isISODate, resolveLog } from './core/logtext.js';
import { withPoolRows } from './core/pool-view.js';
import { readPoolRows } from '../pool.js';
import { fetchFor } from './node-fetch.js';

const { CoachError } = jobs;
const DATA = process.env.DATA_DIR || '/data';
// How long a finished job waits to be collected. Longer than the app is ever willing to wait
// (30 minutes): an iPhone that locked mid-read stops polling, and its answer must still be here
// when it comes back. After that, the id is remembered for a while as expired, so the app can
// say so rather than claim the server restarted.
const RESULT_TTL_MS = 60 * 60000;
const EXPIRED_TTL_MS = 12 * 60 * 60000;
const POLL_GRACE_MS = 30000;
// Fifteen exercises with their rows is a couple of thousand tokens; a model that keeps going
// past that is rambling, and is cut short rather than left to burn the job budget.
const LOG_MAX_TOKENS = 6000;
export const KIND = 'logtext';

const store = new Map();               // job id → { uid, state, startedAt, endedAt?, result?, code?, ctl }
const active = new Map();              // uid → job id: one at a time per profile
const waiting = [];

const expired = new Map();             // job id → { uid, at }: collected too late
export function sweep(now = Date.now()) {
  for (const [id, j] of store) {
    if (j.endedAt && now - j.endedAt > RESULT_TTL_MS) { store.delete(id); expired.set(id, { uid: j.uid, at: now }); }
  }
  for (const [id, e] of expired) if (now - e.at > EXPIRED_TTL_MS) expired.delete(id);
}
setInterval(() => sweep(), 60000).unref();

const serverToday = () => new Date().toISOString().slice(0, 10);

/**
 * Start reading a workout. Throws CoachError (`off`, `empty`, `busy`, `consent`, `shared`,
 * `unprivileged`, `cap`) for a request that will not run.
 *
 * @param {{ text:string, today?:string }} req  `today` is the person's own date, YYYY-MM-DD:
 *   "yesterday" means their yesterday, and the server may sit in another time zone.
 */
export function start(uid, req = {}) {
  if (!cfgStore.isEnabled() || !cfgStore.isConnected()) throw new CoachError('off', 'the Coach is not set up on this instance');
  const text = cleanLogText(req.text);
  if (!text) throw new CoachError('empty', 'nothing to read');
  const cfg = cfgStore.load();
  const adapter = adapterFor(cfg.provider);
  if (!adapter) throw new CoachError('off', 'the Coach is not set up on this instance');
  if (active.has(uid)) throw new CoachError('busy', 'the last one is still being read');

  const S = jobs.admit(uid, { lookup: true });
  const caps = cfg.caps || {};
  const { used, limit } = jobs.matchCapState(uid);
  if (limit > 0 && used >= limit) throw new CoachError('cap', 'daily limit reached');
  if (caps.instanceDaily > 0 && jobs.instanceUsedToday() >= caps.instanceDaily) throw new CoachError('cap', 'this instance has reached its daily limit');
  jobs.bumpMatchDaily(uid);

  // The person's date when it is a believable one — within a day of the server's either way.
  const server = serverToday();
  const theirs = isISODate(req.today) && Math.abs(Date.parse(req.today) - Date.parse(server)) <= 86400000 ? req.today : server;

  const id = crypto.randomBytes(9).toString('hex');
  const job = { id, uid, state: 'queued', startedAt: Date.now(), ctl: new AbortController() };
  store.set(id, job);
  active.set(uid, id);
  waiting.push({ job, payload: buildLogPayload(S, text, { today: theirs }) });
  pump();
  return { id };
}

function pump() {
  while (waiting.length && jobs.acquireSlot()) {
    const next = waiting.shift();
    run(next)
      .catch(e => { console.error('logtext job crashed', next.job.id, e); end(next.job, { code: 'internal' }); })
      .finally(() => { jobs.releaseSlot(); pump(); });
  }
}
jobs.onSlotFree(pump);

function end(job, { result = null, code = null, detail = null }) {
  if (job.endedAt) return;
  job.state = result ? 'done' : 'failed';
  job.result = result;
  job.code = code;
  job.endedAt = Date.now();
  job.ctl = null;
  if (active.get(job.uid) === job.id) active.delete(job.uid);
  cfgStore.logJob({
    at: new Date().toISOString(), uid: job.uid, kind: KIND, trigger: 'manual',
    outcome: result ? 'ready' : 'failed', errorClass: code, ms: job.endedAt - job.startedAt, detail: detail || null
  });
}

async function run({ job, payload }) {
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
      adapter, cfg, kind: KIND, payload,
      model: cfgStore.modelFor(cfg), timeoutMs: jobs.TIMEOUT_MS, maxTokens: LOG_MAX_TOKENS,
      invokeOpts: { jobDir, env, fetch: fetchFor(jobs.TIMEOUT_MS), signal: job.ctl.signal }
    });
    if (job.endedAt) return;                     // cancelled while the provider was thinking
    if (!attempt.ok) return end(job, { code: attempt.errorClass || 'provider', detail: attempt.detail });
    // Resolved against the whole shared pool, as a lookup is: "the sled thing Ann added" should
    // be found. Only the payload above went to the provider.
    const S = jobs.readState(job.uid);
    end(job, { result: resolveLog(attempt.result, withPoolRows(S, readPoolRows(DATA), { all: true })) });
  } finally {
    jobs.cleanJobDir(jobDir);
  }
}

/** What the app polls. A job collected too late is `expired`; one nobody knows — or one a restart
 *  forgot — is `restart`. Another profile's job is unknown to this one, either way. */
export function get(uid, id) {
  const job = store.get(String(id || ''));
  if (!job || job.uid !== uid) {
    const e = expired.get(String(id || ''));
    return { state: 'failed', code: e && e.uid === uid ? 'expired' : 'restart' };
  }
  if (job.state === 'done') return { state: 'done', result: job.result, cap: jobs.matchCapState(uid) };
  if (job.state === 'failed') return { state: 'failed', code: job.code || 'provider' };
  return { state: job.state, waitedMs: Date.now() - job.startedAt, budgetMs: jobs.TIMEOUT_MS + POLL_GRACE_MS };
}

/** The sheet was closed: stop the call where it can be stopped. */
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
  for (const [id, e] of expired) if (e.uid === uid) expired.delete(id);
}
jobs.onForget(dropUser);
