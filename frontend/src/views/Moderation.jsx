import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { modPool, approveSuggestion, declineSuggestion, updateShared, retireShared, splitModPool, poolErrorText } from '../lib/pool.js'
import { confirmSheet, poolExSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { InvitesCard } from './Admin.jsx'
import '../admin.css'

// The moderation screen: what admins and moderators share.
//
// Members suggest their own exercises for everyone (the button on a custom exercise); this is
// where somebody decides. Approving puts the exercise in every profile's library on this
// instance, declining sends it back with a note, and a shared exercise can be corrected or
// retired later — never deleted, because people's routines and logs may already name it.
//
// Unlike the admin dashboard this screen is translated: a moderator is a member, not the
// person who runs the box. The invite-code card is the admin page's own and stays English.

function Decline({ row, onDone, close }) {
  const [note, setNote] = useState('')
  return <>
    <h3>{t('Decline “{0}”?', row.n)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Say why, so {0} knows what to change. They can correct it and suggest it again.', row.byName || t('the member'))}</div>
    <textarea className="input" rows={3} maxLength={200} value={note} placeholder={t('e.g. the library already has this as “barbell bench press”')}
      onChange={e => setNote(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="danger" onClick={() => { close(); onDone(note.trim()) }}>{t('Decline')}</Button>
  </>
}

const line = r => [t(r.bp), r.eq ? t(r.eq) : '', ...(r.primaries || []).map(m => t(MUSCLE_NAME[m] || m))].filter(Boolean).join(' · ')

export default function Moderation() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [items, setItems] = useState(null)
  const [invites, setInvites] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [showDeclined, setShowDeclined] = useState(false)

  const load = () => modPool().then(r => setItems(r.items)).catch(e => toast(t(poolErrorText(e))))
  const loadInvites = () => api('/api/admin/invites').then(d => { setInvites(d.invites); setInviteOnly(!!d.invite_only) }).catch(() => {})
  useEffect(() => { if (user?.mod) { load(); loadInvites() } }, [])
  if (!user?.mod) return null

  // Every decision changes what this device's own library should show too.
  const act = (call, done) => call()
    .then(() => { toast(done); load(); useStore.getState().pullPool(true) })
    .catch(e => toast(t(poolErrorText(e))))

  const { pending, shared, declined } = splitModPool(items)
  const approve = r => act(() => approveSuggestion(r.id), t('“{0}” is now shared with everyone', r.n))
  const editApprove = r => poolExSheet(r, ex => act(() => approveSuggestion(r.id, ex), t('“{0}” is now shared with everyone', ex.n)), t('Correct and approve'))
  const decline = r => openSheet(close => <Decline row={r} close={close} onDone={note => act(() => declineSuggestion(r.id, note), t('Declined'))} />)
  const edit = r => poolExSheet(r, ex => act(() => updateShared(r.id, ex), t('Saved')), t('Edit shared exercise'))
  const retire = r => confirmSheet({
    title: t('Stop offering “{0}”?', r.n),
    message: t('It disappears from the library and the exercise picker for everyone. Routines and workout history that already use it keep working.'),
    confirmText: t('Retire'), danger: true,
    onConfirm: () => act(() => retireShared(r.id, true), t('Retired'))
  })
  const restore = r => act(() => retireShared(r.id, false), t('Offered again'))

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Moderation')}</h1>
        <div className="sub">{items ? t('{0} waiting · {1} shared', pending.length, shared.filter(r => r.status === 'approved').length) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={() => { load(); loadInvites() }} aria-label={t('Refresh')}>↻</button>
    </div>
    <div className="adm-intro">{t('Exercises people suggested for everyone on this server. What you approve appears in every profile’s library.')}</div>

    <div className="card">
      <h2 style={{ margin: 0 }}>{t('Waiting for a decision')}</h2>
      <div className="adm-lead">{t('Check the name, the body part and the equipment. If the library already has it under another name, decline and say which.')}</div>
      {pending.map(r => <div key={r.id} style={{ padding: '10px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <div className="small" style={{ fontWeight: 600 }}>{r.n}</div>
        <div className="dim" style={{ fontSize: '.76rem' }}>{line(r)}{r.byName ? ' · ' + t('suggested by {0}', r.byName) : ''}</div>
        {r.desc && <div className="exnote" style={{ marginTop: 6 }}>{r.desc}</div>}
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="primary" icon="check" onClick={() => approve(r)}>{t('Approve')}</Button>
          <Button size="sm" icon="pencil" onClick={() => editApprove(r)}>{t('Correct and approve')}</Button>
          <Button size="sm" variant="danger" onClick={() => decline(r)}>{t('Decline')}</Button>
        </div>
      </div>)}
      {items && !pending.length && <div className="adm-empty">{t('Nothing waiting.')}</div>}
    </div>

    <div className="card">
      <h2 style={{ margin: 0 }}>{t('Shared with everyone')}</h2>
      <div className="adm-lead">{t('Approved exercises. Retiring one stops offering it without breaking anybody’s history.')}</div>
      {shared.map(r => <div key={r.id} className="row between" style={{ padding: '8px 0', borderBottom: 'var(--hair) solid var(--sep)', opacity: r.status === 'retired' ? .55 : 1 }}>
        <div className="grow"><div className="small" style={{ fontWeight: 600 }}>{r.n}{r.status === 'retired' && <span className="adm-pill" style={{ marginLeft: 6 }}>{t('retired')}</span>}</div>
          <div className="dim" style={{ fontSize: '.76rem' }}>{line(r)}{r.byName ? ' · ' + t('suggested by {0}', r.byName) : ''}</div></div>
        <div className="row" style={{ gap: 4, flex: 'none' }}>
          <button className="iconbtn adm-iconbtn" onClick={() => edit(r)} aria-label={t('Edit')}><Icon name="pencil" /></button>
          {r.status === 'retired'
            ? <button className="iconbtn adm-iconbtn" onClick={() => restore(r)} aria-label={t('Offer again')}><Icon name="reset" /></button>
            : <button className="iconbtn adm-iconbtn" style={{ color: 'var(--red)' }} onClick={() => retire(r)} aria-label={t('Retire')}><Icon name="xmark" /></button>}
        </div>
      </div>)}
      {items && !shared.length && <div className="adm-empty">{t('Nothing shared yet.')}</div>}
    </div>

    {declined.length > 0 && <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>{t('Declined')}</h2>
        <Button size="sm" variant="ghost" onClick={() => setShowDeclined(v => !v)}>{showDeclined ? t('Hide') : t('Show') + ' (' + declined.length + ')'}</Button></div>
      {showDeclined && declined.map(r => <div key={r.id} style={{ padding: '8px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <div className="small" style={{ fontWeight: 600 }}>{r.n}</div>
        <div className="dim" style={{ fontSize: '.76rem' }}>{line(r)}{r.byName ? ' · ' + t('suggested by {0}', r.byName) : ''}</div>
        {r.note && <div className="exnote" style={{ marginTop: 6 }}>{r.note}</div>}
      </div>)}
    </div>}

    <InvitesCard invites={invites} reload={loadInvites} inviteOnly={inviteOnly} />
  </div>
}
