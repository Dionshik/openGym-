import { describe, it, expect, beforeEach } from 'vitest'
import { candidatesFor, draftFor, plainMatch, hasLookupConsent, MAX_CANDIDATES, MAX_TEXT } from './exercise-match.js'
import { EXIDX, BODYPARTS, registerCustom, CATALOGUE } from './exercises.js'
import { ALL_EQUIPMENT } from './equipment.js'
import { MUSCLES } from './muscles.js'
import {
  MUSCLES as SRV_MUSCLES, BODY_PARTS as SRV_BODY_PARTS, EQUIPMENT as SRV_EQUIPMENT, MAX_TEXT as SRV_MAX_TEXT,
  validateMatch, resolveMatch
} from '../../../api/coach/core/match.js'

const idOf = name => CATALOGUE.find(e => e.n === name).id
const S = (customEx = []) => ({ customEx, routines: [], workouts: [] })

beforeEach(() => registerCustom([]))

describe('the server and the app agree on the closed lists', () => {
  // The core cannot import the frontend (it runs under bare node in the api container), so it
  // keeps its own copies. A value the validator lets through that the form has no chip for
  // would be accepted there and then silently dropped here.
  it('muscles', () => expect(SRV_MUSCLES).toEqual(MUSCLES))
  // The app's catalogue adds a body part of its own on top of the dataset ("full body", from
  // the muscle-metadata overlay), so the server's list is the narrower one — which is the
  // safe direction: everything it can say has a chip.
  it('body parts', () => { for (const bp of SRV_BODY_PARTS) expect(BODYPARTS).toContain(bp) })
  it('equipment', () => { for (const eq of SRV_EQUIPMENT) expect(ALL_EQUIPMENT).toContain(eq) })
  it('the text cap', () => expect(SRV_MAX_TEXT).toBe(MAX_TEXT))
})

describe('candidatesFor', () => {
  it('offers the resolved rows first, in the order they were ranked', () => {
    const a = idOf('barbell bench press'), b = idOf('barbell incline bench press')
    const rows = candidatesFor({ said: 'zzz nothing', matches: [{ id: a, score: 1 }, { id: b, score: 0.9 }] }, S())
    expect(rows.map(e => e.id)).toEqual([a, b])
  })

  it('drops an id this build has no exercise for instead of showing a placeholder', () => {
    const a = idOf('barbell bench press')
    const rows = candidatesFor({ said: 'zzz nothing', matches: [{ id: 'gone-9999', score: 1 }, { id: a, score: 0.8 }] }, S())
    expect(rows.map(e => e.id)).toEqual([a])
  })

  it('adds what the app’s own search finds for the words as typed, without repeating a row', () => {
    const a = idOf('barbell bench press')
    const rows = candidatesFor({ said: 'barbell bench press', matches: [{ id: a, score: 1 }] }, S())
    expect(rows[0].id).toBe(a)
    expect(new Set(rows.map(e => e.id)).size).toBe(rows.length)
    expect(rows.length).toBeGreaterThan(1)          // the search added neighbours
    expect(rows.length).toBeLessThanOrEqual(MAX_CANDIDATES)
  })

  it('finds the user’s own exercise by its name even when nothing was resolved', () => {
    const mine = { id: 'cmine', n: 'Тяга к поясу в кроссовере', bp: 'back', eq: 'cable', custom: true }
    registerCustom([mine])
    const rows = candidatesFor({ said: 'тяга к поясу', matches: [] }, S([mine]))
    expect(rows.map(e => e.id)).toEqual(['cmine'])
  })

  it('does not treat a phrase that matches half the catalogue as a find', () => {
    expect(candidatesFor({ said: 'press', matches: [] }, S())).toEqual([])
  })

  it('never offers more than the cap', () => {
    const many = CATALOGUE.slice(0, 20).map(e => ({ id: e.id, score: 0.9 }))
    expect(candidatesFor({ said: '', matches: many }, S())).toHaveLength(MAX_CANDIDATES)
  })

  it('survives an item with nothing in it', () => {
    expect(candidatesFor({}, S())).toEqual([])
    expect(candidatesFor(null, S())).toEqual([])
  })
})

describe('draftFor', () => {
  it('prefills only what the form itself could have picked', () => {
    const d = draftFor({
      bp: 'chest', eq: 'cable',
      create: { name: '  жим в   кроссовере ', desc: ' Сведение рук. ', primary: ['chest', 'wings'], secondary: ['triceps', 'chest', 'deltoids'] }
    })
    expect(d).toEqual({
      n: 'Жим в кроссовере', bp: 'chest', eq: 'cable', desc: 'Сведение рук.',
      primaries: ['chest'], secondaries: ['deltoids', 'triceps']      // in the map's order, no repeat of a primary
    })
  })

  it('leaves a field empty rather than inventing a body part or equipment', () => {
    const d = draftFor({ bp: 'torso', eq: 'anvil', create: { name: 'x' } })
    expect(d.bp).toBe('')
    expect(d.eq).toBe('')
    expect(d.primaries).toEqual([])
  })

  it('gives a cardio draft no primary muscles — the form sets its own', () => {
    expect(draftFor({ bp: 'cardio', create: { name: 'run', primary: ['quadriceps'] } }).primaries).toEqual([])
  })

  it('caps what it carries', () => {
    const d = draftFor({ create: { name: 'n'.repeat(200), desc: 'd'.repeat(2000) } })
    expect(d.n).toHaveLength(60)
    expect(d.desc).toHaveLength(1000)
  })

  it('survives an item with nothing in it', () => {
    expect(draftFor({})).toEqual({ n: '', bp: '', eq: '', desc: '', primaries: [], secondaries: [] })
  })
})

describe('the whole way through: a validated answer becomes rows and a draft', () => {
  it('names an exercise in English and lands on the catalogue row', () => {
    const checked = validateMatch({
      coach_contract: 1,
      items: [{
        said: 'жим лёжа', names: ['barbell bench press', 'bench press'], bp: 'chest', eq: 'barbell',
        create: { name: 'Жим штанги лёжа', desc: 'Лёжа на скамье.', primary: ['chest'], secondary: ['triceps', 'deltoids'] }
      }]
    })
    expect(checked.ok).toBe(true)
    const [item] = resolveMatch(checked.items, S())
    expect(item.exact).toBe(true)
    const rows = candidatesFor(item, S())
    expect(rows[0].n).toBe('barbell bench press')
    expect(EXIDX[rows[0].id]).toBe(rows[0])
    expect(draftFor(item)).toMatchObject({ n: 'Жим штанги лёжа', bp: 'chest', eq: 'barbell', primaries: ['chest'] })
  })
})

describe('plainMatch', () => {
  it('splits a list the way a person writes one, and interprets nothing', () => {
    const r = plainMatch('bench press, squat;\n  lat   pulldown ,, ')
    expect(r.items.map(i => i.said)).toEqual(['bench press', 'squat', 'lat pulldown'])
    expect(r.items[0]).toMatchObject({ matches: [], exact: false, bp: null, eq: null })
    expect(r.items[0].create).toEqual({ name: 'bench press', desc: '', primary: [], secondary: [] })
  })
  it('is empty for empty text and capped at eight', () => {
    expect(plainMatch('  ').items).toEqual([])
    expect(plainMatch(Array(20).fill('a').join(',')).items).toHaveLength(8)
  })
})

describe('hasLookupConsent', () => {
  it('is true for the sheet’s own go-ahead or for the Coach’s, and false otherwise', () => {
    expect(hasLookupConsent({})).toBe(false)
    expect(hasLookupConsent({ coach: {} })).toBe(false)
    expect(hasLookupConsent({ coach: { consent: null, lookupConsent: null } })).toBe(false)
    expect(hasLookupConsent({ coach: { lookupConsent: { agreedAt: 'x', version: 1 } } })).toBe(true)
    // A go-ahead given for an older disclosure is asked for again.
    expect(hasLookupConsent({ coach: { lookupConsent: { agreedAt: 'x', version: 0 } } })).toBe(false)
    expect(hasLookupConsent({ coach: { consent: { agreedAt: 'x', version: 1 } } })).toBe(true)
  })
})
