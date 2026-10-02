// @vitest-environment happy-dom
// The diary's day view and the Body screen, against the real store: that what was logged is
// what is shown, that the numbers on screen are the ones the helpers compute, and that the
// entry points which depend on a server (online lookup, the AI, Apple Health, what the Coach
// may see) are absent where there is no server to back them.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.reject(Object.assign(new Error('offline'), {}))), apiBlob: vi.fn(() => Promise.reject(new Error('offline'))), apiBase: () => 'https://gym.example' }))
const nav = vi.fn()
const route = { pathname: '/body', search: '' }
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => route }))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { dayBefore } from '../lib/nutrition.js'
import { logFood, logQuick, setTargets, saveBodyProfile, saveMeasurement, setMeasureGoal } from '../nutrition-actions.js'
import Nutrition from './Nutrition.jsx'
import Body from './Body.jsx'
import MacroBars from '../components/MacroBars.jsx'

const clone = value => JSON.parse(JSON.stringify(value))
const today = todayISO()
const chicken = { n: 'Chicken breast', per100: { k: 165, p: 31, f: 3.6, c: 0 }, ref: 'g:u171477' }
const mounted = []
function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === label)

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  nav.mockReset()
  route.search = ''
  useStore.setState({ S: clone(DEF), user: null, ready: true, config: null, health: null, coachLocal: null, photos: null, photosKept: 0 })
  useUI.setState({ sheets: [] })
})
afterEach(() => { mounted.splice(0).forEach(r => act(() => r.unmount())); localStorage.clear() })

describe('the day view', () => {
  it('an empty day offers to log food and to set a target, and shows no bars it cannot fill', () => {
    const host = render(<Nutrition />)
    expect(host.textContent).toContain('Nutrition')
    expect(host.textContent).toContain('No daily target yet')
    expect(host.querySelectorAll('.nt-bar')).toHaveLength(0)
    expect(host.textContent).not.toContain('What should I eat?')
  })

  it('shows what was logged under its meal, and the day against the target', () => {
    setTargets({ mode: 'manual', kcal: 2000, p: 150, f: 70, c: 200 })
    logFood(chicken, 200, { d: today, m: 1 })
    logQuick({ n: 'Coffee with milk', k: 60 }, { d: today, m: 0 })
    const host = render(<Nutrition />)
    const rows = [...host.querySelectorAll('.nt-row')].map(r => r.textContent)
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.includes('Chicken breast'))).toContain('200 g')
    expect(host.querySelector('.nt-kc').textContent).toContain('390')
    expect(host.querySelector('.nt-kc').textContent).toContain('2,000')
    expect(host.querySelector('.nt-left').textContent).toBe('1,610 left')
    expect(host.querySelectorAll('.nt-bar')).toHaveLength(4)
    expect(host.textContent).toContain('What should I eat?')
  })

  it('goes back a day, never forward past today, and offers yesterday’s meals on an empty day', () => {
    logFood(chicken, 150, { d: dayBefore(today, 1), m: 2 })
    const host = render(<Nutrition />)
    expect(button(host, 'Next day').disabled).toBe(true)
    expect(host.textContent).toContain('Copy the day before')
    act(() => button(host, 'Copy the day before').click())
    expect(host.querySelectorAll('.nt-row')).toHaveLength(1)
    expect(useStore.getState().S.nutrition.log).toHaveLength(2)
    act(() => button(host, 'Previous day').click())
    expect(host.textContent).toContain('Yesterday')
    expect(button(host, 'Next day').disabled).toBe(false)
  })

  it('the plus opens the add sheet; with no server there is no AI chip and no online lookup in it', () => {
    const host = render(<Nutrition />)
    act(() => button(host, 'Add to lunch').click())
    const sheets = useUI.getState().sheets
    expect(sheets).toHaveLength(1)
    const sheet = render(sheets[0].render(() => {}))
    expect(sheet.textContent).toContain('Quick add')
    expect(sheet.textContent).not.toContain('Photo of the meal')
    expect(sheet.textContent).not.toContain('Describe in words')
    expect(sheet.querySelector('input').placeholder).toBe('Food name')
  })

  it('a server with the Coach and online lookup adds exactly those entry points', () => {
    useStore.setState({ user: { id: 'u1' }, config: { coach: { enabled: true, food: true, vision: false }, food: { lookup: true } } })
    const host = render(<Nutrition />)
    act(() => button(host, 'Add to lunch').click())
    const sheet = render(useUI.getState().sheets[0].render(() => {}))
    expect(sheet.textContent).toContain('Describe in words')
    expect(sheet.textContent).not.toContain('Photo of the meal')          // this provider cannot be sent pictures
    expect(sheet.querySelector('input').placeholder).toBe('Food name or barcode digits')
  })
})

describe('MacroBars', () => {
  it('turns red past the target and says by how much', () => {
    const host = render(<MacroBars totals={{ k: 2300, p: 100, f: 90, c: 200, n: 5 }} target={{ kcal: 2000, p: 150, f: 70, c: 200 }} />)
    expect(host.querySelector('.nt-left').className).toContain('over')
    expect(host.querySelector('.nt-left').textContent).toBe('300 over')
    expect(host.querySelectorAll('.nt-bar.over')).toHaveLength(2)        // energy and fat
  })
  it('says when the target moved for a training day', () => {
    const host = render(<MacroBars totals={{ k: 0, p: 0, f: 0, c: 0, n: 0 }} target={{ kcal: 2137, p: 150, f: 70, c: 234, shift: 137 }} />)
    expect(host.textContent).toContain('Training day: 137 kcal more than your average day.')
  })
})

describe('the Body screen', () => {
  it('starts empty, claims nothing about anyone, and shows no server-only cards to a guest', () => {
    const host = render(<Body />)
    expect(host.textContent).toContain('About you')
    expect(host.textContent).toContain('Not set')
    expect(host.textContent).not.toContain('Apple Health')
    expect(host.textContent).not.toContain('Share with the Coach')
    expect(host.textContent).not.toContain('At rest you burn')
  })

  it('with the facts in, says what the body burns, and charts a measurement that has history', () => {
    useStore.getState().update(s => { s.bodyweight = [{ d: today, w: 80, t: 1 }] })
    saveBodyProfile({ sex: 'm', born: +today.slice(0, 4) - 30, heightCm: 180, activity: 'moderate' })
    saveMeasurement(dayBefore(today, 30), { waist: 92 })
    saveMeasurement(today, { waist: 89.5, bodyFat: 20 })
    const host = render(<Body />)
    // body fat is known, so the lean-mass formula is used: 370 + 21.6 × 64
    expect(host.textContent).toContain('At rest you burn about 1752 kcal a day; with your daily activity about 2716.')
    expect(host.textContent).toContain('Waist')
    expect(host.querySelectorAll('.chip')).toHaveLength(2)
    expect(host.querySelector('.bd-last').textContent).toContain('89.5')
  })

  it('offers the Health connection where the instance has it, and the Coach switches only after the Coach was agreed to', () => {
    useStore.setState({ user: { id: 'u1' }, config: { health: true, coach: { enabled: true, food: true } } })
    let host = render(<Body />)
    expect(host.textContent).toContain('Apple Health')
    expect(host.textContent).not.toContain('Share with the Coach')
    useStore.getState().update(s => { s.coach = { consent: { agreedAt: '2026-10-01T00:00:00Z', version: 1 } } })
    host = render(<Body />)
    expect(host.textContent).toContain('Share with the Coach')
    const sw = [...host.querySelectorAll('.sect [role="switch"]')].at(-1)
    expect(sw.getAttribute('aria-checked')).toBe('false')
    act(() => sw.click())
    expect(Object.keys(useStore.getState().S.coach.consent.extra)).toEqual(['nutrition'])
  })

  it('a measurement with too little history says what a trend needs, and sets no forecast', () => {
    saveMeasurement(dayBefore(today, 30), { upperArmFlexedLeft: 38 })
    saveMeasurement(today, { upperArmFlexedLeft: 38.4 })
    const host = render(<Body />)
    expect(host.textContent).toContain('A trend needs at least 5 measurements — you have 2.')
    expect(host.querySelector('.cfc')).toBeNull()
    // the tape's own error is stated either way
    expect(host.textContent).toContain('can differ by 0.7 cm on their own')
  })

  it('a steady series shows the trend as a range, draws it, and counts the weeks to a goal inside it', () => {
    ;[84, 70, 56, 42, 28, 14, 0].forEach((ago, i) => saveMeasurement(dayBefore(today, ago), { upperArmFlexedLeft: 38 + 0.25 * i }))
    setMeasureGoal('upperArmFlexedLeft', 40)
    const host = render(<Body />)
    expect(host.textContent).toContain('Trend: +0.5 cm a month (between +0.2 and +0.9)')
    expect(host.textContent).toMatch(/In 12 weeks a reading will most likely be between \d+(\.\d)? and \d+(\.\d)? cm\./)
    expect(host.textContent).toContain('At this rate the goal is about 4 weeks away.')
    expect(host.textContent).toContain('Goal: 40 cm')
    expect(host.querySelector('.cfc')).toBeTruthy()
  })

  it('body fat is charted but gets no tape trend', () => {
    ;[84, 70, 56, 42, 28, 14, 0].forEach((ago, i) => saveMeasurement(dayBefore(today, ago), { bodyFat: 22 - 0.3 * i }))
    const host = render(<Body />)
    expect(host.textContent).not.toContain('Trend:')
    expect(host.textContent).not.toContain('A tape measures')
    expect(host.textContent).not.toContain('How to measure')
  })

  it('the measurement sheet offers the new sites, keeps wrist and ankle behind a button, and explains each site', () => {
    const host = render(<Body />)
    act(() => button(host, 'Add').click())
    const sheet = useUI.getState().sheets.at(-1)
    const el = render(sheet.render(() => {}))
    expect(el.textContent).toContain('Left arm, flexed')
    expect(el.textContent).toContain('Left forearm')
    expect(el.textContent).toContain('Abdomen')
    expect(el.textContent).not.toContain('Left wrist')
    act(() => button(el, 'More measurements').click())
    expect(el.textContent).toContain('Left wrist')
    expect(el.textContent).toContain('Right ankle')
    // every tape field has its help button; body fat and lean mass have none
    expect(el.querySelectorAll('.bd-fh .helpbtn')).toHaveLength(20)
  })
})

// Stored photos exist only where the instance keeps them and somebody is signed in to it; the
// pictures themselves need the server, which this test does not have — what is checked is where
// the entry points are, and that a picture is asked for by its own id through the session.
describe('stored photos on the two screens', () => {
  const mealPhoto = { id: 'a'.repeat(24), kind: 'meal', d: today, m: 1, mime: 'image/webp', w: 960, h: 1280, bytes: 90000, at: 1, thumb: true }
  const bodyPhoto = (id, d) => ({ id: id.repeat(24), kind: 'body', pose: 'front', d, mime: 'image/jpeg', w: 1200, h: 1600, bytes: 300000, at: 1, thumb: true })
  const signedIn = (photos = null) => useStore.setState({ user: { id: 'u1' }, config: { photos: true }, photos })

  it('a guest, and an instance that keeps no photos, see nothing of them', () => {
    let host = render(<Body />)
    expect(host.textContent).not.toContain('Progress photos')
    host = render(<Nutrition />)
    expect(host.querySelectorAll('[aria-label^="Photo of the meal"]')).toHaveLength(0)
    useStore.setState({ user: { id: 'u1' }, config: { health: true } })
    expect(render(<Body />).textContent).not.toContain('Progress photos')
    useStore.setState({ user: null, config: { photos: true } })
    expect(render(<Body />).textContent).not.toContain('Progress photos')
  })

  // The admin switched the store off again; the member's pictures are still on the server. They
  // cannot be shown any more, but they must still be the member's to remove.
  it('photos left on a server that switched storage off can still be deleted from the Body screen', () => {
    useStore.setState({ user: { id: 'u1' }, config: {}, photosKept: 3 })
    const host = render(<Body />)
    expect(host.textContent).toContain('Photo storage is switched off on this server, but 3 of your photos are still kept there.')
    expect(button(host, 'Delete them')).toBeTruthy()
    expect(button(host, 'Front view')).toBeUndefined()
    // nothing of the kind for a member with none left, or for a guest
    useStore.setState({ photosKept: 0 })
    expect(render(<Body />).textContent).not.toContain('Progress photos')
    useStore.setState({ user: null, photosKept: 3 })
    expect(render(<Body />).textContent).not.toContain('Progress photos')
  })

  it('the Body screen offers the four poses, says where the photos are kept, and compares once there are two', () => {
    signedIn({ rev: 1, items: [], used: 0, quota: 500 * 1024 * 1024 })
    let host = render(<Body />)
    expect(host.textContent).toContain('Progress photos')
    for (const pose of ['Front view', 'Side view', 'Back view', 'Flexed']) expect(button(host, pose)).toBeTruthy()
    expect(host.textContent).toContain('not encrypted')
    expect(button(host, 'Compare')).toBeUndefined()

    signedIn({ rev: 3, items: [bodyPhoto('b', dayBefore(today, 40)), bodyPhoto('c', today)], used: 600000, quota: 500 * 1024 * 1024 })
    host = render(<Body />)
    expect(host.querySelectorAll('.ph-cell')).toHaveLength(2)
    expect(button(host, 'Compare')).toBeTruthy()
    expect(host.textContent).toContain('0.6 MB of 500 MB used.')
    // another pose has none of its own
    act(() => button(host, 'Side view').click())
    expect(host.querySelectorAll('.ph-cell')).toHaveLength(0)
  })

  it('a picture is fetched through the session by its id, never linked to directly', async () => {
    const { apiBlob } = await import('../lib/api.js')
    apiBlob.mockClear()
    signedIn({ rev: 1, items: [bodyPhoto('b', today)], used: 1, quota: 10 })
    const host = render(<Body />)
    await act(async () => { await Promise.resolve() })
    expect(apiBlob).toHaveBeenCalledWith('/api/photo?id=' + 'b'.repeat(24) + '&thumb=1')
    expect(host.querySelector('img[src*="api/photo"]')).toBeNull()
  })

  it('each meal gets a camera button, and its photos sit above its rows', () => {
    signedIn({ rev: 1, items: [mealPhoto], used: 1, quota: 10 })
    logFood(chicken, 200, { d: today, m: 1 })
    const host = render(<Nutrition />)
    expect(host.querySelectorAll('[aria-label^="Photo of the meal"]')).toHaveLength(4)
    expect(host.querySelectorAll('.ph-meal')).toHaveLength(1)
    expect(host.querySelectorAll('.ph-meal .ph-thumb')).toHaveLength(1)
    act(() => button(host, 'Photo of the meal: lunch').click())
    expect(useUI.getState().sheets).toHaveLength(1)
  })
})

describe('left and right on the Body screen', () => {
  it('nothing is said until a site was measured on both sides', () => {
    saveMeasurement(today, { waist: 90, upperArmLeft: 38 })
    expect(render(<Body />).textContent).not.toContain('Left and right')
  })

  it('sets the two sides against each other, and calls a difference under the tape\'s error what it is', () => {
    saveMeasurement(dayBefore(today, 30), { upperArmLeft: 37.6, upperArmRight: 38.2 })
    saveMeasurement(today, { upperArmLeft: 38, upperArmRight: 38.4, thighLeft: 58, thighRight: 59.5 })
    const host = render(<Body />)
    const rows = [...host.querySelectorAll('.bd-side')].map(r => r.textContent)
    expect(host.textContent).toContain('Left and right')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Upper arm, relaxed')
    expect(rows[0]).toContain('L 38 · R 38.4 cm')
    expect(rows[0]).toContain('Difference 0.4 cm — within the error of a tape measure.')
    expect(rows[1]).toContain('Difference 1.5 cm — the right is bigger.')
    // the chart of one arm carries the other as a second line, and says so
    expect(host.querySelector('.csec')).toBeTruthy()
    expect(host.textContent).toContain('Thin grey line: right upper arm.')
  })

  it('sides measured on different days, weeks apart, are not compared', () => {
    saveMeasurement(dayBefore(today, 40), { calfLeft: 38 })
    saveMeasurement(today, { calfRight: 38.9 })
    const host = render(<Body />)
    expect(host.querySelector('.bd-side').textContent).toContain('Measured 40 days apart')
    expect(host.textContent).not.toContain('the right is bigger')
  })
})

describe('adding a progress photo', () => {
  const open = () => {
    useStore.setState({ user: { id: 'u1' }, config: { photos: true }, photos: { rev: 1, items: [{ id: 'b'.repeat(24), kind: 'body', pose: 'front', d: dayBefore(today, 30), w: 1200, h: 1600, thumb: true }], used: 1, quota: 10 } })
    const host = render(<Body />)
    const card = [...host.querySelectorAll('.card')].find(c => c.textContent.includes('Progress photos'))
    act(() => [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add').click())
    return render(useUI.getState().sheets.at(-1).render(() => {}))
  }
  afterEach(() => { delete navigator.mediaDevices })

  it('where the browser can open a camera into the page, lining up with the last photo comes first', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(() => {}) } })
    const el = open()
    const labels = [...el.querySelectorAll('button.btn')].map(b => b.textContent.trim())
    expect(labels).toEqual(['Line up with the last photo', 'Take a photo', 'Choose from library'])
    act(() => button(el, 'Line up with the last photo').click())
    expect(useUI.getState().sheets).toHaveLength(2)
    // a pose with no photo yet has nothing to line up with — the camera still has its timer
    act(() => button(el, 'Back view').click())
    expect([...el.querySelectorAll('button.btn')].map(b => b.textContent.trim())[0]).toBe('Camera with a self-timer')
  })

  it('where it cannot (plain http, an old browser), the sheet is what it was', () => {
    const el = open()
    expect([...el.querySelectorAll('button.btn')].map(b => b.textContent.trim())).toEqual(['Take a photo', 'Choose from library'])
  })
})

