import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO, fmtDate, fmtNum } from '../lib/format.js'
import { lastBW } from '../lib/history.js'
import { MEASURES, SITE_MUSCLES, siteOf, isGirth, goalOf, otherSide, sidePairs, deltaToDisplay, measureUnit, toDisplay, fromDisplay, cmToDisplay, cmFromDisplay, latestMeasures, measureSeries, usedMeasures, measureDelta } from '../lib/body.js'
import { measureTrend, goalEta, growthContext, MIN_EFFECTIVE_SETS, TAPE_DETECTABLE_CM } from '../lib/body-trend.js'
import { GENERAL, guideFor } from '../lib/measure-guide.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { ACTIVITY_LEVELS, personOf, bmrOf, tdeeFormula } from '../lib/nutrition-targets.js'
import { saveBodyProfile, saveMeasurement, deleteMeasurement, setMeasureGoal } from '../nutrition-actions.js'
import BodyMap from '../components/BodyMap.jsx'
import { bwSheet } from '../sheets.jsx'
import { targetsSheet } from '../nutrition-sheets.jsx'
import HealthConnect from '../components/HealthConnect.jsx'
import BodyPhotos, { addBodyPhotoSheet } from '../components/BodyPhotos.jsx'
import { photosAvailable } from '../lib/photos.js'
import { DEMO } from '../lib/demo.js'
import CoachSharing from '../components/CoachSharing.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, SelectRow, Section, Row } from '../components/ui.jsx'
import '../nutrition.css'

// Names live here, in t() calls, so the string check finds them (see PLAN_COPY in sheets.jsx).
const MEASURE_NAME = {
  waist: () => t('Waist'), abdomen: () => t('Abdomen'), chest: () => t('Chest'), hips: () => t('Hips'), shoulders: () => t('Shoulders'), neck: () => t('Neck'),
  upperArmLeft: () => t('Left upper arm'), upperArmRight: () => t('Right upper arm'),
  upperArmFlexedLeft: () => t('Left arm, flexed'), upperArmFlexedRight: () => t('Right arm, flexed'),
  forearmLeft: () => t('Left forearm'), forearmRight: () => t('Right forearm'), wristLeft: () => t('Left wrist'), wristRight: () => t('Right wrist'),
  thighLeft: () => t('Left thigh'), thighRight: () => t('Right thigh'), calfLeft: () => t('Left calf'), calfRight: () => t('Right calf'),
  ankleLeft: () => t('Left ankle'), ankleRight: () => t('Right ankle'),
  bodyFat: () => t('Body fat'), leanMass: () => t('Lean mass')
}
export const measureName = key => (MEASURE_NAME[key] ? MEASURE_NAME[key]() : key)
// The place rather than the side: what the measuring instruction is about.
const SITE_NAME = {
  waist: () => t('Waist'), abdomen: () => t('Abdomen'), chest: () => t('Chest'), hips: () => t('Hips'), shoulders: () => t('Shoulders'), neck: () => t('Neck'),
  upperArm: () => t('Upper arm, relaxed'), upperArmFlexed: () => t('Upper arm, flexed'), forearm: () => t('Forearm'), wrist: () => t('Wrist'),
  thigh: () => t('Thigh'), calf: () => t('Calf'), ankle: () => t('Ankle')
}
const signed = v => (v > 0 ? '+' : '') + fmtNum(v)
const ACTIVITY_COPY = {
  sedentary: () => ({ label: t('Sedentary'), subtitle: t('Desk job, little walking, training aside') }),
  light: () => ({ label: t('Lightly active'), subtitle: t('Some walking most days') }),
  moderate: () => ({ label: t('Moderately active'), subtitle: t('On your feet a good part of the day') }),
  active: () => ({ label: t('Very active'), subtitle: t('Physical work or a lot of daily movement') }),
  very: () => ({ label: t('Extremely active'), subtitle: t('Heavy physical work every day') })
}

// Who the numbers are about: the facts the energy formulas need, body measurements over time,
// and — where the instance offers them — the Apple Health connection and what the Coach may see.
export default function Body() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const bp = S.bodyProfile || {}
  const today = todayISO()
  const bw = lastBW(S)
  const person = personOf(S, today)
  const bmr = bmrOf(person)
  const used = usedMeasures(S)
  const [metric, setMetric] = useState(null)
  const shown = used.includes(metric) ? metric : used[0] || null
  const latest = latestMeasures(S)
  const lenUnit = S.unit === 'lb' ? 'in' : 'cm'
  // A reminder's tap lands here with what it was about (`#/body?do=weigh`): the matching sheet
  // opens once and the address is put back to plain /body, so going back or reloading does not
  // open it again.
  //
  // In two steps, and with no timer between them. First the action is remembered and the address
  // replaced; the sheet opens on the run of this effect that sees the clean address. A timer
  // armed beside the navigation used to be cancelled by the very re-run that navigation causes —
  // reliably so in a window that is still in the background, which is exactly where a tapped
  // notification finds the app. A sheet also pushes a history entry of its own, so it has to
  // come after the replace, not before.
  const loc = useLocation()
  const user = useStore(s => s.user), config = useStore(s => s.config), ready = useStore(s => s.ready)
  const canPhoto = photosAvailable({ config, user, demo: DEMO })
  const pendingDo = useRef(null)
  useEffect(() => {
    const act = new URLSearchParams(loc.search).get('do')
    if (act) { pendingDo.current = act; nav('/body', { replace: true }); return }
    const todo = pendingDo.current
    if (!todo) return
    // Whether this instance stores photos is known only once its config has loaded — on a cold
    // start that is after this screen first renders. Wait for it; drop the action if the answer
    // is no.
    if (todo === 'photo' && !canPhoto) { if (ready) pendingDo.current = null; return }
    pendingDo.current = null
    const open = { weigh: bwSheet, measure: measureSheet, photo: addBodyPhotoSheet }[todo]
    if (open) open()
  }, [loc.search, canPhoto, ready])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1 }}><h1 style={{ fontSize: 28 }}>{t('Body')}</h1></div>
    </div>

    <Section title={t('About you')} footer={t('Used to estimate how much energy you burn. Nothing here is required — fill in what you want counted.')}>
      {/* A picker rather than a two-way switch: a switch always shows one side lit, and "not
          set" has to be a visible state — the formula then uses the midpoint of the two. */}
      <SelectRow title={t('Sex')} value={bp.sex || ''} onChange={v => saveBodyProfile({ sex: v || null })}
        options={[{ value: 'm', label: t('Male') }, { value: 'f', label: t('Female') }, { value: '', label: t('Not set'), subtitle: t('The energy estimate then sits between the two.') }]} />
      <Row title={t('Year of birth')}>
        <Fact key={'b' + (bp.born || '')} value={bp.born || null} decimal={false} placeholder="1990"
          ok={v => v == null || (v >= 1900 && v <= +today.slice(0, 4))} onCommit={v => saveBodyProfile({ born: v })} />
      </Row>
      <Row title={t('Height')} subtitle={lenUnit}>
        <Fact key={'h' + (bp.heightCm || '') + S.unit} value={cmToDisplay(bp.heightCm, S.unit)} placeholder={S.unit === 'lb' ? '70' : '178'}
          ok={v => { const cm = cmFromDisplay(v, S.unit); return cm == null || (cm >= 80 && cm <= 250) }}
          onCommit={v => saveBodyProfile({ heightCm: cmFromDisplay(v, S.unit) })} />
      </Row>
      <SelectRow title={t('Daily activity')} sheetTitle={t('Daily activity, not counting training')} value={bp.activity || null}
        options={ACTIVITY_LEVELS.map(k => ({ value: k, ...ACTIVITY_COPY[k]() }))} onChange={v => saveBodyProfile({ activity: v })} />
    </Section>

    <div className="card">
      <div className="row between">
        <div>
          <div className="lbl2">{t('Body weight')}</div>
          <div className="big" style={{ fontSize: 24 }}>{bw ? <>{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></> : '—'}</div>
          {bw && <div className="dim small">{fmtDate(bw.d, true)}</div>}
        </div>
        <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
      </div>
      {bmr && <div className="nt-note" style={{ alignItems: 'flex-start' }}>
        <Icon name="flame" style={{ marginTop: 2 }} />
        <span>{t('At rest you burn about {0} kcal a day; with your daily activity about {1}.', bmr.kcal, tdeeFormula(bmr.kcal, person.activity))}{' '}
          <span style={{ color: 'var(--acc)', cursor: 'pointer' }} onClick={targetsSheet}>{t('Daily target')}</span></span>
      </div>}
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Measurements')}</h2>
        <Button size="sm" icon="plus" onClick={() => measureSheet()}>{t('Add')}</Button>
      </div>
      {!used.length && <div className="muted small">{t('Waist, chest, arms, body fat — measured the same way each time, they show what the scale alone does not.')}</div>}
      {!!used.length && <>
        <div className="chips nt-chips" style={{ margin: '4px 0 8px' }}>
          {used.map(k => <button key={k} className={'chip' + (k === shown ? ' on' : '')} onClick={() => setMetric(k)}>{measureName(k)}</button>)}
        </div>
        <Trend S={S} metric={shown} />
        <Sides S={S} />
        <h4 className="sec">{t('Latest')}</h4>
        <div className="bd-last">
          {used.map(k => <span key={k}><span>{measureName(k)}</span> <b>{fmtNum(toDisplay(k, latest[k].v, S.unit))}</b> <span>{measureUnit(k, S.unit)}</span></span>)}
        </div>
        <div style={{ height: 10 }} />
        <Button variant="ghost" className="dim" icon="history" onClick={historySheet}>{t('All entries')}</Button>
      </>}
    </div>

    <BodyPhotos />
    <HealthConnect />
    <CoachSharing />
  </div>
}

// A number that is only worth saving once it is whole: "19" on the way to "1990" must neither be
// stored nor wiped from the field. The draft lives here and reaches the profile when it leaves
// the field (or Enter), if it is a plausible value; otherwise the field falls back to what was saved.
function Fact({ value, onCommit, ok, decimal = true, placeholder }) {
  const [v, setV] = useState(value)
  const commit = () => { if (v === value) return; if (ok(v)) onCommit(v); else setV(value) }
  return <NumberField className="input bd-num" nullable decimal={decimal} value={v} placeholder={placeholder} onChange={setV}
    onBlur={commit} enterKeyHint="done" onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
}

// One measurement over time: the curve, the goal, and — for a tape measurement — what the
// readings say about where it is heading (lib/body-trend.js), with the range drawn on the chart.
function Trend({ S, metric }) {
  const today = todayISO()
  // Memoised: LineChart drops its tooltip whenever `points` changes identity.
  const pts = useMemo(() => measureSeries(S, metric), [S.measurements, S.unit, metric])
  const trend = useMemo(() => measureTrend(S, metric, { today }), [S.measurements, metric, today])
  const forecast = useMemo(() => (trend.projection
    ? trend.projection.path.map(p => ({ t: new Date(p.d + 'T12:00:00').getTime(), y: toDisplay(metric, p.mid, S.unit), lo: toDisplay(metric, p.lo, S.unit), hi: toDisplay(metric, p.hi, S.unit) }))
    : null), [trend, metric, S.unit])
  const delta = measureDelta(S, metric)
  const unit = measureUnit(metric, S.unit)
  const last = pts.at(-1)
  const goal = goalOf(S, metric)
  // The same site on the other side of the body, on the same axes — where both were measured.
  const other = otherSide(metric)
  const twin = useMemo(() => (other ? measureSeries(S, other) : []), [S.measurements, S.unit, other])
  return <>
    <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
      <div className="big" style={{ fontSize: 24 }}>{fmtNum(last.y)} <span className="muted" style={{ fontSize: '1rem' }}>{unit}</span></div>
      {!!delta && <span className="small muted row" style={{ gap: 2 }}><Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />{fmtNum(Math.abs(delta))}</span>}
      <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(last.d, true)}</span>
    </div>
    {pts.length > 1 && <div className="chart" style={{ marginTop: 8 }}>
      <LineChart points={pts} h={forecast ? 150 : 120} unit={unit} goal={goal ? toDisplay(metric, goal, S.unit) : null} forecast={forecast} second={twin.length > 1 ? twin : null} />
    </div>}
    {pts.length > 1 && twin.length > 1 && <div className="dim small" style={{ marginTop: 4 }}>{t('Thin grey line: {0}.', measureName(other).toLowerCase())}</div>}
    <div className="row bd-acts">
      <button className="bd-link" onClick={() => goalSheet(metric)}><Icon name="target" />{goal ? t('Goal: {0} {1}', fmtNum(toDisplay(metric, goal, S.unit)), unit) : t('Set a goal')}</button>
      {siteOf(metric) && <button className="bd-link" onClick={() => guideSheet(metric)}><Icon name="info" />{t('How to measure')}</button>}
    </div>
    {isGirth(metric) && <TrendNote S={S} metric={metric} trend={trend} goal={goal} today={today} />}
  </>
}

// Left against right, for every site measured on both sides. Said as plainly as the tape allows:
// a difference under its own error is no difference, and readings taken weeks apart are not a
// comparison at all (lib/body.js sidePairs).
function Sides({ S }) {
  const pairs = sidePairs(S)
  if (!pairs.length) return null
  return <>
    <h4 className="sec">{t('Left and right')}</h4>
    <div className="bd-sides">
      {pairs.map(p => {
        const unit = measureUnit(p.left.key, S.unit)
        const gap = fmtNum(Math.abs(deltaToDisplay(p.left.key, p.diff, S.unit)))
        return <div key={p.site} className="bd-side">
          <div className="row between" style={{ gap: 8 }}>
            <span>{SITE_NAME[p.site] ? SITE_NAME[p.site]() : p.site}</span>
            <span className="bd-lr">{t('L')} <b>{fmtNum(toDisplay(p.left.key, p.left.v, S.unit))}</b> · {t('R')} <b>{fmtNum(toDisplay(p.right.key, p.right.v, S.unit))}</b> {unit}</span>
          </div>
          <div className="dim small">{!p.comparable
            ? t('Measured {0} days apart — measure both on the same day to compare them.', p.apartDays)
            : p.within
              ? (p.diff === 0 ? t('The same on both sides.') : t('Difference {0} {1} — within the error of a tape measure.', gap, unit))
              : p.diff > 0 ? t('Difference {0} {1} — the right is bigger.', gap, unit) : t('Difference {0} {1} — the left is bigger.', gap, unit)}</div>
        </div>
      })}
    </div>
  </>
}

// Why a trend is not shown yet — each one says what would change that.
const REFUSAL = {
  'few-points': r => t('A trend needs at least {0} measurements — you have {1}.', r.need, r.n),
  'short-span': r => t('A trend needs measurements spread over at least {0} weeks.', Math.round(r.need / 7)),
  uneven: () => t('The measurements are bunched together: a trend needs them spread over the period.'),
  stale: r => t('The last measurement is over {0} days old: measure again to see a trend.', r.need)
}

function TrendNote({ S, metric, trend, goal, today }) {
  const unit = measureUnit(metric, S.unit)
  const d = v => fmtNum(deltaToDisplay(metric, v, S.unit))
  const ctx = useMemo(() => growthContext(S, metric, { today }), [S.workouts, S.routines, S.week, S.bodyweight, S.nutrition, S.coach, S.unit, metric, today])
  const eta = goalEta(trend, goal)
  const p = trend.projection
  const sets = ctx.muscles.filter(m => m.done > 0 || m.planned > 0)
  const thin = ctx.muscles.length > 0 && ctx.muscles.every(m => m.done < MIN_EFFECTIVE_SETS)
  const wk = ctx.weight == null ? null : Math.round((S.unit === 'lb' ? ctx.weight / 0.45359237 : ctx.weight) * 100) / 100
  return <div className="bd-trend">
    {!trend.ok && REFUSAL[trend.reason] && <div className="muted small">{REFUSAL[trend.reason](trend)}</div>}
    {trend.ok && !trend.detectable && <div className="muted small">{t('No clear trend yet: the change so far is within the error of a tape measure.')}</div>}
    {trend.ok && trend.detectable && <>
      <div className="small"><b>{t('Trend: {0} {1} a month', signed(deltaToDisplay(metric, trend.perMonth, S.unit)), unit)}</b> <span className="muted">{t('(between {0} and {1})', signed(deltaToDisplay(metric, trend.ci[0], S.unit)), signed(deltaToDisplay(metric, trend.ci[1], S.unit)))}</span></div>
      {p && <div className="small" style={{ marginTop: 3 }}>{t('In {0} weeks a reading will most likely be between {1} and {2} {3}.', Math.round(p.days / 7), fmtNum(toDisplay(metric, p.lo, S.unit)), fmtNum(toDisplay(metric, p.hi, S.unit)), unit)}</div>}
      {eta && <div className="small" style={{ marginTop: 3 }}>{t('At this rate the goal is about {0} weeks away.', Math.max(1, Math.round(eta.days / 7)))}</div>}
    </>}
    {(sets.length > 0 || wk != null || ctx.protein != null) && <>
      <h4 className="sec">{t('Behind the trend')}</h4>
      <div className="bd-ctx">
        {sets.map(m => <span key={m.slug} className="tag">{m.planned > 0
          ? t('{0}: {1} sets a week, {2} planned', t(MUSCLE_NAME[m.slug]), fmtNum(m.done), fmtNum(m.planned))
          : t('{0}: {1} sets a week', t(MUSCLE_NAME[m.slug]), fmtNum(m.done))}</span>)}
        {wk != null && <span className="tag">{t('Body weight: {0} {1} a week', signed(wk), S.unit)}</span>}
        {ctx.protein != null && <span className="tag">{t('Protein: {0} g per kg a day', fmtNum(ctx.protein))}</span>}
      </div>
      {thin && <div className="dim small" style={{ marginTop: 6 }}>{t('Under about {0} sets a week per muscle, growth is rarely measurable.', MIN_EFFECTIVE_SETS)}</div>}
    </>}
    {ctx.reference && <div className="dim small" style={{ marginTop: 6 }}>{ctx.level === 'new'
      ? t('For scale: in studies, beginners gained {0}–{1} {2} of flexed arm in {3}–{4} weeks. These are group averages: individual results vary widely.', d(ctx.reference.cm[0]), d(ctx.reference.cm[1]), unit, ctx.reference.weeks[0], ctx.reference.weeks[1])
      : t('For scale: in studies, trained lifters gained about {0} {1} of flexed arm in {2}–{3} weeks. These are group averages: individual results vary widely.', d(ctx.reference.cm[0]), unit, ctx.reference.weeks[0], ctx.reference.weeks[1])}</div>}
    <div className="dim small" style={{ marginTop: 6 }}>{t('A tape measures muscle and fat together, and two readings of the same spot can differ by {0} {1} on their own.', d(TAPE_DETECTABLE_CM), unit)}</div>
  </div>
}

/* ------------------------------------------------------------ sheets -- */

// One day's measurements. Opening it on a day that already has a row edits that row; a field
// left empty is simply not recorded (and clearing one removes it).
function MeasureSheet({ d, close }) {
  const S = useStore(s => s.S)
  const row = (S.measurements || []).find(r => r.d === d) || {}
  const [vals, setVals] = useState(() => Object.fromEntries(MEASURES.map(m => [m.key, toDisplay(m.key, row[m.key], S.unit)])))
  const groups = [['torso', t('Torso')], ['arms', t('Arms')], ['legs', t('Legs')], ['other', t('Composition')]]
  // Wrist and ankle wait behind a button, unless this profile already records them.
  const inUse = usedMeasures(S)
  const [all, setAll] = useState(false)
  const shown = MEASURES.filter(m => all || !m.extra || inUse.includes(m.key))
  const save = () => {
    const out = {}
    for (const m of MEASURES) out[m.key] = fromDisplay(m.key, vals[m.key], S.unit) || 0
    if (!Object.values(out).some(v => v > 0) && !row.d) { useUI.getState().toast(t('Enter at least one measurement')); return }
    saveMeasurement(d, out)
    close(); useUI.getState().toast(t('Saved'))
  }
  return <>
    <h3>{t('Measurements')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{fmtDate(d, true)} · {t('fill in what you measured, leave the rest empty')}</div>
    {groups.map(([g, title]) => <div key={g}>
      <div className="sect-t" style={{ marginTop: 10 }}>{title}</div>
      <div className="nt-fields two">
        {/* Not a <label>: the help button inside one would put the cursor in the field. */}
        {shown.filter(m => m.group === g).map(m => <div key={m.key} className="nt-field">
          <div className="bd-fh">
            <span>{measureName(m.key)}, {measureUnit(m.key, S.unit)}</span>
            {m.site && <button className="helpbtn" aria-label={t('How to measure')} onClick={() => guideSheet(m.key)}><Icon name="info" /></button>}
          </div>
          <NumberField className="input" nullable aria-label={measureName(m.key)} value={vals[m.key]} onChange={v => setVals(x => ({ ...x, [m.key]: v }))} />
        </div>)}
      </div>
    </div>)}
    {shown.length < MEASURES.length && <><div style={{ height: 10 }} /><Button variant="ghost" className="dim" icon="plus" onClick={() => setAll(true)}>{t('More measurements')}</Button></>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {row.d && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { deleteMeasurement(d); close() }}>{t('Delete this day')}</Button></>}
  </>
}
export const measureSheet = (d = todayISO()) => useUI.getState().openSheet(close => <MeasureSheet d={d} close={close} />)

// How to take one measurement: the steps for its site, the muscles under the tape on the body
// map, and the rules that hold everywhere.
function GuideSheet({ metric, close }) {
  const S = useStore(s => s.S)
  const site = siteOf(metric)
  const muscles = SITE_MUSCLES[site] || []
  return <>
    <h3>{SITE_NAME[site] ? SITE_NAME[site]() : measureName(metric)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('How to measure')}</div>
    {muscles.length > 0 && <BodyMap className="bd-map" body={S.body} load={Object.fromEntries(muscles.map(m => [m, 1]))} />}
    <ol className="steps-list">{guideFor(site).map((s, i) => <li key={i}>{s}</li>)}</ol>
    <h4 className="sec">{t('Every time')}</h4>
    <ol className="steps-list">{GENERAL().map((s, i) => <li key={i}>{s}</li>)}</ol>
    <div style={{ height: 14 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}
export const guideSheet = metric => useUI.getState().openSheet(close => <GuideSheet metric={metric} close={close} />)

function GoalSheet({ metric, close }) {
  const S = useStore(s => s.S)
  const goal = goalOf(S, metric)
  const [v, setV] = useState(() => toDisplay(metric, goal, S.unit))
  const save = () => {
    const stored = fromDisplay(metric, v, S.unit)
    if (!stored) { useUI.getState().toast(t('Enter a number')); return }
    setMeasureGoal(metric, stored)
    close()
  }
  return <>
    <h3>{t('Goal: {0}', measureName(metric))}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Shown as a line on the chart.')}</div>
    <div className="nt-fields one">
      <label className="nt-field">
        <span>{measureName(metric)}, {measureUnit(metric, S.unit)}</span>
        <NumberField className="input" nullable value={v} onChange={setV} enterKeyHint="done" onKeyDown={e => { if (e.key === 'Enter') save() }} />
      </label>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {goal && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { setMeasureGoal(metric, null); close() }}>{t('Remove goal')}</Button></>}
  </>
}
const goalSheet = metric => useUI.getState().openSheet(close => <GoalSheet metric={metric} close={close} />)

function History({ close }) {
  const S = useStore(s => s.S)
  const rows = [...(S.measurements || [])].reverse()
  return <>
    <h3>{t('All entries')}</h3>
    <div className="list">
      {rows.map(r => <div key={r.d} className="item" onClick={() => measureSheet(r.d)}>
        <div className="grow">
          <div className="tt">{fmtDate(r.d, true, true)}{r.src === 'hk' && <span className="tag" style={{ marginLeft: 8 }}>{t('Health')}</span>}</div>
          <div className="ss">{MEASURES.filter(m => r[m.key] > 0).map(m => `${measureName(m.key)} ${fmtNum(toDisplay(m.key, r[m.key], S.unit))}`).join(' · ')}</div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}
const historySheet = () => useUI.getState().openSheet(close => <History close={close} />)
