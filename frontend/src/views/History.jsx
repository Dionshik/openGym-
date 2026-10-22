import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, tn } from '../lib/i18n.js'
import { WorkoutRow, DayNoteRow, workoutDetailSheet, logPastWorkoutSheet, workoutFromTextSheet } from '../sheets.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { dayNoteOf } from '../lib/day-notes.js'
import { coachAvailable } from '../lib/coach.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'

// Newest first: every workout, and in between them the days off you left a note on (#261). A
// note on a day that has a workout too stays in the day sheet; the workout speaks for that day.
export function historyRows(S) {
  const trained = new Set((S.workouts || []).map(w => w?.d))
  const notes = Object.keys(S.dayNotes || {}).filter(d => !trained.has(d)).map(d => ({ d, note: dayNoteOf(S, d) })).filter(x => x.note)
  const rows = [...(S.workouts || []).map(w => ({ d: w.d, w })), ...notes]
  // Stable, so workouts keep the order they are stored in (by day, then start) within a day.
  return rows.map((r, i) => [r, i]).sort((a, b) => (a[0].d < b[0].d ? 1 : a[0].d > b[0].d ? -1 : b[1] - a[1])).map(([r]) => r)
}

export default function History() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const rows = historyRows(S)
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const coachMode = useStore(s => s.coachLocal?.mode)
  // Typing the workout out for the AI to read is offered exactly where the Coach is.
  const canDescribe = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })
  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('History')}</h1><div className="sub">{tn('{0} workout', '{0} workouts', S.workouts.length)}</div></div></div>
    <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <Button icon="plus" onClick={logPastWorkoutSheet} style={{ flex: 1 }}>{t('Log a past workout')}</Button>
      {canDescribe && <Button icon="sparkles" onClick={workoutFromTextSheet} style={{ flex: 1 }}>{t('Describe in words')}</Button>}
    </div>
    {rows.length ? <div className="list">{rows.map(r => r.w
      ? <WorkoutRow key={r.w.id} w={r.w} onClick={() => workoutDetailSheet(r.w)} />
      : <DayNoteRow key={'note-' + r.d} iso={r.d} note={r.note} />)}</div>
      : <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No workouts yet. Your first one will land here.')}</div>}
  </>
}
