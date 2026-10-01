import { useNavigate } from 'react-router-dom'
import { t, getLang } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { nutritionOf, loggedDays, dayBefore } from '../lib/nutrition.js'
import { baseTargets } from '../lib/nutrition-targets.js'
import LineChart from './LineChart.jsx'
import Icon from './Icon.jsx'
import '../nutrition.css'

// Energy eaten per day over the last month, against the target — and the week's average, which
// is the number that matters: a single day over or under says nothing, seven of them do.
// Renders nothing until there are a few days to draw.
export default function NutritionStats({ S }) {
  const nav = useNavigate()
  if (S.nutritionOn === false) return null
  const today = todayISO()
  const days = loggedDays(nutritionOf(S)).filter(x => x.d >= dayBefore(today, 30) && x.d <= today && x.k > 0)
  if (days.length < 3) return null
  const target = baseTargets(S, today)
  const week = days.filter(x => x.d >= dayBefore(today, 7) && x.d < today)
  const avg = key => (week.length ? Math.round(week.reduce((a, x) => a + x[key], 0) / week.length) : null)
  const num = n => n.toLocaleString(getLang())
  const points = days.map(x => ({ t: new Date(x.d + 'T12:00:00').getTime(), y: x.k, d: x.d }))
  return <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/nutrition')}>
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{t('Nutrition')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>· {t('last 30 days')}</span></h2>
      <Icon name="chevronRight" className="chev" />
    </div>
    {week.length > 0 && <div className="nt-kc">
      <b>{num(avg('k'))}</b>
      <span>{target.kcal ? '/ ' + num(target.kcal) + ' ' + t('kcal') : t('kcal')} · {t('daily average, last 7 days')}</span>
    </div>}
    {week.length > 0 && <div className="muted small" style={{ marginTop: 2 }}>
      {t('Protein')} {avg('p')} {t('g')} · {t('Fat')} {avg('f')} {t('g')} · {t('Carbs')} {avg('c')} {t('g')}
    </div>}
    <div className="chart" style={{ marginTop: 8 }}><LineChart points={points} h={130} unit={t('kcal')} goal={target.kcal || undefined} /></div>
  </div>
}
