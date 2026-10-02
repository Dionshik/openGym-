import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button, Switch, TextField } from '../components/ui.jsx'

/* The switches on the admin dashboard for the features that move personal data across a
 * boundary: online food lookup (out, to Open Food Facts), the Apple Health connection (in, from
 * members' phones) and stored photos (onto this server's disk). All are off on a fresh instance
 * and stay off until flipped here.
 *
 * English-only like the rest of this screen (see the header of Admin.jsx).
 */
export default function AdminExtras() {
  const toast = useUI(s => s.toast)
  const refreshConfig = useStore(s => s.refreshConfig)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('/api/admin/extras').then(setD).catch(() => setD(false)) }, [])
  // An older API has no such route: the card is simply absent.
  if (!d) return null

  const patch = async (body, said) => {
    setBusy(true)
    try { setD(await api('/api/admin/extras', { method: 'POST', body: JSON.stringify(body) })); await refreshConfig(); if (said) toast(said) }
    catch (e) { toast(e.message || 'Could not save') }
    finally { setBusy(false) }
  }

  return <div className="card">
    <h2 style={{ margin: 0 }}>Nutrition &amp; Health</h2>
    <div className="adm-lead">The food diary and the body profile work without either of these. Each switch lets data cross a boundary, so each is yours to decide.</div>

    <div className="adm-group-t">Online food lookup</div>
    <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
      <div className="adm-hint" style={{ margin: 0 }}>
        <b>Let members look products up in Open Food Facts.</b> By barcode digits or by name. The request goes from this server, not from their phones: what leaves is the barcode or the search phrase, never who asked. Answers are cached here.
      </div>
      <Switch checked={!!d.food.lookup} disabled={busy || d.food.forcedOff} onChange={v => patch({ food: { lookup: v } })} />
    </div>
    {d.food.forcedOff && <div className="adm-hint" style={{ color: 'var(--orange)' }}>Switched off by FOOD_LOOKUP_DISABLED in the server's environment.</div>}
    {d.food.lookup && <>
      <div className="adm-field" style={{ marginTop: 8 }}>
        <label>Contact for the database's operators</label>
        <TextField defaultValue={d.food.contact} placeholder="you@example.org — sent in the User-Agent, as Open Food Facts asks"
          onBlur={e => e.target.value !== d.food.contact && patch({ food: { contact: e.target.value } })} />
      </div>
      <div className="adm-kv"><span className="k">Cached</span>
        <span className="v">{d.food.cache.products} products · {d.food.cache.searches} searches
          {(d.food.cache.products + d.food.cache.searches) > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ clearFoodCache: true }, 'Cache emptied')}>Empty</Button>}</span></div>
      <div className="adm-hint">Data from Open Food Facts is under the Open Database License; the app credits it where it is shown.</div>
    </>}

    <div className="adm-group-t" style={{ marginTop: 16 }}>Apple Health</div>
    <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
      <div className="adm-hint" style={{ margin: 0 }}>
        <b>Let members send body data from their iPhone.</b> A Shortcut on the phone posts weight, body fat and waist here once a day, with a token made on the member's Body screen. The token can add that member's measurements and read nothing.
      </div>
      <Switch checked={!!d.health.enabled} disabled={busy} onChange={v => patch({ health: { enabled: v } })} />
    </div>
    {d.health.enabled && <>
      <div className="adm-hint" style={{ color: 'var(--orange)' }}>Nothing in ./data is encrypted and you can read every member's file. Tell them so before they connect.</div>
      <div className="adm-field" style={{ marginTop: 8 }}>
        <label>Link to your shared Shortcut (optional)</label>
        <TextField defaultValue={d.health.shortcutUrl} placeholder="https://www.icloud.com/shortcuts/…"
          onBlur={e => e.target.value !== d.health.shortcutUrl && patch({ health: { shortcutUrl: e.target.value } })} />
      </div>
      <div className="adm-hint">Build the Shortcut once (docs/HEALTH_SHORTCUT.md), share it from your iPhone, and paste the iCloud link here — members then install it instead of building their own.</div>
      <div className="adm-kv"><span className="k">Connected</span><span className="v">{d.health.users} members · {d.health.tokens} tokens</span></div>
    </>}

    {/* Absent against an older API that has no photo store. */}
    {d.photos && <>
      <div className="adm-group-t" style={{ marginTop: 16 }}>Stored photos</div>
      <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div className="adm-hint" style={{ margin: 0 }}>
          <b>Let members keep photos of their body and their meals.</b> Progress photos by pose, and a picture beside a diary entry. They are shrunk on the phone, stripped of location data, and stored as files under <code>./data/photos</code>. No screen here shows them, and no API route serves a member's photo to anyone else.
        </div>
        <Switch checked={!!d.photos.enabled} disabled={busy} onChange={v => patch({ photos: { enabled: v } })} />
      </div>
      {(d.photos.enabled || d.photos.files > 0) && <>
        <div className="adm-hint" style={{ color: 'var(--orange)' }}>The files are not encrypted: anyone who can read this server's disk, or a backup of ./data, can open them. Tell members so before they use it.</div>
        <div className="adm-kv"><span className="k">Stored</span><span className="v">{d.photos.files} photos · {mb(d.photos.bytes)} · {d.photos.users} members</span></div>
      </>}
      {d.photos.enabled && <>
        <div className="adm-field" style={{ marginTop: 8 }}>
          <label>Storage per member, MB</label>
          <TextField key={'q' + d.photos.quotaMb} inputMode="numeric" defaultValue={d.photos.quotaMb}
            onBlur={e => +e.target.value !== d.photos.quotaMb && patch({ photos: { quotaMb: Math.round(+e.target.value) } })} />
        </div>
        <div className="adm-field" style={{ marginTop: 8 }}>
          <label>Delete meal photos after, days (0 keeps them)</label>
          <TextField key={'m' + d.photos.mealDays} inputMode="numeric" defaultValue={d.photos.mealDays}
            onBlur={e => +e.target.value !== d.photos.mealDays && patch({ photos: { mealDays: Math.round(+e.target.value) } })} />
        </div>
        <div className="adm-hint">Meal photos are most of the volume — roughly 200 MB a year for someone who photographs every meal. Body photos are never deleted by age. The whole of ./data/photos is in your backup.</div>
      </>}
      {!d.photos.enabled && d.photos.files > 0 && <div className="adm-hint">Switching this off hides the photos and stops uploads; the files stay on disk until each member deletes theirs or the account is removed.</div>}
    </>}
  </div>
}
const mb = bytes => (bytes >= 1024 * 1024 * 1024 ? (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB' : (bytes / 1024 / 1024).toFixed(1) + ' MB')
