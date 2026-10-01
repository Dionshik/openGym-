import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, apiBase } from '../lib/api.js'
import { t, dateLocale } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

/* The Apple Health connection, on the Body screen.
 *
 * A web app cannot read the Health app, so the bridge is a Shortcut on the iPhone that reads a
 * few samples once a day and posts them to this server (api/healthkit.js). This card is the
 * app's half: it makes the token the Shortcut carries, shows it exactly once, says where to
 * send what, and lets the person see that deliveries arrive — or stop them.
 *
 * Present only where the instance offers it (config.health) and somebody is signed in.
 */
const toast = m => useUI.getState().toast(m)
const when = ms => new Date(ms).toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function HealthConnect() {
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const health = useStore(s => s.health)
  const pullHealth = useStore(s => s.pullHealth)
  const setHealth = useStore(s => s.setHealth)
  const [busy, setBusy] = useState(false)
  const on = !!(user && config?.health)
  useEffect(() => { if (on) pullHealth() }, [on])
  if (!on) return null

  const tokens = health?.tokens || []
  const endpoint = (apiBase() || window.location.origin) + '/api/healthkit/ingest'

  const connect = async () => {
    setBusy(true)
    try {
      const r = await api('/api/healthkit/token', { method: 'POST', body: '{}' })
      setHealth({ tokens: r.tokens })
      useUI.getState().openSheet(close => <TokenSheet token={r.token} endpoint={endpoint} shortcutUrl={health?.shortcutUrl} close={close} />, { locked: true })
    } catch (e) {
      toast(e.data?.code === 'cap' ? t('You already have three tokens — revoke one first.') : t('Could not create a token.'))
    } finally { setBusy(false) }
  }
  const revoke = tk => confirmSheet({
    title: t('Revoke this token?'), message: t('The Shortcut that uses it will stop delivering. What it already delivered stays.'),
    confirmText: t('Revoke'), danger: true,
    onConfirm: async () => {
      try { const r = await api('/api/healthkit/token/revoke', { method: 'POST', body: JSON.stringify({ id: tk.id }) }); setHealth({ tokens: r.tokens }) }
      catch { toast(t('Could not revoke the token.')) }
    }
  })
  const forget = () => confirmSheet({
    title: t('Forget what Health delivered?'),
    message: t('Removes the delivered readings from the server. Weigh-ins and measurements already copied into your profile stay — delete those where you see them.'),
    confirmText: t('Forget'), danger: true,
    onConfirm: async () => {
      try { await api('/api/healthkit/clear', { method: 'POST', body: '{}' }); await pullHealth(); toast(t('Forgotten')) }
      catch { toast(t('Could not reach the server.')) }
    }
  })

  return <div className="card">
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{t('Apple Health')}</h2>
      <Button size="sm" icon="plus" disabled={busy} onClick={connect}>{tokens.length ? t('New token') : t('Connect')}</Button>
    </div>
    <div className="muted small" style={{ lineHeight: 1.45 }}>
      {t('A Shortcut on your iPhone can send your weight, body fat and waist from the Health app here once a day. It goes from your phone to this server and nowhere else.')}
    </div>
    {health && <div className="nt-note">
      <Icon name={health.lastIngest ? 'checkCircle' : 'clock'} style={health.lastIngest ? { color: 'var(--green)' } : undefined} />
      {health.lastIngest ? t('Last delivery: {0}', when(health.lastIngest)) : t('Nothing received yet.')}
    </div>}
    {!!tokens.length && <>
      <h4 className="sec">{t('Tokens')}</h4>
      {tokens.map(tk => <div key={tk.id} className="row between" style={{ padding: '7px 0', borderBottom: '1px solid var(--sep)' }}>
        <span className="small">{t('Created {0}', when(tk.created))}<span className="muted"> · {tk.lastUsed ? t('used {0}', when(tk.lastUsed)) : t('never used')}</span></span>
        <button className="iconbtn" style={{ width: 32, height: 30, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(tk)} aria-label={t('Revoke')}><Icon name="trash" /></button>
      </div>)}
      <div style={{ height: 10 }} />
      <Button variant="ghost" className="dim" icon="info" onClick={() => useUI.getState().openSheet(close => <TokenSheet endpoint={endpoint} shortcutUrl={health?.shortcutUrl} close={close} />)}>{t('How to set up the Shortcut')}</Button>
      {!!health?.lastIngest && <Button variant="ghost" className="dim" icon="trash" onClick={forget}>{t('Forget delivered data')}</Button>}
    </>}
    <div className="dim small" style={{ marginTop: 10, lineHeight: 1.45 }}>{t('Data on this server is not encrypted and its administrator can read it.')}</div>
  </div>
}

// The token, once — and what to do with it. Opened again later without a token as plain
// instructions: the token itself cannot be shown a second time, only replaced.
function TokenSheet({ token, endpoint, shortcutUrl, close }) {
  const copy = async (text, said) => {
    try { await navigator.clipboard.writeText(text); toast(said) } catch { toast(t('Copy it by hand — this browser would not.')) }
  }
  return <>
    <h3>{token ? t('Your Health token') : t('Set up the Shortcut')}</h3>
    {token && <>
      <div className="muted small">{t('Copy it now. It is shown this once and cannot be read again — only replaced.')}</div>
      <code className="bd-token">{token}</code>
      <Button variant="tinted" icon="clipboard" onClick={() => copy(token, t('Token copied'))}>{t('Copy token')}</Button>
      <div style={{ height: 14 }} />
    </>}
    <div className="sect-t">{t('Where the Shortcut sends')}</div>
    <code className="bd-token">{endpoint}</code>
    <Button variant="ghost" icon="clipboard" onClick={() => copy(endpoint, t('Address copied'))}>{t('Copy address')}</Button>

    {shortcutUrl
      ? <>
        <div style={{ height: 10 }} />
        <a className="btn primary" href={shortcutUrl} target="_blank" rel="noreferrer"><Icon name="download" /><span>{t('Get the Shortcut')}</span></a>
        <div className="muted small" style={{ marginTop: 8, lineHeight: 1.45 }}>{t('Open the link on your iPhone, add the Shortcut, and paste the address and the token when it asks.')}</div>
      </>
      : <ol className="bd-steps">
        <li>{t('On the iPhone open Shortcuts and create a new shortcut.')}</li>
        <li>{t('Add the action “Find Health Samples”. Type: Weight. Add a filter: Start Date is today. Sort by Start Date, latest first. Limit: 1.')}</li>
        <li>{t('Optionally add the same action again for Body Fat Percentage and for Waist Circumference.')}</li>
        <li>{t('Add the action “Get Contents of URL”. URL: the address above. Method: POST.')}</li>
        <li>{t('Under Headers add')} <code>Authorization</code> {t('with the value')} <code>Bearer {token ? t('your token') : '<token>'}</code>.</li>
        <li>{t('Request Body: JSON. Add the text fields')} <code>weight</code>, <code>bodyFat</code>, <code>waist</code> {t('and set each to the Health Samples from its step. Add')} <code>date</code> {t('set to Current Date.')}</li>
        <li>{t('Run it once and allow access to Health. Then, in Automation, make it run daily at a time when the phone is in use — Health cannot be read while the phone is locked.')}</li>
      </ol>}
    <div className="dim small" style={{ marginTop: 10, lineHeight: 1.45 }}>{t('The full guide with screenshots-in-words is in the project docs: docs/HEALTH_SHORTCUT.md.')}</div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
