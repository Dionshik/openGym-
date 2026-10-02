/* The AI entry points of the food diary: photograph a plate, photograph a label, describe a meal
 * in words, ask what to eat next.
 *
 * Everything here ends in a draft. A model estimating a portion from a picture is off by a third
 * on a good day — more for a local model — so nothing it says is logged until the person has
 * seen it, corrected the weights and pressed Add. The sheet says so, next to the numbers.
 *
 * What leaves the device is said next to the button that sends it, and needs a go-ahead of its
 * own (`coach.foodConsent`): agreeing to the Coach reading a training log is not agreeing to
 * send a photograph of dinner.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t, getLang } from './lib/i18n.js'
import { DEMO } from './lib/demo.js'
import { MOBILE } from './lib/mobile.js'
import { todayISO } from './lib/format.js'
import { emptyCoach } from './lib/coach.js'
import { disclosure } from './lib/coach-api.js'
import { MEALS, nutritionOf, dayTotals, remaining, frequentFoods, myFoods, scale } from './lib/nutrition.js'
import { targetsFor } from './lib/nutrition-targets.js'
import { loadFoods, foodFromRow } from './lib/food-search.js'
import { suggestFromOwn } from './lib/food-suggest.js'
import { foodAiState, hasFoodConsent, draftFromMeal, suggestContext, ideasFromAi, FOOD_CONSENT_VERSION } from './lib/food-ai.js'
import { runFood, foodErrorText } from './lib/food-api.js'
import { fileToJpeg } from './lib/image-prep.js'
import { photosAvailable } from './lib/photos.js'
import { logMany } from './nutrition-actions.js'
import { addPhoto, photoError } from './photo-actions.js'
import { foodFormSheet, amountSheet, mealName, mealNow, macroLine, fmt1, MEAL_NAME } from './nutrition-sheets.jsx'
import { useSheetKeyboard } from './lib/use-sheet-keyboard.js'
import Icon from './components/Icon.jsx'
import { Button, Segmented, Stepper, Switch } from './components/ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const stateOf = ({ config, user, coachLocal }) => foodAiState({ config, user, coachMode: coachLocal?.mode, demo: DEMO, mobile: MOBILE })

export const foodAiAvailable = ctx => stateOf(ctx).available

// Staples offered for "what to eat" before the diary has any history of its own to draw on.
const STAPLES = ['u171477', 'u170686', 'u169757', 's-tvorog-5', 'u173424', 'u173905', 'u173944', 's-kefir-25']

/* ------------------------------ consent ------------------------------ */

// Who gets it, in words, from the same disclosure call the Coach's own consent screen uses.
function useProvider() {
  const config = useStore(s => s.config)
  const [info, setInfo] = useState(null)
  useEffect(() => { let on = true; disclosure().then(d => { if (on) setInfo(d) }).catch(() => {}); return () => { on = false } }, [])
  return { name: info?.host || info?.providerLabel || config?.coach?.providerLabel || t('the configured AI provider'), own: info?.payer === 'you' }
}
// Recorded on the profile and pushed before the request: the server reads the go-ahead from its
// own copy of the state, not from the request that needs it.
async function agree() {
  const S = useStore.getState().S
  if (DEMO || hasFoodConsent(S)) return
  useStore.getState().update(s => { s.coach = { ...(s.coach || emptyCoach()), foodConsent: { agreedAt: new Date().toISOString(), version: FOOD_CONSENT_VERSION } } })
  await useStore.getState().pushState()
}

/* ------------------------------ the chips in the add sheet ------------------------------ */

function AiChips({ d, m, onLogged }) {
  const config = useStore(s => s.config), user = useStore(s => s.user), coachLocal = useStore(s => s.coachLocal)
  const { available, vision } = stateOf({ config, user, coachLocal })
  if (!available) return null
  const open = mode => ui().openSheet(close => <ReadSheet mode={mode} d={d} m={m} onLogged={onLogged} close={close} />)
  return <>
    {vision && <button className="chip" onClick={() => open('photo')}><Icon name="camera" /> {t('Photo of the meal')}</button>}
    {vision && <button className="chip" onClick={() => open('label')}><Icon name="image" /> {t('Photo of the label')}</button>}
    <button className="chip" onClick={() => open('describe')}><Icon name="sparkles" /> {t('Describe in words')}</button>
  </>
}
// `close` is the add sheet's own: once a drafted meal is logged there is nothing left to add it to.
export const foodAiChips = ({ d, m, close }) => <AiChips d={d} m={m} onLogged={close} />

/* ------------------------------ read a plate, a label, a description ------------------------------ */

function ReadSheet({ mode, d, m, onLogged, close }) {
  const S = useStore(s => s.S)
  const provider = useProvider()
  const [pic, setPic] = useState(null)             // { data, url, bytes }
  // The file as the camera gave it, for the one case it is kept: the person ticks "save the
  // photo" on the draft. That is a second, separate upload to the photo store (photo-actions.js)
  // — what went to the AI was a smaller copy the server held in memory and dropped.
  const [original, setOriginal] = useState(null)
  const [keep, setKeep] = useState(false)
  const config = useStore(s => s.config), user = useStore(s => s.user)
  const canKeep = mode === 'photo' && photosAvailable({ config, user, demo: DEMO })
  const [caption, setCaption] = useState('')
  const [phase, setPhase] = useState('input')       // input | busy | draft
  const [waited, setWaited] = useState(0)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null)          // { rows, note }
  const [meal, setMeal] = useState(m)
  const abort = useRef(null)
  const cameraRef = useRef(null), galleryRef = useRef(null), textRef = useRef(null)
  const onFocus = useSheetKeyboard(textRef)
  const agreed = DEMO || hasFoodConsent(S)
  const needsPic = mode !== 'describe'
  // The preview is an object URL: give it back when the sheet goes, and stop a call nobody is
  // waiting for any more.
  useEffect(() => () => { abort.current?.abort() }, [])
  useEffect(() => () => { if (pic?.url) URL.revokeObjectURL(pic.url) }, [pic])

  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!file) return
    setError('')
    try { setPic(await fileToJpeg(file)); setOriginal(file) } catch { setError(t('That picture could not be read — try another one.')) }
  }

  const send = async () => {
    if (needsPic && !pic) { setError(t('Add a photo first.')); return }
    if (mode === 'describe' && !caption.trim()) { setError(t('Describe the meal first.')); return }
    setError(''); setPhase('busy'); setWaited(0)
    const ctl = new AbortController()
    abort.current = ctl
    try {
      await agree()
      const r = await runFood({ kind: mode === 'label' ? 'label' : 'meal', caption: mode === 'label' ? '' : caption.trim(), image: pic?.data }, { signal: ctl.signal, onWait: setWaited })
      if (mode === 'label') {
        if (!r.food) { setError(r.note || t('No nutrition table was found in that picture.')); setPhase('input'); return }
        close(); onLogged?.()
        // Through the product form, so the person checks it against the pack before it is kept.
        foodFormSheet(null, {
          prefill: { ...r.food, src: 'label' },
          onDone: row => amountSheet({ n: row.n, per100: { k: row.k, p: row.p, f: row.f, c: row.c }, g: row.sv || 100, ref: 'o:' + row.id }, { d, m })
        })
        if (r.food.check || r.note) toast(r.note || t('Check the numbers against the label — they did not add up.'))
        return
      }
      const generic = await loadFoods().catch(() => [])
      const rows = draftFromMeal(r.items, { generic, lang: getLang() }).map((x, i) => ({ ...x, key: i }))
      if (!rows.length) { setError(r.note || t('No food was found in that.')); setPhase('input'); return }
      setDraft({ rows, note: r.note })
      setPhase('draft')
    } catch (e) {
      if (e.code !== 'cancelled') setError(foodErrorText(e))
      setPhase('input')
    } finally { abort.current = null }
  }

  const title = mode === 'photo' ? t('Photo of the meal') : mode === 'label' ? t('Photo of the label') : t('Describe the meal')
  const what = mode === 'describe' ? t('what you typed') : mode === 'label' ? t('the photo') : t('the photo and what you typed')
  const fine = DEMO
    ? t('Demo: nothing leaves this browser — the answer is canned.')
    : canKeep
      // Where photos can be kept, "not stored anywhere" would be one switch away from false.
      ? (provider.own
        ? t('Sent straight to {0} with your own API key: {1}. Nothing from your diary or your training log. The photo is kept only if you choose to save it with the entry.', provider.name, what)
        : t('Sent to {0}: {1}. Nothing from your diary or your training log. The photo is kept only if you choose to save it with the entry.', provider.name, what))
      : provider.own
        ? t('Sent straight to {0} with your own API key: {1}. Nothing from your diary or your training log. The photo is not stored anywhere.', provider.name, what)
        : t('Sent to {0}: {1}. Nothing from your diary or your training log. The photo is not stored anywhere.', provider.name, what)

  if (phase === 'draft') return <Draft draft={draft} setDraft={setDraft} meal={meal} setMeal={setMeal} d={d} close={() => { close(); onLogged?.() }} back={() => setPhase('input')}
    keep={canKeep && original ? { on: keep, set: setKeep, file: original } : null} />

  return <>
    <h3>{title}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {mode === 'photo' && t('Take the picture from above with the whole plate in view. Add a few words — what it is, how much — and the estimate gets much better.')}
      {mode === 'label' && t('Photograph the nutrition table on the pack, straight on and in focus. The numbers are copied into a new product for you to check.')}
      {mode === 'describe' && t('In your own words, in any language: what you ate and roughly how much.')}
    </div>

    {needsPic && <>
      {pic && <img className="nt-pic" src={pic.url} alt="" />}
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <Button variant="tinted" icon="camera" disabled={phase === 'busy'} onClick={() => cameraRef.current?.click()}>{pic ? t('Retake') : t('Take a photo')}</Button>
        <Button variant="tinted" icon="image" disabled={phase === 'busy'} onClick={() => galleryRef.current?.click()}>{t('Choose a photo')}</Button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onFile} />
    </>}

    {mode !== 'label' && <div className="picker-search">
      <textarea ref={textRef} className="input" rows={mode === 'describe' ? 3 : 2} maxLength={300} value={caption} onFocus={onFocus} disabled={phase === 'busy'}
        placeholder={mode === 'describe' ? t('e.g. a plate of buckwheat with two chicken cutlets and a tomato salad with oil') : t('What is it, and how much? (optional)')}
        onChange={e => setCaption(e.target.value)} />
    </div>}

    {phase === 'busy'
      ? <>
        <div className="nt-busy"><Icon name="sparkles" /> {t('Reading… {0} s', Math.round(waited / 1000))}</div>
        {waited > 20000 && <div className="dim small" style={{ textAlign: 'center', marginBottom: 8 }}>{t('A model running on a home server can take a few minutes.')}</div>}
        <Button variant="ghost" className="dim" onClick={() => abort.current?.abort()}>{t('Cancel')}</Button>
      </>
      : <Button variant="primary" icon="sparkles" onClick={send}>{agreed ? (needsPic ? t('Read the photo') : t('Work it out')) : t('Agree and send')}</Button>}

    <div className="small dim" style={{ margin: '8px 2px 0', lineHeight: 1.4 }}>{fine}</div>
    {error && <div className="small" role="alert" style={{ margin: '10px 2px 0', color: 'var(--red)', whiteSpace: 'pre-line' }}>{error}</div>}
  </>
}

// What the model made of the plate: every row can be renamed in spirit (removed), re-weighed,
// and nothing is in the diary until Add. The total moves as the weights do.
export function Draft({ draft, setDraft, meal, setMeal, d, close, back, keep }) {
  const rows = draft.rows
  const set = (key, patch) => setDraft(x => ({ ...x, rows: x.rows.map(r => (r.key === key ? { ...r, ...patch } : r)) }))
  const drop = key => setDraft(x => ({ ...x, rows: x.rows.filter(r => r.key !== key) }))
  const total = rows.reduce((a, r) => { const v = scale(r.per100, r.g); return { k: a.k + v.k, p: a.p + v.p, f: a.f + v.f, c: a.c + v.c } }, { k: 0, p: 0, f: 0, c: 0 })
  const add = () => {
    const good = rows.filter(r => r.g > 0)
    if (!good.length) { toast(t('Nothing to add')); return }
    logMany(good.map(r => ({ item: { n: r.n, per100: r.per100, ref: r.ref }, grams: r.g })), { d, m: meal })
    // Only on the person's say-so, and after the entry is in: a photo that fails to save must
    // not cost them the meal they just corrected.
    if (keep?.on) addPhoto(keep.file, { kind: 'meal', d, m: meal }).catch(e => toast(photoError(e)))
    close()
    toast(t('Added'))
  }
  return <>
    <h3>{t('Check and correct')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('This is an estimate. Photos routinely miss by a third or more — fix the weights you know before adding.')}</div>
    <div className="list">
      {rows.map(r => {
        const v = scale(r.per100, r.g)
        return <div key={r.key} className="nt-draft">
          <div className="row between" style={{ gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div className="tt">{r.n}</div>
              <div className="ss">
                {v.k} {t('kcal')} · {t('P')} {fmt1(v.p)} · {t('F')} {fmt1(v.f)} · {t('C')} {fmt1(v.c)}
                {' · '}<span className={r.src === 'table' ? '' : 'nt-est'}>{r.src === 'table' ? t('values from the food table') : r.conf === 'low' ? t('AI guess') : t('AI estimate')}</span>
              </div>
            </div>
            <button className="iconbtn" style={{ flex: 'none', color: 'var(--red)' }} onClick={() => drop(r.key)} aria-label={t('Remove')}><Icon name="xmark" /></button>
          </div>
          <Stepper value={r.g} step={10} decimal={false} unit={t('g')} onChange={g => set(r.key, { g })} />
        </div>
      })}
    </div>
    {draft.note && <div className="nt-note" style={{ alignItems: 'flex-start' }}><Icon name="info" style={{ marginTop: 2 }} /><span>{draft.note}</span></div>}
    <div className="nt-now" style={{ marginTop: 12 }}>
      <div><b>{Math.round(total.k)}</b><span>{t('kcal')}</span></div>
      <div><b>{fmt1(total.p)}</b><span>{t('Protein')}</span></div>
      <div><b>{fmt1(total.f)}</b><span>{t('Fat')}</span></div>
      <div><b>{fmt1(total.c)}</b><span>{t('Carbs')}</span></div>
    </div>
    <Segmented options={MEALS.map((k, i) => ({ value: i, label: MEAL_NAME[k]() }))} value={meal} onChange={setMeal} />
    {keep && <div className="row between" style={{ marginTop: 12, gap: 12 }}>
      <div>
        <div>{t('Save the photo with this entry')}</div>
        <div className="dim small">{t('Kept on this server as a file, not encrypted. Off: the photo is gone once this sheet closes.')}</div>
      </div>
      <Switch checked={keep.on} onChange={keep.set} />
    </div>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={add}>{t('Add to {0}', mealName(meal).toLowerCase())}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={back}>{t('Back')}</Button>
  </>
}

/* ------------------------------ what should I eat? ------------------------------ */

// Always answers: the list at the top is plain arithmetic over foods the person already eats
// (lib/food-suggest.js). Where an AI is connected it can be asked for something more inventive,
// and its ideas are priced with the same numbers.
function Suggest({ d, close }) {
  const S = useStore(s => s.S)
  const config = useStore(s => s.config), user = useStore(s => s.user), coachLocal = useStore(s => s.coachLocal)
  const ai = stateOf({ config, user, coachLocal }).available
  const provider = useProvider()
  const nut = nutritionOf(S)
  const target = targetsFor(S, d, todayISO())
  const left = remaining(target, dayTotals(nut, d))
  const [generic, setGeneric] = useState([])
  const [wish, setWish] = useState('')
  const [busy, setBusy] = useState(false)
  const [waited, setWaited] = useState(0)
  const [aiIdeas, setAiIdeas] = useState(null)
  const [error, setError] = useState('')
  const abort = useRef(null)
  const wishRef = useRef(null)
  const onFocus = useSheetKeyboard(wishRef)
  useEffect(() => { let on = true; loadFoods().then(f => { if (on) setGeneric(f) }).catch(() => {}); return () => { on = false; abort.current?.abort() } }, [])

  // The person's own foods first; a handful of staples only until the diary has a history.
  const foods = useMemo(() => {
    const own = [
      ...frequentFoods(nut, 30).filter(f => f.per100).map(f => ({ n: f.n, per100: f.per100, ref: f.r })),
      ...myFoods(nut).map(f => ({ n: f.n, per100: { k: f.k, p: f.p, f: f.f, c: f.c }, ref: 'o:' + f.id }))
    ]
    const seen = new Set()
    const uniq = own.filter(f => !seen.has(f.n.toLowerCase()) && seen.add(f.n.toLowerCase()))
    if (uniq.length >= 6) return uniq
    const staples = STAPLES.map(id => generic.find(r => r[0] === id)).filter(Boolean).map(r => foodFromRow(r, getLang()))
      .map(f => ({ n: f.n, per100: { k: f.k, p: f.p, f: f.f, c: f.c }, ref: 'g:' + f.id }))
    return [...uniq, ...staples.filter(f => !seen.has(f.n.toLowerCase()))]
  }, [S.nutrition, generic])

  const own = useMemo(() => (left ? suggestFromOwn(left, foods, { target, limit: 4 }) : []), [foods, left?.k, left?.p])
  const meal = mealNow()
  const take = idea => {
    logMany(idea.items.map(x => ({ item: { n: x.n, per100: x.per100, ref: x.ref }, grams: x.g })), { d, m: meal })
    close(); toast(t('Added to {0}', mealName(meal).toLowerCase()))
  }
  const ask = async () => {
    setBusy(true); setError(''); setWaited(0)
    const ctl = new AbortController()
    abort.current = ctl
    try {
      await agree()
      const { context, byId } = suggestContext({ remaining: left, target, meal: MEALS[meal], foods, wish })
      const r = await runFood({ kind: 'suggest', context }, { signal: ctl.signal, onWait: setWaited })
      setAiIdeas(ideasFromAi(r.ideas, byId))
    } catch (e) { if (e.code !== 'cancelled') setError(foodErrorText(e)) }
    finally { setBusy(false); abort.current = null }
  }

  const Idea = ({ idea, tag }) => <div className="nt-idea">
    {idea.title && <div className="tt" style={{ fontWeight: 600 }}>{idea.title}{tag && <span className="tag acc" style={{ marginLeft: 8 }}>{tag}</span>}</div>}
    {idea.items.map((x, i) => <div key={i} className="row between small" style={{ padding: '3px 0' }}>
      <span>{x.n}</span><span className="muted" style={{ flex: 'none', marginLeft: 10 }}>{x.g} {t('g')}</span>
    </div>)}
    <div className="ss" style={{ marginTop: 4 }}>{macroLine(idea)}</div>
    {idea.why && <div className="dim small" style={{ marginTop: 4 }}>{idea.why}</div>}
    <div style={{ height: 8 }} />
    <Button size="sm" variant="tinted" icon="plus" onClick={() => take(idea)}>{t('Add to {0}', mealName(meal).toLowerCase())}</Button>
  </div>

  return <>
    <h3>{t('What should I eat?')}</h3>
    {!left ? <div className="muted small">{t('Set a daily target first — then this can tell you what fits.')}</div> : <>
      <div className="nt-now" style={{ marginTop: 4 }}>
        <div><b>{left.k}</b><span>{t('kcal left')}</span></div>
        <div><b>{fmt1(left.p)}</b><span>{t('Protein')}</span></div>
        <div><b>{fmt1(left.f)}</b><span>{t('Fat')}</span></div>
        <div><b>{fmt1(left.c)}</b><span>{t('Carbs')}</span></div>
      </div>
      {left.k < 80 && <div className="muted small">{t('You are at your target for today.')}</div>}

      {!!aiIdeas?.length && <><h4 className="sec">{t('From the AI')}</h4><div className="list">{aiIdeas.map((idea, i) => <Idea key={i} idea={idea} />)}</div></>}
      {aiIdeas && !aiIdeas.length && <div className="muted small" style={{ margin: '8px 0' }}>{t('The AI had nothing to add — the ideas below are from your own foods.')}</div>}

      {!!own.length && <><h4 className="sec">{t('From what you usually eat')}</h4><div className="list">{own.map((idea, i) => <Idea key={i} idea={idea} />)}</div></>}
      {!own.length && left.k >= 80 && <div className="muted small" style={{ margin: '8px 0' }}>{t('Log a few days of food and this starts suggesting portions of what you actually eat.')}</div>}

      {ai && left.k >= 80 && <>
        <h4 className="sec">{t('Ask the AI')}</h4>
        <div className="picker-search">
          <input ref={wishRef} className="input" maxLength={200} value={wish} disabled={busy} onFocus={onFocus}
            placeholder={t('Anything you feel like? (optional)')} onChange={e => setWish(e.target.value)} />
        </div>
        {busy
          ? <>
            <div className="nt-busy"><Icon name="sparkles" /> {t('Thinking… {0} s', Math.round(waited / 1000))}</div>
            <Button variant="ghost" className="dim" onClick={() => abort.current?.abort()}>{t('Cancel')}</Button>
          </>
          : <Button variant="tinted" icon="sparkles" onClick={ask}>{DEMO || hasFoodConsent(S) ? t('Suggest meals') : t('Agree and send')}</Button>}
        <div className="small dim" style={{ margin: '8px 2px 0', lineHeight: 1.4 }}>
          {DEMO ? t('Demo: nothing leaves this browser — the answer is canned.')
            : t('Sent to {0}: what is left of today’s target, the names and values of foods you eat often, and what you typed. Nothing else from your diary or your training log.', provider.name)}
        </div>
        {error && <div className="small" role="alert" style={{ margin: '10px 2px 0', color: 'var(--red)', whiteSpace: 'pre-line' }}>{error}</div>}
      </>}
    </>}
    <div className="dim small" style={{ marginTop: 14, lineHeight: 1.45 }}>{t('Portions that fit your numbers — not dietary advice.')}</div>
  </>
}
export const suggestSheet = ({ d = todayISO() } = {}) => ui().openSheet(close => <Suggest d={d} close={close} />)
