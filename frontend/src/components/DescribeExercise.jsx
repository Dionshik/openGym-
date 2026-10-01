import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { DEMO } from '../lib/demo.js'
import { matchExercises, lookupErrorText, disclosure } from '../lib/coach-api.js'
import { emptyCoach } from '../lib/coach.js'
import { candidatesFor, draftFor, hasLookupConsent, MAX_TEXT, LOOKUP_CONSENT_VERSION } from '../lib/exercise-match.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { useSheetKeyboard, tappable } from '../lib/use-sheet-keyboard.js'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

/* "Describe it in your own words" — a mode of the exercise picker, like "By muscle".
 *
 * The user types what they want to add the way they would say it; the Coach's provider says
 * which exercises that is; the rows it resolved to are offered exactly like search results —
 * tap for the config sheet, "+" to add with the defaults — and under each sits the draft of a
 * new exercise for when the library does not have it. Nothing is added until the user picks.
 *
 * It lives inside the picker rather than in a sheet of its own so that whatever opened the
 * picker keeps working unchanged: the add flows leave it open for the next pick, and a swap
 * closes it after one.
 */
export default function DescribeExercise({ onPick, onCreate, onBack, initial = '' }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState(null)       // null = nothing asked yet
  const [error, setError] = useState('')
  const [added, setAdded] = useState(() => new Set())
  const [info, setInfo] = useState(null)
  const inputRef = useRef(null)
  const onFocus = useSheetKeyboard(inputRef)
  const agreed = DEMO || hasLookupConsent(S)

  useEffect(() => { let on = true; disclosure().then(d => { if (on) setInfo(d) }).catch(() => {}); return () => { on = false } }, [])

  const provider = info?.host || info?.providerLabel || config?.coach?.providerLabel || t('the configured AI provider')
  // What leaves, said next to the button that sends it. The demo has no provider at all.
  const fine = DEMO
    ? t('Demo: nothing leaves this browser — the app’s own search answers.')
    : info?.payer === 'you'
      ? t('Sent straight to {0} with your own API key: this text and the names of your own exercises. Nothing from your training log.', provider)
      : t('Sent to {0}: this text and the names of your own exercises. Nothing from your training log.', provider)

  const find = async () => {
    const asked = text.trim()
    if (!asked || busy) return
    setBusy(true)
    setError('')
    try {
      if (!agreed) {
        update(s => { s.coach = { ...(s.coach || emptyCoach()), lookupConsent: { agreedAt: new Date().toISOString(), version: LOOKUP_CONSENT_VERSION } } })
        // The server reads the go-ahead from its own copy of the state, not from this request,
        // so it has to be there before the request is.
        await useStore.getState().pushState()
      }
      const r = await matchExercises(asked)
      setItems(Array.isArray(r?.items) ? r.items : [])
      setAdded(new Set())
    } catch (e) {
      setError(lookupErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  const quickAdd = e => { onPick(e, true); setAdded(prev => new Set(prev).add(e.id)) }

  return <>
    <div className="row between" style={{ marginBottom: 10 }}><h3>{t('Describe the exercise')}</h3>
      <Button size="sm" variant="ghost" onClick={onBack}>{t('All')}</Button>
    </div>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('In your own words, in any language — one exercise or several. The AI finds them in the library, or drafts a new one.')}</div>
    {/* .picker-search keys the keyboard-aware sheet layout in index.css, as in the picker. */}
    <div className="picker-search">
      <textarea ref={inputRef} className="input" rows={3} maxLength={MAX_TEXT} value={text} onFocus={onFocus}
        placeholder={t('e.g. bench press, the pulldown machine, something for rear delts')}
        onChange={e => setText(e.target.value)} />
    </div>
    <Button variant="primary" icon="sparkles" disabled={busy || !text.trim()} onClick={find}>
      {busy ? t('Looking…') : agreed ? t('Find exercises') : t('Agree and find')}
    </Button>
    <div className="small dim" style={{ margin: '8px 2px 0' }}>{fine}</div>
    {error && <div className="small" role="alert" style={{ margin: '10px 2px 0', color: 'var(--red)', whiteSpace: 'pre-line' }}>{error}</div>}

    {items && items.length === 0 && !busy && <div className="empty">{t('No exercise found in that — try naming the movement or the machine.')}</div>}
    {items && items.map((item, i) => {
      const rows = candidatesFor(item, S)
      const draft = draftFor(item)
      return <div key={i}>
        <h4 className="sec">{item.said ? `“${item.said}”` : draft.n}</h4>
        <div className="list">
          {rows.map(e => <div key={e.id} className="item" {...tappable(() => onPick(e))}>
            <Thumb ex={e} /><div className="grow"><div className="tt capitalize">{exerciseNameFor(e)}</div><div className="ss capitalize">{t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · {t(e.eq)}</div></div>
            {added.has(e.id) && <span className="tag acc"><Icon name="check" /></span>}
            <button className="iconbtn chev" aria-label={t('Add “{0}”', exerciseNameFor(e))} style={{ padding: 8, margin: -8 }}
              onClick={ev => { ev.stopPropagation(); quickAdd(e) }}><Icon name="plus" /></button>
          </div>)}
          {draft.n && <div className="item" {...tappable(() => onCreate(draft))}>
            <div className="thumb thumb-x"><Icon name="sparkles" /></div>
            <div className="grow"><div className="tt">{t('Create “{0}”', draft.n)}</div>
              <div className="ss">{rows.length ? t('none of these — add it as your own exercise') : t('not in the library — add it as your own exercise')}</div></div>
            <Icon name="plus" className="chev" />
          </div>}
        </div>
      </div>
    })}
  </>
}
