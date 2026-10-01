import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO, fmtDate } from '../lib/format.js'
import { MEALS, nutritionOf, dayTotals, byMeal, dayBefore } from '../lib/nutrition.js'
import { targetsFor } from '../lib/nutrition-targets.js'
import { deleteEntry, logMany } from '../nutrition-actions.js'
import { addFoodSheet, entrySheet, targetsSheet, myFoodsSheet, mealName, mealNow, fmt1 } from '../nutrition-sheets.jsx'
import { foodAiChips, suggestSheet, foodAiAvailable } from '../nutrition-ai.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import MacroBars from '../components/MacroBars.jsx'
import SwipeToDelete from '../components/SwipeToDelete.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import '../nutrition.css'

const dayAfter = iso => dayBefore(iso, -1)

// One day of the food diary: what it adds up to against the target, then the four meals.
// Reached from the Home card; switched off as a whole in Settings (S.nutritionOn).
export default function Nutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const coachLocal = useStore(s => s.coachLocal)
  const today = todayISO()
  const [d, setD] = useState(today)
  const nut = nutritionOf(S)
  const totals = dayTotals(nut, d)
  const target = targetsFor(S, d, today)
  const meals = byMeal(nut, d)
  const folded = !!nut.rolledTo && d < nut.rolledTo
  const ai = foodAiAvailable({ config, user, coachLocal })
  const yesterday = dayBefore(d, 1)
  const canCopy = !totals.n && !folded && dayTotals(nut, yesterday).n > 0

  const add = m => addFoodSheet({ d, m, extra: ai ? foodAiChips : null })
  const copyYesterday = () => {
    byMeal(nut, yesterday).forEach((rows, m) => {
      if (rows.length) logMany(rows.map(e => ({ copy: e })), { d, m })
    })
    useUI.getState().toast(t('Copied from the day before'))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1 }}><h1 style={{ fontSize: 28 }}>{t('Nutrition')}</h1></div>
      <button className="iconbtn" onClick={targetsSheet} aria-label={t('Daily target')}><Icon name="target" /></button>
    </div>

    <div className="nt-date">
      <button className="iconbtn" onClick={() => setD(dayBefore(d, 1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
      <div className="d">{d === today ? t('Today') : d === dayBefore(today, 1) ? t('Yesterday') : fmtDate(d, true)}</div>
      <button className="iconbtn" onClick={() => setD(dayAfter(d))} disabled={d >= today} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
    </div>

    <div className="card">
      <MacroBars totals={totals} target={target.kcal ? target : null} />
      {!target.kcal && <div style={{ marginTop: 12 }}>
        <div className="muted small" style={{ marginBottom: 8 }}>{t('No daily target yet — the diary works without one, but a target tells you what is left.')}</div>
        <Button size="sm" variant="tinted" icon="target" onClick={targetsSheet}>{t('Set a target')}</Button>
      </div>}
    </div>

    {folded ? <div className="card muted small" style={{ lineHeight: 1.45 }}>
      {totals.n
        ? t('Days older than three months are kept as daily totals only: {0} entries were logged that day.', totals.n)
        : t('Nothing was logged that day.')}
    </div> : <>
      {MEALS.map((key, m) => {
        const rows = meals[m]
        const kcal = rows.reduce((a, e) => a + e.k, 0)
        return <div key={key}>
          <div className="nt-meal-h">
            <h2>{mealName(m)}{!!rows.length && <span className="k">{kcal} {t('kcal')}</span>}</h2>
            <button className="iconbtn" onClick={() => add(m)} aria-label={t('Add to {0}', mealName(m).toLowerCase())}><Icon name="plus" /></button>
          </div>
          <div className="nt-rows">
            {rows.map(e => <SwipeToDelete key={e.id} className="nt-row" onDelete={() => deleteEntry(e.id)} onClick={() => entrySheet(e)}>
              <div className="grow">
                <div className="tt">{e.n || t('Quick add')}</div>
                <div className="ss">{e.g > 0 ? e.g + ' ' + t('g') + ' · ' : ''}{t('P')} {fmt1(e.p)} · {t('F')} {fmt1(e.f)} · {t('C')} {fmt1(e.c)}</div>
              </div>
              <div className="kc">{e.k}</div>
            </SwipeToDelete>)}
            {!rows.length && m === mealNow() && d === today && <button className="nt-add" onClick={() => add(m)}><Icon name="plus" />{t('Add food')}</button>}
          </div>
        </div>
      })}

      <div style={{ height: 18 }} />
      {canCopy && <><Button icon="history" onClick={copyYesterday}>{t('Copy the day before')}</Button><div style={{ height: 8 }} /></>}
      {d === today && !!target.kcal && <><Button variant="tinted" icon="lightbulb" onClick={() => suggestSheet({ d })}>{t('What should I eat?')}</Button><div style={{ height: 8 }} /></>}
      <Button variant="ghost" icon="star" onClick={myFoodsSheet}>{t('My products')}</Button>
    </>}

    <div className="dim small" style={{ marginTop: 18, lineHeight: 1.45, textAlign: 'center' }} {...tappable(() => nav('/body'))}>
      {t('Targets come from your body profile.')} <span style={{ color: 'var(--acc)' }}>{t('Open body profile')}</span>
    </div>
  </div>
}
