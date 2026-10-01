/* The sheets of the nutrition section: finding a food, saying how much, typing bare numbers,
 * keeping your own products, setting the target. The day view itself is views/Nutrition.jsx.
 * Kept out of sheets.jsx on purpose — that file is the workout's, and already the biggest. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t, getLang } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { todayISO } from './lib/format.js'
import { MEALS, nutritionOf, scale, per100Of, recentFoods, myFoods, atwater } from './lib/nutrition.js'
import { searchFoods, loadFoods, barcodeOf } from './lib/food-search.js'
import { onlineAvailable, lookupBarcode, searchOnline, onlineErrorText } from './lib/food-online.js'
import { settingsOf, baseTargets, RATE, PROTEIN, GOALS, personOf } from './lib/nutrition-targets.js'
import { logFood, logQuick, changeEntry, deleteEntry, saveMyFood, archiveMyFood, setTargets } from './nutrition-actions.js'
import { useSheetKeyboard, tappable } from './lib/use-sheet-keyboard.js'
import { confirmSheet } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import { Button, NumberField, SearchField, Segmented, Slider, Stepper, Switch, TextField, Row } from './components/ui.jsx'
import './nutrition.css'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)

export const MEAL_NAME = { breakfast: () => t('Breakfast'), lunch: () => t('Lunch'), dinner: () => t('Dinner'), snack: () => t('Snacks') }
export const mealName = m => MEAL_NAME[MEALS[m] || 'snack']()
/** The meal a new row most likely belongs to at this hour. */
export const mealNow = (h = new Date().getHours()) => (h < 11 ? 0 : h < 16 ? 1 : h < 22 ? 2 : 3)
const mealOptions = () => MEALS.map((k, i) => ({ value: i, label: MEAL_NAME[k]() }))

/** "165 kcal · P 31 · F 3.6 · C 0" — one line under a food's name. */
export const macroLine = v => `${Math.round(v.k)} ${t('kcal')} · ${t('P')} ${fmt1(v.p)} · ${t('F')} ${fmt1(v.f)} · ${t('C')} ${fmt1(v.c)}`
export const fmt1 = n => (Math.round((n || 0) * 10) / 10).toLocaleString(getLang(), { maximumFractionDigits: 1 })

/* ============================ how much ============================ */

// The weight of a product about to be logged (or already logged — `entry`). The numbers under
// the stepper are the ones the row will carry, so there is nothing to discover after saving.
function AmountSheet({ item, entry, d, m: meal0, onDone, close }) {
  const [g, setG] = useState(entry ? entry.g : (item.g || 100))
  const [meal, setMeal] = useState(entry ? entry.m : meal0)
  const per100 = entry ? per100Of(entry) : item.per100
  const now = scale(per100, g)
  const portions = [...new Set([50, 100, 150, 200, 250, item?.g].filter(x => x > 0))].sort((a, b) => a - b)
  const save = () => {
    if (!(g > 0)) { toast(t('Enter the weight in grams')); return }
    if (entry) changeEntry(entry.id, { g, m: meal })
    else logFood(item, g, { d, m: meal })
    close()
    if (onDone) onDone(); else toast(entry ? t('Saved') : t('Added'))
  }
  const name = entry ? entry.n : item.n
  return <>
    <h3 style={{ marginBottom: 2 }}>{name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('per 100 g')}: {macroLine(per100)}</div>
    <Stepper value={g} step={10} decimal={false} unit={t('g')} onChange={setG} />
    <div className="chips nt-chips" style={{ justifyContent: 'center', margin: '10px 0 4px' }}>
      {portions.map(p => <button key={p} className={'chip' + (p === g ? ' on' : '')} onClick={() => setG(p)}>{p} {t('g')}</button>)}
    </div>
    <div className="nt-now">
      <div><b>{now.k}</b><span>{t('kcal')}</span></div>
      <div><b>{fmt1(now.p)}</b><span>{t('Protein')}</span></div>
      <div><b>{fmt1(now.f)}</b><span>{t('Fat')}</span></div>
      <div><b>{fmt1(now.c)}</b><span>{t('Carbs')}</span></div>
    </div>
    <Segmented options={mealOptions()} value={meal} onChange={setMeal} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{entry ? t('Save') : t('Add')}</Button>
    {entry && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" icon="star" onClick={() => {
        const row = saveMyFood({ n: entry.n, ...per100, sv: entry.g })
        toast(row ? t('Saved to my products') : t('Could not save'))
      }}>{t('Save as my product')}</Button>
      <div style={{ height: 2 }} />
      <Button variant="danger" icon="trash" onClick={() => { deleteEntry(entry.id); close(); toast(t('Deleted')) }}>{t('Delete')}</Button>
    </>}
  </>
}
export const amountSheet = (item, opts) => ui().openSheet(close => <AmountSheet item={item} {...opts} close={close} />)

// A row logged as bare numbers has no weight to change: its numbers and its meal are the form.
function QuickSheet({ entry, d, m: meal0, close }) {
  const nameRef = useRef(null)
  const onFocus = useSheetKeyboard(nameRef)
  const [n, setN] = useState(entry ? entry.n : '')
  const [k, setK] = useState(entry ? entry.k : null)
  const [p, setP] = useState(entry ? entry.p || null : null)
  const [f, setF] = useState(entry ? entry.f || null : null)
  const [c, setC] = useState(entry ? entry.c || null : null)
  const [meal, setMeal] = useState(entry ? entry.m : meal0)
  const fromMacros = atwater({ p: p || 0, f: f || 0, c: c || 0 })
  const save = () => {
    const kcal = k == null ? fromMacros : k
    if (!(kcal > 0)) { toast(t('Enter the calories, or the protein, fat and carbs')); return }
    const vals = { n: n.trim() || t('Quick add'), k: kcal, p: p || 0, f: f || 0, c: c || 0 }
    if (entry) changeEntry(entry.id, { ...vals, m: meal })
    else logQuick(vals, { d, m: meal })
    close(); toast(entry ? t('Saved') : t('Added'))
  }
  return <>
    <h3>{entry ? t('Edit entry') : t('Quick add')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('For a meal you only know the numbers of — a restaurant dish, a label you read once.')}</div>
    <input ref={nameRef} className="input" placeholder={t('What was it? (optional)')} value={n} maxLength={80} onFocus={onFocus} onChange={e => setN(e.target.value)} />
    <div className="nt-fields" style={{ marginTop: 10 }}>
      <NumField label={t('kcal')} value={k} onChange={setK} placeholder={fromMacros ? String(fromMacros) : ''} decimal={false} />
      <NumField label={t('Protein')} value={p} onChange={setP} />
      <NumField label={t('Fat')} value={f} onChange={setF} />
      <NumField label={t('Carbs')} value={c} onChange={setC} />
    </div>
    <div style={{ height: 12 }} />
    <Segmented options={mealOptions()} value={meal} onChange={setMeal} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{entry ? t('Save') : t('Add')}</Button>
    {entry && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { deleteEntry(entry.id); close(); toast(t('Deleted')) }}>{t('Delete')}</Button></>}
  </>
}
export const quickAddSheet = opts => ui().openSheet(close => <QuickSheet {...opts} close={close} />)

/** Tapping a logged row: the weight sheet for a weighed one, the numbers sheet for a quick one. */
export const entrySheet = entry => (entry.g > 0
  ? ui().openSheet(close => <AmountSheet entry={entry} close={close} />)
  : ui().openSheet(close => <QuickSheet entry={entry} close={close} />))

function NumField({ label, value, onChange, placeholder, decimal = true }) {
  return <label className="nt-field">
    <span>{label}</span>
    <NumberField className="input" value={value} onChange={onChange} nullable decimal={decimal} placeholder={placeholder} />
  </label>
}

/* ============================ my products ============================ */

// A product of your own, per 100 g — typed from a label, filled in from a barcode lookup or
// from a photographed label (`prefill`). Saved once, found by name ever after.
function FoodForm({ existing, prefill, onDone, close }) {
  const src = existing || prefill || {}
  const nameRef = useRef(null)
  const onFocus = useSheetKeyboard(nameRef)
  const [n, setN] = useState(src.n || '')
  const [brand, setBrand] = useState(src.brand || '')
  const [k, setK] = useState(src.k ?? null)
  const [p, setP] = useState(src.p ?? null)
  const [f, setF] = useState(src.f ?? null)
  const [c, setC] = useState(src.c ?? null)
  const [sv, setSv] = useState(src.sv || null)
  const fromMacros = atwater({ p: p || 0, f: f || 0, c: c || 0 })
  // The label's energy and its macros disagreeing by a quarter is nearly always a typo, or a
  // "per serving" column read as "per 100 g". Said, not corrected: the label may be right.
  const odd = k > 0 && fromMacros > 0 && Math.abs(k - fromMacros) > Math.max(15, k * 0.25)
  const save = () => {
    if (!n.trim()) { toast(t('Give it a name')); return }
    if (k == null && !fromMacros) { toast(t('Enter the calories, or the protein, fat and carbs')); return }
    const row = saveMyFood({ id: existing?.id, n, brand, code: src.code, k: k == null ? '' : k, p: p || 0, f: f || 0, c: c || 0, sv: sv || 0, src: src.src || 'own' })
    close()
    if (!row) { toast(t('Could not save')); return }
    if (onDone) onDone(row); else toast(t('Saved to my products'))
  }
  return <>
    <h3>{existing ? t('Edit product') : t('New product')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Values per 100 g, as printed on the label.')}</div>
    <input ref={nameRef} className="input" placeholder={t('Product name')} value={n} maxLength={80} onFocus={onFocus} onChange={e => setN(e.target.value)} />
    <div style={{ height: 8 }} />
    <TextField placeholder={t('Brand (optional)')} value={brand} maxLength={40} onChange={e => setBrand(e.target.value)} />
    <div className="nt-fields" style={{ marginTop: 10 }}>
      <NumField label={t('kcal')} value={k} onChange={setK} placeholder={fromMacros ? String(fromMacros) : ''} decimal={false} />
      <NumField label={t('Protein')} value={p} onChange={setP} />
      <NumField label={t('Fat')} value={f} onChange={setF} />
      <NumField label={t('Carbs')} value={c} onChange={setC} />
    </div>
    {odd && <div className="small row nt-warn"><Icon name="warning" />{t('{0} kcal does not match these macros (about {1}). Check the label — is this column per 100 g?', k, fromMacros)}</div>}
    <div className="nt-fields one" style={{ marginTop: 10 }}>
      <NumField label={t('Usual portion, g (optional)')} value={sv} onChange={setSv} decimal={false} />
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => {
      close()
      confirmSheet({
        title: t('Delete “{0}”?', existing.n), message: t('It disappears from search. What you already logged keeps its numbers.'),
        confirmText: t('Delete'), danger: true, onConfirm: () => { archiveMyFood(existing.id); toast(t('Deleted')) }
      })
    }}>{t('Delete')}</Button></>}
  </>
}
export const foodFormSheet = (existing, { prefill, onDone } = {}) => ui().openSheet(close => <FoodForm existing={existing} prefill={prefill} onDone={onDone} close={close} />)

function MyFoods({ close }) {
  const S = useStore(s => s.S)
  const foods = myFoods(nutritionOf(S)).sort((a, b) => a.n.localeCompare(b.n, getLang()))
  return <>
    <h3>{t('My products')}</h3>
    {!foods.length && <div className="empty" style={{ padding: '24px 12px' }}>{t('Nothing here yet. A product you add once is found by name ever after.')}</div>}
    <div className="list">
      {foods.map(f => <div key={f.id} className="item" {...tappable(() => foodFormSheet(f))}>
        <div className="grow"><div className="tt">{f.n}</div><div className="ss">{f.brand ? f.brand + ' · ' : ''}{macroLine(f)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="tinted" icon="plus" onClick={() => foodFormSheet(null)}>{t('New product')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}
export const myFoodsSheet = () => ui().openSheet(close => <MyFoods close={close} />)

/* ============================ find a food ============================ */

// The add sheet. Before a letter is typed: what you logged recently, then your own products.
// While typing: those, then the built-in list. A barcode's digits, or a name the list does not
// know, can be looked up online when the instance offers it — on a button, never as you type.
function AddFood({ d, m, extra, close }) {
  const S = useStore(s => s.S)
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const inputRef = useRef(null)
  const onFocus = useSheetKeyboard(inputRef)
  const [q, setQ] = useState('')
  const [generic, setGeneric] = useState([])
  const [online, setOnline] = useState(null)      // null | { busy } | { items } | { error }
  useEffect(() => { let on = true; loadFoods().then(f => { if (on) setGeneric(f) }).catch(() => {}); return () => { on = false } }, [])
  const nut = nutritionOf(S)
  const results = useMemo(
    () => searchFoods(q, { own: myFoods(nut), recent: recentFoods(nut, 30), generic, lang: getLang(), limit: 40 }),
    [q, generic, S.nutrition])
  const code = barcodeOf(q)
  const canOnline = onlineAvailable(config, user)
  const typed = q.trim().length >= 3

  const pick = item => {
    if (item.fixed) { logQuick({ n: item.n, ...item.fixed }, { d, m }); close(); toast(t('Added')); return }
    amountSheet(item, { d, m, onDone: () => { close(); toast(t('Added')) } })
  }
  const goOnline = async () => {
    setOnline({ busy: true })
    try {
      if (code) {
        const food = await lookupBarcode(code)
        setOnline(null)
        // A found product goes through the form: the database is written by volunteers and the
        // user is holding the pack — one look before it becomes "my product" is cheap.
        foodFormSheet(null, { prefill: { ...food, src: 'off' }, onDone: row => pick(ownItem(row)) })
      } else setOnline({ items: await searchOnline(q.trim(), getLang()) })
    } catch (e) { setOnline({ error: onlineErrorText(e) }) }
  }
  const ownItem = row => ({ kind: 'own', key: 'o:' + row.id, n: row.n, per100: { k: row.k, p: row.p, f: row.f, c: row.c }, g: row.sv || 100, ref: 'o:' + row.id })
  const pickOnline = food => foodFormSheet(null, { prefill: { ...food, src: 'off' }, onDone: row => pick(ownItem(row)) })

  return <>
    <h3>{t('Add to {0}', mealName(m).toLowerCase())}</h3>
    <SearchField ref={inputRef} value={q} onFocus={onFocus} placeholder={canOnline ? t('Food name or barcode digits') : t('Food name')}
      onChange={e => { setQ(e.target.value); setOnline(null) }} onClear={() => { setQ(''); setOnline(null) }} />
    <div className="chips nt-chips" style={{ margin: '10px 0' }}>
      {extra && extra({ d, m, close })}
      <button className="chip" onClick={() => quickAddSheet({ d, m })}><Icon name="bolt" /> {t('Quick add')}</button>
      <button className="chip" onClick={() => foodFormSheet(null, { prefill: { n: code ? '' : q.trim(), code: code || undefined }, onDone: row => pick(ownItem(row)) })}><Icon name="plus" /> {t('New product')}</button>
      <button className="chip" onClick={myFoodsSheet}><Icon name="star" /> {t('My products')}</button>
    </div>

    {!q.trim() && !!results.length && <h4 className="sec" style={{ marginTop: 4 }}>{t('Recent')}</h4>}
    <div className="list">
      {results.map(r => <div key={r.key} className="item" {...tappable(() => pick(r))}>
        <div className="grow">
          <div className="tt">{r.n}{r.kind === 'own' && <span className="tag" style={{ marginLeft: 8 }}>{t('mine')}</span>}</div>
          <div className="ss">{r.fixed ? macroLine(r.fixed) : `${r.sub ? r.sub + ' · ' : ''}${t('per 100 g')}: ${macroLine(r.per100)}`}</div>
        </div>
        <Icon name="plus" className="chev" />
      </div>)}
    </div>
    {!results.length && q.trim() && !code && <div className="empty" style={{ padding: '20px 12px' }}>
      {t('Nothing by that name. Add it as a new product, or log the numbers with Quick add.')}
    </div>}

    {canOnline && (code || typed) && <div style={{ marginTop: 12 }}>
      {!online && <Button variant="tinted" icon="globe" onClick={goOnline}>{code ? t('Look up barcode {0}', code) : t('Search online for “{0}”', q.trim())}</Button>}
      {online?.busy && <div className="muted small" style={{ textAlign: 'center', padding: 12 }}>{t('Asking Open Food Facts…')}</div>}
      {online?.error && <div className="small row nt-warn"><Icon name="warning" />{online.error}</div>}
      {online?.items && <>
        <h4 className="sec">{t('Open Food Facts')}</h4>
        {!online.items.length && <div className="muted small" style={{ padding: '4px 2px 10px' }}>{t('Nothing found online either.')}</div>}
        <div className="list">
          {online.items.map(f => <div key={f.code || f.n} className="item" {...tappable(() => pickOnline(f))}>
            <div className="grow"><div className="tt">{f.n}</div><div className="ss">{f.brand ? f.brand + ' · ' : ''}{t('per 100 g')}: {macroLine(f)}</div></div>
            <Icon name="plus" className="chev" />
          </div>)}
        </div>
        <div className="dim small" style={{ marginTop: 8 }}>{t('Data from Open Food Facts (ODbL), entered by volunteers — check it against the pack.')}</div>
      </>}
    </div>}
    {!canOnline && code && <div className="muted small" style={{ marginTop: 10 }}>{t('This looks like a barcode. Online lookup is not available here — add the product by hand from its label.')}</div>}
  </>
}
/** `extra({ d, m, close })` renders more chips in the action row — the AI entry points. */
export const addFoodSheet = ({ d = todayISO(), m = mealNow(), extra } = {}) => ui().openSheet(close => <AddFood d={d} m={m} extra={extra} close={close} />)

/* ============================ the target ============================ */

const GOAL_NAME = { lose: () => t('Lose'), maintain: () => t('Maintain'), gain: () => t('Gain') }
const MISSING = { weight: () => t('a weigh-in'), height: () => t('your height'), born: () => t('your year of birth') }

function Targets({ close }) {
  const S = useStore(s => s.S)
  const set = settingsOf(S)
  const today = todayISO()
  const base = baseTargets(S, today)
  const person = personOf(S, today)
  const [manual, setManual] = useState({ kcal: set.kcal || null, p: set.p || null, f: set.f || null, c: set.c || null })
  const isManual = set.mode === 'manual'
  const rateLim = RATE[set.goal]
  const rate = rateLim ? (set.rate > 0 ? Math.min(rateLim.max, Math.max(rateLim.min, set.rate)) : rateLim.def) : null
  const perWeek = rate && person.kg ? Math.round(rate * person.kg * 10) / 1000 : null
  const saveManual = () => {
    const kcal = manual.kcal || atwater({ p: manual.p || 0, f: manual.f || 0, c: manual.c || 0 })
    if (!(kcal > 0)) { toast(t('Enter the calories, or the protein, fat and carbs')); return }
    setTargets({ mode: 'manual', kcal, p: manual.p || 0, f: manual.f || 0, c: manual.c || 0 })
    close(); toast(t('Target saved'))
  }
  return <>
    <h3>{t('Daily target')}</h3>
    <Segmented options={[{ value: 'auto', label: t('Calculated') }, { value: 'manual', label: t('My own numbers') }]}
      value={set.mode} onChange={mode => setTargets({ mode })} />
    <div style={{ height: 14 }} />

    {isManual ? <>
      <div className="nt-fields">
        <NumField label={t('kcal')} value={manual.kcal} onChange={v => setManual(x => ({ ...x, kcal: v }))} decimal={false} />
        <NumField label={t('Protein')} value={manual.p} onChange={v => setManual(x => ({ ...x, p: v }))} decimal={false} />
        <NumField label={t('Fat')} value={manual.f} onChange={v => setManual(x => ({ ...x, f: v }))} decimal={false} />
        <NumField label={t('Carbs')} value={manual.c} onChange={v => setManual(x => ({ ...x, c: v }))} decimal={false} />
      </div>
      <div style={{ height: 14 }} />
      <Button variant="primary" onClick={saveManual}>{t('Save')}</Button>
    </> : <>
      <div className="sect-t">{t('Goal')}</div>
      <Segmented options={GOALS.map(g => ({ value: g, label: GOAL_NAME[g]() }))} value={set.goal} onChange={goal => setTargets({ goal, rate: null })} />
      {rateLim && <>
        <div className="row between" style={{ margin: '14px 2px 2px' }}>
          <span className="small muted">{t('Pace')}</span>
          <span className="small"><b>{rate.toLocaleString(getLang())} %</b> {t('of body weight a week')}{perWeek ? ` · ≈ ${perWeek.toLocaleString(getLang())} ${t('kg')}` : ''}</span>
        </div>
        <Slider value={rate} min={rateLim.min} max={rateLim.max} step={0.05} onChange={v => setTargets({ rate: v })} />
      </>}
      <div className="row between" style={{ margin: '14px 2px 6px' }}>
        <span className="small muted">{t('Protein')}</span>
        <span className="small">{t('Grams per kilogram of body weight')}</span>
      </div>
      <Stepper value={set.proteinPerKg} step={0.1} onChange={v => setTargets({ proteinPerKg: Math.min(PROTEIN.max, Math.max(PROTEIN.min, v || PROTEIN.def)) })} />
      <div style={{ height: 6 }} />
      <Row title={t('Follow my training')} subtitle={t('A little more on training days, a little less on rest days — the week adds up the same.')}>
        <Switch checked={set.cycle !== false} onChange={v => setTargets({ cycle: v })} />
      </Row>

      {base.kcal ? <div className="nt-result">
        <div className="nt-now">
          <div><b>{base.kcal}</b><span>{t('kcal')}</span></div>
          <div><b>{base.p}</b><span>{t('Protein')}</span></div>
          <div><b>{base.f}</b><span>{t('Fat')}</span></div>
          <div><b>{base.c}</b><span>{t('Carbs')}</span></div>
        </div>
        <div className="small muted" style={{ lineHeight: 1.45 }}>
          {base.basis === 'adaptive'
            ? t('You burn about {0} kcal a day — measured from what you logged against what the scale did over the last four weeks.', base.tdee)
            : t('You burn about {0} kcal a day — an estimate from your body and activity level. Log food and weigh in for a few weeks and it is measured instead.', base.tdee)}
          {base.floored && ' ' + t('The target was raised to the minimum this app will set on its own.')}
        </div>
      </div> : <div className="nt-result">
        <div className="small" style={{ lineHeight: 1.45 }}>{t('To calculate a target the app still needs: {0}.', base.missing.map(k => MISSING[k]()).join(', '))}</div>
        <div style={{ height: 10 }} />
        <Button variant="tinted" icon="person" onClick={() => { close(); nav('/body') }}>{t('Open body profile')}</Button>
      </div>}
      <div style={{ height: 12 }} />
      <Button variant="primary" onClick={close}>{t('Done')}</Button>
    </>}
    <div className="dim small" style={{ marginTop: 12, lineHeight: 1.45 }}>{t('These are estimates for healthy adults, not medical advice. If you are pregnant, under 18, or have a medical condition, set your numbers with a professional.')}</div>
  </>
}
export const targetsSheet = () => ui().openSheet(close => <Targets close={close} />)
