/* The providers that speak plain HTTPS, described once for both runtimes.
 *
 * The server's config.PROVIDERS spreads these rows in next to the runtime-backed providers
 * (Claude Agent SDK, Codex CLI); the phone reads them directly for its own picker. Keeping the
 * facts in one place is what stops the two ever offering different endpoints or defaults.
 *
 * `defaultModel` is a starting point, not a pin. Every one of these providers lists its models
 * over the same API, and the UI offers that list — a name typed here goes stale, a list does
 * not. `compatible` has no default at all: an OpenAI-compatible endpoint is whatever the owner
 * pointed it at, so the model has to come from what that endpoint actually serves.
 */
export const HTTP_PROVIDERS = Object.freeze({
  anthropic: Object.freeze({
    label: 'Anthropic API', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'ANTHROPIC_API_KEY', oauthEnv: null,
    defaultBase: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5',
    keyPlaceholder: 'sk-ant-…'
  }),
  openai: Object.freeze({
    label: 'OpenAI API', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'OPENAI_API_KEY', oauthEnv: null,
    defaultBase: 'https://api.openai.com',
    defaultModel: 'gpt-5.6',
    keyPlaceholder: 'sk-…'
  }),
  gemini: Object.freeze({
    label: 'Google Gemini', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'GEMINI_API_KEY', oauthEnv: null,
    defaultBase: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-pro',
    keyPlaceholder: 'AIza… or AQ.…'
  }),
  // Ollama, LM Studio, vLLM, OpenRouter, a corporate gateway: anything that serves the
  // Chat Completions shape. The base URL is the whole configuration; a key is optional
  // because a model on your own LAN usually has none.
  //
  // `basicEnv` is the other way in: a model put behind a reverse proxy with a login prompt
  // (nginx `auth_basic` in front of LocalAI or Ollama is the usual way to expose one). The
  // proxy wants `Authorization: Basic …` where a key would be `Authorization: Bearer …` — one
  // header, so an endpoint is signed in to with a key or with a login, never both.
  compatible: Object.freeze({
    label: 'OpenAI-compatible endpoint', runtime: 'HTTPS', http: true,
    apiKeyEnv: 'OPENAI_COMPAT_API_KEY', oauthEnv: null, basicEnv: 'OPENAI_COMPAT_BASIC',
    defaultBase: null, baseUrl: true, keyOptional: true,
    defaultModel: null,
    keyPlaceholder: '(optional)'
  })
});

export const HTTP_PROVIDER_IDS = Object.freeze(Object.keys(HTTP_PROVIDERS));

/** The base URL a provider will actually be called at: the configured override, else the default. */
export function baseUrlFor(id, cfg) {
  const meta = HTTP_PROVIDERS[id];
  const set = cfg && cfg.providerOptions && cfg.providerOptions[id] && cfg.providerOptions[id].baseUrl;
  const raw = (typeof set === 'string' && set.trim()) || (meta && meta.defaultBase) || '';
  return raw.replace(/\/+$/, '');
}

/* Extra static headers a provider is called with (compatible endpoints only in practice):
 * gateways that demand routing/session headers (opencode Go's `x-opencode-session`,
 * `X-Title` style attribution headers elsewhere). Stored plaintext next to baseUrl —
 * routing aids, not credentials. Caps keep a mis-paste from becoming a smuggling vector:
 * at most 8 entries, token-shaped names, short values, and the names that would
 * override auth framing or transport are refused outright (re-checked at send time). */
export const MAX_HEADERS = 8;
export const MAX_HEADER_VALUE = 500;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/i;
const RESERVED_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'content-type', 'content-length',
  'host', 'connection', 'transfer-encoding', 'upgrade', 'cookie', 'set-cookie'
]);
export const isReservedHeader = name => RESERVED_HEADERS.has(String(name || '').toLowerCase());

export function validateHeaders(raw) {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'headers must be an object of name to value' };
  const names = Object.keys(raw);
  if (names.length > MAX_HEADERS) return { ok: false, error: `at most ${MAX_HEADERS} headers` };
  const out = {};
  for (const name of names) {
    const n = String(name).toLowerCase();
    if (!HEADER_NAME.test(name) || name.length > 64) return { ok: false, error: `bad header name: ${name}` };
    if (isReservedHeader(n)) return { ok: false, error: `header is reserved: ${name}` };
    const v = raw[name];
    if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `header ${name} needs a value` };
    if (v.length > MAX_HEADER_VALUE) return { ok: false, error: `header ${name} is too long` };
    out[n] = v.trim();
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

/** The extra headers a provider call carries: the configured map minus anything reserved
 *  (validated at write; this is the belt to that suspenders — a stored map from before a
 *  name was reserved must not override auth framing). */
export function extraHeadersFor(id, cfg) {
  const set = cfg && cfg.providerOptions && cfg.providerOptions[id] && cfg.providerOptions[id].headers;
  if (!set || typeof set !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(set)) {
    if (!isReservedHeader(k) && typeof v === 'string' && v) out[String(k).toLowerCase()] = v;
  }
  return out;
}

/**
 * Only http(s), only a parseable URL, and never credentials in it — a base URL is admin
 * configuration, but "admin-configured" and "safe to log" are different properties, and the
 * host is written into the job log so an operator can see where jobs went.
 */
export function validateBaseUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: true, value: null };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'not a valid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'only http:// and https:// endpoints are supported' };
  if (u.username || u.password) return { ok: false, error: 'put the key or the login in the credential step, not in the URL' };
  if (u.search || u.hash) return { ok: false, error: 'a base URL has no query string' };
  return { ok: true, value: u.toString().replace(/\/+$/, '') };
}

/* ---------- username + password (HTTP Basic, RFC 7617) ---------- */

const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The pair as it is stored and carried: "user:password". The user name cannot hold a colon —
 * the first one is where the server splits — and neither half may hold a control character,
 * which is how a header gets a second line. The password is taken as typed: a leading or
 * trailing space may be part of it.
 */
export function basicPair(username, password) {
  const user = String(username == null ? '' : username).trim();
  const pass = String(password == null ? '' : password);
  if (!user) return { ok: false, error: 'no username supplied' };
  if (!pass) return { ok: false, error: 'no password supplied' };
  if (user.includes(':')) return { ok: false, error: 'a username cannot contain ":"' };
  if (CONTROL.test(user) || CONTROL.test(pass)) return { ok: false, error: 'the username or password holds a control character' };
  if (user.length > 200 || pass.length > 400) return { ok: false, error: 'the username or password is too long' };
  return { ok: true, value: user + ':' + pass };
}

/** The Authorization value for a stored pair. UTF-8 first, so a Cyrillic password survives —
 *  btoa alone throws on anything outside Latin-1. Runs the same in node and in a WebView. */
export function basicHeader(pair) {
  const bytes = new TextEncoder().encode(String(pair));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'Basic ' + btoa(bin);
}
