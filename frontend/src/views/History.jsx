import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { WorkoutRow, workoutDetailSheet, logPastWorkoutSheet, workoutFromTextSheet } from '../sheets.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { coachAvailable } from '../lib/coach.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'

export default function History() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const coachMode = useStore(s => s.coachLocal?.mode)
  // Typing the workout out for the AI to read is offered exactly where the Coach is.
  const canDescribe = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })
  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{t('History')}</h1><div className="sub">{t('{0} workouts', S.workouts.length)}</div></div></div>
    <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <Button icon="plus" onClick={logPastWorkoutSheet} style={{ flex: 1 }}>{t('Log a past workout')}</Button>
      {canDescribe && <Button icon="sparkles" onClick={workoutFromTextSheet} style={{ flex: 1 }}>{t('Describe in words')}</Button>}
    </div>
    {S.workouts.length ? <div className="list">{[...S.workouts].reverse().map(w => <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
      : <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No workouts yet.')}</div>}
  </>
}
