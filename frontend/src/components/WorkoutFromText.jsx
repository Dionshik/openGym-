import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { DEMO } from '../lib/demo.js'
import { EXIDX } from '../lib/exercises.js'
import { todayISO, isoOf } from '../lib/format.js'
import { disclosure } from '../lib/coach-api.js'
import { emptyCoach } from '../lib/coach.js'
import { draftFor, hasLookupConsent, LOOKUP_CONSENT_VERSION } from '../lib/exercise-match.js'
import { readWorkoutText, workoutTextError } from '../lib/workout-text-api.js'
import { usageOf, logCandidates, initialChoices, setsLine, entriesFromDraft, unresolved, MAX_LOG_TEXT } from '../lib/workout-text.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { useSheetKeyboard, tappable } from '../lib/use-sheet-keyboard.js'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import Stepper from './Stepper.jsx'
import { Button, Row } from './ui.jsx'

/* "Describe the workout you did" — a past workout typed out in the person's own words.
 *
 * The AI copies the exercises, sets and day out of the text and says in English what each
 * exercise is; the app finds those in the library (and among the person's own and the shared
 * exercises). Then the person checks it, line by line: a line the app is sure of is shown as
 * chosen and can be changed, a line it is not sure of asks "which one did you mean?" with the
 * likely rows, a new exercise drafted from the description, a search of the whole library, or
 * leaving the line out. Only then does the workout open — on the ordinary "log a past workout"
 * screen, with the sets filled in and ticked, where anything can still be edited before it is
 * saved. Nothing is logged by this sheet.
 *
 * The sheet-opening pieces (the exercise form, the picker, the workout screen) are handed in by
 * sheets.jsx, which owns them, so this file does not import it back.
 */
export default function WorkoutFromText({ onOpen, onCreate, onSearch, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const config = useStore(s => s.config)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState('write')          // write | reading | review
  const [error, setError] = useState('')
  const [waited, setWaited] = useState(0)
  const [draft, setDraft] = useState(null)              // { items, date, start, minutes, unit }
  const [choices, setChoices] = useState([])
  const [open, setOpen] = useState(-1)                  // the line whose alternatives are unfolded
  const [date, setDate] = useState('')
  const [time, setTime] = useState('18:00')
  const [dur, setDur] = useState(60)
  const [info, setInfo] = useState(null)
  const ctl = useRef(null)
  const inputRef = useRef(null)
  const onFocus = useSheetKeyboard(inputRef)
  const agreed = DEMO || hasLookupConsent(S)
  const usage = useMemo(() => usageOf(S), [S])
  const today = todayISO()

  useEffect(() => { let on = true; disclosure().then(d => { if (on) setInfo(d) }).catch(() => {}); return () => { on = false } }, [])
  // The sheet closed while the AI was still reading: stop it, rather than spend the call.
  useEffect(() => () => ctl.current?.abort(), [])

  const provider = info?.host || info?.providerLabel || config?.coach?.providerLabel || t('the configured AI provider')
  const fine = DEMO
    ? t('Demo: nothing leaves this browser — the app’s own search answers.')
    : info?.payer === 'you'
      ? t('Sent straight to {0} with your own API key: this text and the names of your own exercises. Nothing from your training log.', provider)
      : t('Sent to {0}: this text and the names of your own exercises. Nothing from your training log.', provider)

  const read = async () => {
    const asked = text.trim()
    if (!asked || phase === 'reading') return
    setError('')
    setPhase('reading')
    setWaited(0)
    const c = new AbortController()
    ctl.current = c
    try {
      if (!agreed) {
        update(s => { s.coach = { ...(s.coach || emptyCoach()), lookupConsent: { agreedAt: new Date().toISOString(), version: LOOKUP_CONSENT_VERSION } } })
        // The server reads the go-ahead from its own copy of the state, not from this request.
        await useStore.getState().pushState()
      }
      const r = await readWorkoutText(asked, { signal: c.signal, onWait: ms => setWaited(Math.round(ms / 1000)) })
      const items = Array.isArray(r?.items) ? r.items : []
      const st = useStore.getState().S
      setDraft({ ...r, items })
      setChoices(initialChoices(items, st))
      const y = new Date(); y.setDate(y.getDate() - 1)
      setDate(r?.date && r.date <= today ? r.date : isoOf(y))
      setTime(r?.start || '18:00')
      setDur(r?.minutes || 60)
      setOpen(-1)
      setPhase('review')
    } catch (e) {
      if (e?.code === 'cancelled') { setPhase('write'); return }
      setError(workoutTextError(e))
      setPhase('write')
    } finally {
      ctl.current = null
    }
  }

  const choose = (i, id) => { setChoices(cs => cs.map((c, j) => (j === i ? { status: 'chosen', id } : c))); setOpen(-1) }
  const skip = i => { setChoices(cs => cs.map((c, j) => (j === i ? { status: 'skip', id: null } : c))); setOpen(-1) }
  const unskip = i => setChoices(cs => cs.map((c, j) => (j === i ? { status: 'ask', id: null } : c)))

  const go = () => {
    if (!date || date > today) { toast(t('Pick a day up to today')); return }
    const entries = entriesFromDraft(useStore.getState().S, draft.items, choices, { unit: draft.unit })
    onOpen({ date, time, durationMin: dur, entries })
  }

  if (phase !== 'review') return <>
    <h3>{t('Describe the workout')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('In your own words, in any language: the exercises, sets, reps, weight — and the day. The AI finds the exercises in the library and asks when it is not sure.')}</div>
    <div className="picker-search">
      <textarea ref={inputRef} className="input" rows={6} maxLength={MAX_LOG_TEXT} value={text} onFocus={onFocus}
        disabled={phase === 'reading'}
        placeholder={t('e.g. yesterday: bench press 3x8 80 kg, squat 5x5 100, pull-ups 3x10, plank 3 × 60 s')}
        onChange={e => setText(e.target.value)} />
    </div>
    {phase === 'reading'
      ? <div className="row" style={{ gap: 8 }}>
        <Button variant="primary" icon="sparkles" disabled style={{ flex: 1 }}>{waited >= 5 ? t('Reading… {0} s', waited) : t('Reading…')}</Button>
        <Button onClick={() => ctl.current?.abort()}>{t('Cancel')}</Button>
      </div>
      : <Button variant="primary" icon="sparkles" disabled={!text.trim()} onClick={read}>
        {agreed ? t('Read the workout') : t('Agree and read')}
      </Button>}
    <div className="small dim" style={{ margin: '8px 2px 0' }}>{fine}</div>
    {error && <div className="small" role="alert" style={{ margin: '10px 2px 0', color: 'var(--red)', whiteSpace: 'pre-line' }}>{error}</div>}
  </>

  const items = draft.items
  const left = unresolved(choices)
  const kept = choices.filter(c => c.status !== 'skip' && c.id).length
  const unit = draft.unit || (S.unit === 'lb' ? 'lb' : 'kg')

  return <>
    <div className="row between" style={{ marginBottom: 10 }}><h3>{t('Check the workout')}</h3>
      <Button size="sm" variant="ghost" onClick={() => setPhase('write')}>{t('Edit the text')}</Button>
    </div>
    <Row icon="calendar" title={t('Date')}>
      <input type="date" className="timef" value={date} max={today} onChange={e => setDate(e.target.value)} /></Row>
    <Row icon="clock" title={t('Start time')}>
      <input type="time" className="timef" value={time} onChange={e => setTime(e.target.value)} /></Row>
    <Stepper label={t('Duration')} unit="min" value={dur} step={5} decimal={false} onChange={v => setDur(Math.max(1, Math.round(v)))} />

    {!items.length && <div className="empty">{t('No exercise found in that — try naming the movement or the machine.')}</div>}
    {items.map((item, i) => {
      const c = choices[i] || { status: 'ask' }
      const ex = c.id ? EXIDX[c.id] : null
      const line = setsLine(item.sets, unit)
      const rows = logCandidates(item, S, usage)
      const d = draftFor(item)
      const unfolded = c.status === 'ask' || open === i
      return <div key={i}>
        <h4 className="sec">{item.said ? `“${item.said}”` : d.n}{line ? <span className="dim"> · {line}</span> : null}</h4>
        {c.status === 'skip'
          ? <div className="list"><div className="item dim" {...tappable(() => unskip(i))}>
            <div className="grow"><div className="tt">{t('Left out')}</div><div className="ss">{t('Tap to choose an exercise for this line after all')}</div></div>
            <Icon name="reset" className="chev" />
          </div></div>
          : <>
            {ex && c.status !== 'ask' && <div className="list"><div className="item" {...tappable(() => setOpen(open === i ? -1 : i))}>
              <Thumb ex={ex} /><div className="grow"><div className="tt capitalize">{exerciseNameFor(ex)}</div>
                <div className={'ss' + (usage[ex.id] ? '' : ' capitalize')}>{usage[ex.id] ? t('you have logged this before') : t(MUSCLE_NAME[ex.tg] || ex.tg || ex.bp)}</div></div>
              <span className="tag acc"><Icon name="check" /></span>
              <span className="small acc" style={{ marginLeft: 6 }}>{open === i ? t('Close') : t('Change')}</span>
            </div></div>}
            {unfolded && <>
              {c.status === 'ask' && <div className="small acc" style={{ margin: '0 2px 6px' }}>{rows.length ? t('Which one did you mean?') : t('Not in the library — create it, or find it yourself.')}</div>}
              <div className="list">
                {rows.filter(e => e.id !== c.id).map(e => <div key={e.id} className="item" {...tappable(() => choose(i, e.id))}>
                  <Thumb ex={e} /><div className="grow"><div className="tt capitalize">{exerciseNameFor(e)}</div>
                    <div className={'ss' + (usage[e.id] ? '' : ' capitalize')}>{usage[e.id] ? t('you have logged this before') : `${t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · ${t(e.eq)}`}</div></div>
                  <Icon name="chevronRight" className="chev" />
                </div>)}
                {d.n && <div className="item" {...tappable(() => onCreate(d, made => made && choose(i, made.id)))}>
                  <div className="thumb thumb-x"><Icon name="sparkles" /></div>
                  <div className="grow"><div className="tt">{t('Create “{0}”', d.n)}</div>
                    <div className="ss">{rows.length ? t('none of these — add it as your own exercise') : t('not in the library — add it as your own exercise')}</div></div>
                  <Icon name="plus" className="chev" />
                </div>}
                <div className="item" {...tappable(() => onSearch(picked => picked && choose(i, picked.id)))}>
                  <div className="thumb thumb-x"><Icon name="magnifier" /></div>
                  <div className="grow"><div className="tt">{t('Find it in the library')}</div></div>
                  <Icon name="chevronRight" className="chev" />
                </div>
                <div className="item" {...tappable(() => skip(i))}>
                  <div className="thumb thumb-x"><Icon name="xmark" /></div>
                  <div className="grow"><div className="tt">{t('Leave this line out')}</div></div>
                </div>
              </div>
            </>}
          </>}
      </div>
    })}

    <div style={{ height: 14 }} />
    {left > 0 && <div className="small dim" style={{ margin: '0 2px 8px' }}>{t('Choose an exercise for every line, or leave it out — {0} left.', left)}</div>}
    <Button variant="primary" disabled={left > 0 || !kept} onClick={go}>{t('Open the workout')}</Button>
    <div className="small dim" style={{ margin: '8px 2px 0' }}>{t('It opens on the usual screen with the sets filled in — check it and press Finish to save.')}</div>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
