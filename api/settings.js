/* Instance settings an admin changes from the dashboard, for the features that are not the Coach.
 *
 * `settings.json`, beside db.json. Its own small file for the same reason pool.json is: db.json
 * holds credentials and is rewritten whole on every save, and a switch for "may this server
 * look food up online" has no business sharing a write path with passkeys.
 *
 * Everything defaults to off. What is in here decides whether the server contacts a third
 * party at all, and an instance that never opened the dashboard must behave as it always did.
 */
import fs from 'node:fs';
import path from 'node:path';

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const httpsUrl = v => { try { const u = new URL(str(v, 300)); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };

export const DEFAULTS = {
  // Online food lookup through Open Food Facts (food.js). `contact` goes into the User-Agent the
  // database asks every client to send, so its operators can reach whoever runs this instance.
  food: { lookup: false, contact: '' },
  // Apple Health ingest (healthkit.js). `shortcutUrl` is the iCloud link to the owner's own copy
  // of the Shortcut, shown to members so they do not have to build it by hand.
  health: { enabled: false, shortcutUrl: '' }
};

export function createSettings({ dataDir, atomicWrite }) {
  const file = path.join(dataDir, 'settings.json');
  let state = structuredClone(DEFAULTS);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') {
      state = { food: { ...DEFAULTS.food, ...(raw.food || {}) }, health: { ...DEFAULTS.health, ...(raw.health || {}) } };
    }
  } catch { /* never saved: the defaults */ }

  return {
    get: () => state,
    /** Copies in the known fields by name; anything else on the patch is ignored. */
    patch(p = {}) {
      const next = structuredClone(state);
      if (p.food && typeof p.food === 'object') {
        if ('lookup' in p.food) next.food.lookup = p.food.lookup === true;
        if ('contact' in p.food) next.food.contact = str(p.food.contact, 120);
      }
      if (p.health && typeof p.health === 'object') {
        if ('enabled' in p.health) next.health.enabled = p.health.enabled === true;
        if ('shortcutUrl' in p.health) next.health.shortcutUrl = httpsUrl(p.health.shortcutUrl);
      }
      state = next;
      atomicWrite(file, JSON.stringify(state), 0o600);
      return state;
    }
  };
}
