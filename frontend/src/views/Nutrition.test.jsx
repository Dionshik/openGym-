// @vitest-environment happy-dom
// The diary's day view and the Body screen, against the real store: that what was logged is
// what is shown, that the numbers on screen are the ones the helpers compute, and that the
// entry points which depend on a server (online lookup, the AI, Apple Health, what the Coach
// may see) are absent where there is no server to back them.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.reject(Object.assign(new Error('offline'), {}))), apiBase: () => 'https://gym.example' }))
const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { dayBefore } from '../lib/nutrition.js'
import { logFood, logQuick, setTargets, saveBodyProfile, saveMeasurement } from '../nutrition-actions.js'
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
  useStore.setState({ S: clone(DEF), user: null, ready: true, config: null, health: null, coachLocal: null })
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
})
