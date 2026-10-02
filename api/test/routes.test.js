/* The admin routes, driven with fake server helpers — the layer between the card and the
 * config store, which learned per-provider keys, a base URL, a model list and the "this
 * provider spawns nothing" report. The user routes are exercised through jobs.test.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tempData } from './helpers.mjs';

tempData();
const cfg = await import('../coach/config.js');
const { coachRoutes } = await import('../coach/routes.js');

// Every test starts from an empty coach.json: reset() only forgets the cache, and save() merges
// over what is on disk, so a key filed by the previous test would otherwise still be there.
const fresh = (patch = {}) => { cfg.reset(); cfg.save({ enabled: true, provider: 'fixture', auth: {}, models: {}, providerOptions: {}, boundUid: {}, ...patch }); };

// The four helpers server.js hands in, as fakes: an admin is always signed in here.
function harness() {
  const out = {};
  const routes = coachRoutes({
    json: (res, status, body) => { res.status = status; res.body = body; },
    readBody: async req => req.body || {},
    readSession: () => ({ id: 'admin-1', admin: true }),
    requireAdmin: () => true
  });
  const call = async (key, body) => { const res = {}; await routes[key]({ body }, res); return res; };
  out.call = call; out.routes = routes;
  return out;
}

/** A local endpoint speaking the OpenAI list shape, so no test ever reaches the internet. */
async function mockEndpoint(models = ['llama3', 'gemma']) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: models.map(id => ({ id })) }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('the admin card is told which providers hold a key, and switching never drops one', async () => {
  const mock = await mockEndpoint();
  try {
    fresh();
    const { call } = harness();

    // The active provider is the local endpoint; keys for two cloud providers are filed while
    // they are NOT active — the chips can be prepared ahead of switching.
    let r = await call('POST /api/admin/coach/config', { provider: 'compatible', baseUrl: mock.base });
    assert.equal(r.status, 200);
    r = await call('POST /api/admin/coach/connect', { type: 'apikey', token: 'k-compat', account: 'lan' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await call('POST /api/admin/coach/connect', { provider: 'anthropic', type: 'apikey', token: 'sk-ant-x', account: 'me' });
    assert.equal(r.status, 200);
    r = await call('POST /api/admin/coach/connect', { provider: 'openai', type: 'apikey', token: 'sk-oa-x' });
    assert.equal(r.status, 200);

    r = await call('GET /api/admin/coach');
    assert.equal(r.status, 200);
    const byId = Object.fromEntries(r.body.providers.map(p => [p.id, p]));
    assert.equal(byId.compatible.connected, true);
    assert.equal(byId.anthropic.connected, true);
    assert.equal(byId.openai.connected, true);
    assert.equal(byId.gemini.connected, false);
    assert.equal(byId.compatible.keyOptional, true);
    assert.equal(byId.compatible.baseUrl, true);
    assert.equal(byId.claude.setupToken, true);
    assert.equal(byId.openai.http, true);
    assert.equal(byId.openai.defaultModel, 'gpt-5.6');
    assert.equal(r.body.auth.state, 'connected');
    assert.equal(r.body.auth.type, 'apikey');
    assert.equal(r.body.auth.account, 'lan');
    assert.ok(r.body.auth.connectedAt);
    assert.equal(r.body.model, null, 'a compatible endpoint has no default model');
    assert.deepEqual(r.body.unprivileged, { ok: true, dropped: false, why: 'this provider runs no child process' });
    assert.equal(r.body.runtime.ok, true, r.body.runtime.error);
    assert.match(r.body.runtime.version, /2 models/);
    assert.deepEqual(r.body.knownModels, ['gemma', 'llama3']);
    for (const secret of ['sk-ant-x', 'sk-oa-x', 'k-compat']) assert.ok(!JSON.stringify(r.body).includes(secret), 'no key ever comes back');

    // Each provider keeps its own model; switching away and back loses nothing.
    await call('POST /api/admin/coach/config', { model: 'llama3' });
    await call('POST /api/admin/coach/config', { provider: 'openai', model: 'gpt-x' });
    await call('POST /api/admin/coach/config', { provider: 'anthropic' });
    assert.equal(cfg.modelFor(), 'claude-opus-5', 'anthropic falls back to its default');
    assert.equal(cfg.modelFor(cfg.load(), 'openai'), 'gpt-x');
    assert.equal(cfg.credentialFor('alice').auth.token, 'sk-ant-x');
    await call('POST /api/admin/coach/config', { provider: 'compatible' });
    r = await call('GET /api/admin/coach');
    assert.equal(r.body.auth.state, 'connected');
    assert.equal(r.body.model, 'llama3');
    assert.equal(r.body.models.openai, 'gpt-x');

    // Disconnecting one provider leaves the others alone.
    r = await call('POST /api/admin/coach/disconnect', { provider: 'openai' });
    assert.equal(r.status, 200);
    r = await call('GET /api/admin/coach');
    assert.equal(r.body.auth.state, 'connected', 'the active provider is still connected');
    assert.equal(r.body.providers.find(p => p.id === 'openai').connected, false);
    assert.equal(r.body.providers.find(p => p.id === 'anthropic').connected, true);
  } finally { mock.close(); }
});

test('a key filed for a provider that does not take one, or an unknown provider, is refused', async () => {
  fresh();
  const { call } = harness();
  let r = await call('POST /api/admin/coach/connect', { type: 'apikey', token: 'x' });
  assert.equal(r.status, 400);
  r = await call('POST /api/admin/coach/connect', { provider: 'nope', type: 'apikey', token: 'x' });
  assert.equal(r.status, 400);
  r = await call('POST /api/admin/coach/connect', { provider: 'openai', type: 'cli-token', token: 'x' });
  assert.equal(r.status, 400, 'openai has no oauth variable');
  r = await call('POST /api/admin/coach/config', { provider: 'openai', baseUrl: 'http://x' });
  assert.equal(r.status, 400, 'openai has a fixed endpoint');
});

test('the compatible endpoint: base URL is validated, a keyless endpoint counts as connected, and models come from it', async () => {
  const mock = await mockEndpoint();
  const base = mock.base;
  try {
    fresh();
    const { call } = harness();
    let r = await call('POST /api/admin/coach/config', { provider: 'compatible', baseUrl: 'http://user:pw@x' });
    assert.equal(r.status, 400);
    r = await call('POST /api/admin/coach/config', { provider: 'compatible', baseUrl: base + '/' });
    assert.equal(r.status, 200);

    r = await call('GET /api/admin/coach');
    assert.equal(r.body.baseUrl, base);
    assert.equal(r.body.auth.state, 'optional');
    assert.equal(r.body.runtime.ok, true);
    assert.deepEqual(r.body.knownModels, ['gemma', 'llama3'], 'the status call already listed them');
    assert.equal(cfg.isConnected(), true);
    assert.equal(cfg.publicConfig().provider, 'compatible', 'the Coach is offered to users');

    r = await call('POST /api/admin/coach/models', {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.models, ['gemma', 'llama3']);

    r = await call('POST /api/admin/coach/config', { model: 'llama3' });
    assert.equal(cfg.modelFor(), 'llama3');
  } finally { mock.close(); }
});

/* A model behind a reverse proxy with a login prompt: nginx `auth_basic` in front of LocalAI. */
async function mockProxy(user, pass, models = ['qwen']) {
  const want = 'Basic ' + Buffer.from(user + ':' + pass, 'utf8').toString('base64');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.authorization || null);
    if (req.headers.authorization !== want) {
      res.statusCode = 401;
      res.setHeader('www-authenticate', 'Basic realm="Restricted Access"');
      res.setHeader('content-type', 'text/html');
      return res.end('<html><head><title>401 Authorization Required</title></head></html>');
    }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: models.map(id => ({ id })) }));
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

test('the compatible endpoint behind a login: a username and password are filed, sent as Basic, and never come back', async () => {
  const mock = await mockProxy('дима', 'p:w 1');
  try {
    fresh();
    const { call } = harness();
    let r = await call('POST /api/admin/coach/config', { provider: 'compatible', baseUrl: mock.base });
    assert.equal(r.status, 200);

    // Nothing filed: the card says what the address wants instead of quoting an HTML page.
    r = await call('GET /api/admin/coach');
    assert.equal(r.body.providers.find(p => p.id === 'compatible').basic, true);
    assert.equal(r.body.providers.find(p => p.id === 'openai').basic, false);
    assert.equal(r.body.auth.state, 'optional');
    assert.equal(r.body.runtime.ok, false);
    assert.match(r.body.runtime.error, /^401 the endpoint asks for a username and password/);
    assert.equal(r.body.runtime.needsLogin, true, 'the card sends the admin to the credential, not to "cannot be reached"');

    // Half a login, or one that cannot be a Basic pair, is refused before anything is stored.
    for (const bad of [{ username: 'дима' }, { password: 'x' }, { username: 'a:b', password: 'x' }, { username: 'a', password: 'x\r\ny' }]) {
      r = await call('POST /api/admin/coach/connect', { type: 'basic', ...bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal(cfg.authFor(), null);
    // …and so is a login for a provider that has no proxy in front of it.
    r = await call('POST /api/admin/coach/connect', { provider: 'openai', type: 'basic', username: 'a', password: 'b' });
    assert.equal(r.status, 400);

    // The wrong password: filed, sent, and reported as not accepted.
    r = await call('POST /api/admin/coach/connect', { type: 'basic', username: 'дима', password: 'wrong' });
    assert.equal(r.status, 200);
    r = await call('GET /api/admin/coach');
    assert.match(r.body.runtime.error, /^401 the endpoint did not accept this username and password/);
    assert.equal(r.body.runtime.needsLogin, true);

    r = await call('POST /api/admin/coach/connect', { type: 'basic', username: ' дима ', password: 'p:w 1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await call('GET /api/admin/coach');
    assert.equal(r.body.auth.state, 'connected');
    assert.equal(r.body.auth.type, 'basic');
    assert.equal(r.body.auth.account, 'дима', 'the username is the account label');
    assert.equal(r.body.runtime.ok, true, r.body.runtime.error);
    assert.equal(r.body.runtime.needsLogin, false);
    assert.deepEqual(r.body.knownModels, ['qwen']);
    assert.ok(!JSON.stringify(r.body).includes('p:w 1'), 'the password never comes back');
    assert.ok(mock.seen.at(-1).startsWith('Basic '));

    r = await call('POST /api/admin/coach/models', {});
    assert.deepEqual(r.body.models, ['qwen']);

    // At rest: encrypted, like a key.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const disk = fs.readFileSync(path.join(process.env.DATA_DIR, 'coach.json'), 'utf8');
    assert.ok(!disk.includes('p:w 1') && !disk.includes(Buffer.from('дима:p:w 1').toString('base64')), 'not in coach.json in any readable form');

    // What a job is handed: the pair under the provider's own variable, and no key beside it.
    const jobEnv = cfg.jobEnv('/tmp/x', cfg.credentialFor('alice'));
    assert.equal(jobEnv.OPENAI_COMPAT_BASIC, 'дима:p:w 1');
    assert.equal(jobEnv.OPENAI_COMPAT_API_KEY, undefined);
    assert.equal(cfg.credentialFor('bob').ok, true, 'a login is shared by the instance like a key — it binds to nobody');

    // A key filed afterwards replaces the login: one Authorization header, one credential.
    r = await call('POST /api/admin/coach/connect', { type: 'apikey', token: 'k-compat' });
    assert.equal(r.status, 200);
    const after = cfg.jobEnv('/tmp/x', cfg.credentialFor('alice'));
    assert.equal(after.OPENAI_COMPAT_API_KEY, 'k-compat');
    assert.equal(after.OPENAI_COMPAT_BASIC, undefined);
  } finally { mock.close(); }
});

test('the disclosure names the provider and the same five categories the payload builds from', async () => {
  fresh({ provider: 'gemini' });
  const { call } = harness();
  const r = await call('GET /api/coach/disclosure');
  assert.equal(r.status, 200);
  assert.equal(r.body.providerLabel, 'Google Gemini');
  assert.deepEqual(r.body.categories, ['plan', 'training', 'bodyweight', 'profile', 'prefs']);
});

/* ---------- debrief + cohort routes ---------- */
test('a debrief is enqueued as its own kind, and the cohort routes gate on the admin switch and the opt-in', async () => {
  fresh({ community: false });
  const jobs = await import('../coach/jobs.js');
  const { writeState, sampleState } = await import('./helpers.mjs');
  const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
  forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });
  writeState(process.env.DATA_DIR, 'admin-1', sampleState());
  const { call } = harness();

  const off = await call('GET /api/coach/cohort');
  assert.deepEqual(off.body, { ok: false, enabled: false });

  const cfgOn = await call('POST /api/admin/coach/config', { community: true });
  assert.equal(cfgOn.status, 200);
  assert.equal(cfg.load().community, true);
  assert.equal((await call('GET /api/admin/coach')).body.community, true);
  assert.equal(cfg.publicConfig().community, true);

  const notSharing = await call('GET /api/coach/cohort');
  assert.deepEqual(notSharing.body, { ok: false, enabled: true, sharing: false });
  const share = await call('POST /api/coach/cohort/share', { share: true });
  assert.deepEqual(share.body, { ok: true, sharing: true });
  assert.equal(jobs.isSharing('admin-1'), true);
  const alone = await call('GET /api/coach/cohort');
  assert.equal(alone.body.ok, false);
  assert.equal(alone.body.sharing, true);
  assert.equal(alone.body.people, 1);

  const r = await call('POST /api/coach/debrief', { workoutId: 'w1' });
  assert.equal(r.status, 202);
  assert.equal(jobs.status('admin-1').job.kind, 'debrief');
  const until = Date.now() + 15000;
  while (jobs.status('admin-1').job && Date.now() < until) await new Promise(res => setTimeout(res, 25));
  const s = jobs.status('admin-1');
  assert.equal(s.pending.kind, 'debrief');
  assert.deepEqual(s.pending.workout, { id: 'w1', d: '2026-07-20', name: 'Full body A', minutes: 45, vol: 600, sets: 3, prs: 0 });
  assert.equal(s.pending.score, 8);
  assert.ok(s.pending.summary.includes('3 sets'));
  assert.ok(Array.isArray(s.pending.nextTime) && s.pending.nextTime.length);
  assert.equal('changes' in s.pending, false);

  // A profile with nothing logged cannot be debriefed.
  jobs.resolvePending('admin-1', { accepted: ['debrief'] });
  writeState(process.env.DATA_DIR, 'admin-1', sampleState({ workouts: [] }));
  await call('POST /api/coach/debrief', {});
  while (jobs.status('admin-1').job && Date.now() < until) await new Promise(res => setTimeout(res, 25));
  assert.equal(jobs.status('admin-1').last.errorClass, 'noworkout');
});
