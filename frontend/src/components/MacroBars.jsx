import { t, getLang } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// The day against its target: energy as one bar, protein / fat / carbohydrate as three. With no
// target yet the same numbers are shown without bars — the diary is useful before a goal exists.
// A bar past its end turns red rather than growing: "over" is a state, not a longer line.
const num = n => Math.round(n || 0).toLocaleString(getLang())

function Bar({ value, max }) {
  if (!(max > 0)) return null
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return <div className={'nt-bar' + (value > max * 1.02 ? ' over' : '')}><i style={{ width: pct + '%' }} /></div>
}

export default function MacroBars({ totals, target, compact = false }) {
  const kcal = target?.kcal || 0
  const left = kcal ? Math.round(kcal - totals.k) : null
  return <div className={compact ? 'nt-mini' : ''}>
    <div className="nt-kc">
      <b>{num(totals.k)}</b>
      <span>{kcal ? '/ ' + num(kcal) + ' ' + t('kcal') : t('kcal')}</span>
      {left != null && <span className={'nt-left' + (left < 0 ? ' over' : '')}>{left >= 0 ? t('{0} left', num(left)) : t('{0} over', num(-left))}</span>}
    </div>
    <Bar value={totals.k} max={kcal} />
    <div className="nt-macros">
      {[['p', t('Protein')], ['f', t('Fat')], ['c', t('Carbs')]].map(([k, label]) => (
        <div key={k} className={'nt-macro ' + k}>
          <div className="l">{label}</div>
          <div className="v">{num(totals[k])}{kcal ? <span> / {num(target[k])} {t('g')}</span> : <span> {t('g')}</span>}</div>
          <Bar value={totals[k]} max={kcal ? target[k] : 0} />
        </div>
      ))}
    </div>
    {!compact && !!target?.shift && <div className="nt-note">
      <Icon name="dumbbell" />
      {target.shift > 0 ? t('Training day: {0} kcal more than your average day.', num(target.shift)) : t('Rest day: {0} kcal less than your average day.', num(-target.shift))}
    </div>}
  </div>
}
