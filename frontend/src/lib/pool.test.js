import { describe, it, expect, beforeEach } from 'vitest'
import { poolAvailable, suggestBlocker, toSuggestion, suggestionOf, splitModPool, poolErrorText, POOL_ERRORS } from './pool.js'
import { EXIDX, CATALOGUE, registerCustom, registerPool, allExercises, exOr, searchExercises } from './exercises.js'
import { cleanExercise } from '../../../api/pool.js'
import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'

const mine = (over = {}) => ({ id: 'cmine', n: 'Ring reverse nordic', bp: 'upper legs', eq: 'body weight', tg: 'quadriceps', primaries: ['quadriceps'], secondaries: ['abs'], muscleGroups: ['quadriceps', 'abs'], sm: ['abs'], desc: 'Lean back.', custom: true, ...over })
const shared = (over = {}) => ({ id: 'cshared', n: 'Sled pull-through', bp: 'upper legs', eq: 'weighted', tg: 'gluteal', primaries: ['gluteal'], secondaries: [], muscleGroups: ['gluteal'], sm: [], desc: '', ...over })

beforeEach(() => { registerCustom([]); registerPool([]) })

describe('poolAvailable', () => {
  it('needs a signed-in profile on a server that has a pool', () => {
    expect(poolAvailable({ pool: true }, { id: 'u' })).toBe(true)
    expect(poolAvailable({ pool: true }, null)).toBe(false)          // a guest has no server
    expect(poolAvailable({}, { id: 'u' })).toBe(false)               // an older API
    expect(poolAvailable(null, { id: 'u' })).toBe(false)             // config not loaded (offline boot)
  })
})

describe('suggestBlocker', () => {
  it('lets a complete custom exercise through', () => expect(suggestBlocker(mine())).toBe(null))
  it('names what is missing', () => {
    expect(suggestBlocker(CATALOGUE[0])).toBe('not-custom')
    expect(suggestBlocker(mine({ n: '  ' }))).toBe('name')
    expect(suggestBlocker(mine({ bp: '' }))).toBe('bp')
    expect(suggestBlocker(mine({ eq: 'custom' }))).toBe('eq')        // an import nobody gave equipment to
    expect(suggestBlocker(null)).toBe('not-custom')
  })
  it('agrees with the server about what is complete', () => {
    // Whatever this side lets through, the server’s sanitiser must accept — otherwise the
    // button is offered and then fails.
    for (const ex of [mine(), mine({ bp: 'full body' }), mine({ bp: 'cardio', eq: 'stationary bike', primaries: ['cardiovascular system'], tg: 'cardiovascular system' })]) {
      expect(suggestBlocker(ex)).toBe(null)
      expect(cleanExercise(toSuggestion(ex)).ok, ex.bp).toBe(true)
    }
    for (const ex of [mine({ eq: 'custom' }), mine({ bp: 'torso' }), mine({ n: '' })]) {
      expect(suggestBlocker(ex)).not.toBe(null)
      expect(cleanExercise(toSuggestion(ex)).ok).toBe(false)
    }
  })
})

describe('toSuggestion', () => {
  it('sends the exercise and nothing that rides on it', () => {
    const s = toSuggestion(mine({ custom: true, missing: false, st: ['x'], weird: 1 }))
    expect(Object.keys(s).sort()).toEqual(['bp', 'desc', 'eq', 'id', 'muscleGroups', 'n', 'primaries', 'secondaries', 'sm', 'tg'])
  })
})

describe('suggestionOf', () => {
  it('finds this profile’s suggestion by exercise id', () => {
    const pool = { mine: [{ id: 'a', status: 'pending' }, { id: 'b', status: 'rejected', note: 'dup' }] }
    expect(suggestionOf(pool, 'b')).toEqual({ id: 'b', status: 'rejected', note: 'dup' })
    expect(suggestionOf(pool, 'zz')).toBe(null)
    expect(suggestionOf(null, 'a')).toBe(null)
  })
})

describe('the pool in the exercise registry', () => {
  it('resolves by id, is listed between customs and the catalogue, and is flagged shared — not custom', () => {
    registerPool([shared()])
    expect(EXIDX.cshared).toMatchObject({ n: 'Sled pull-through', pool: true })
    expect(EXIDX.cshared.custom).toBeUndefined()                     // no Edit / Delete buttons
    const all = allExercises({ customEx: [mine()] })
    expect(all.slice(0, 2).map(e => e.id)).toEqual(['cmine', 'cshared'])
    expect(all).toHaveLength(CATALOGUE.length + 2)
    expect(searchExercises(all, 'sled pull').map(e => e.id)).toContain('cshared')
  })

  it('a retired row still resolves but is no longer offered', () => {
    registerPool([shared({ retired: true })])
    expect(EXIDX.cshared.n).toBe('Sled pull-through')
    expect(exOr('cshared').missing).toBeUndefined()
    expect(allExercises({ customEx: [] }).some(e => e.id === 'cshared')).toBe(false)
  })

  it('the suggester sees their own copy, once — and the pool row takes over if they delete it', () => {
    const own = mine({ id: 'cshared', n: 'My name for it' })
    registerCustom([own])
    registerPool([shared()])
    expect(EXIDX.cshared).toBe(own)
    expect(allExercises({ customEx: [own] }).filter(e => e.id === 'cshared')).toHaveLength(1)
    registerCustom([])                                              // they deleted their copy
    expect(EXIDX.cshared).toMatchObject({ n: 'Sled pull-through', pool: true })
    expect(allExercises({ customEx: [] }).filter(e => e.id === 'cshared')).toHaveLength(1)
  })

  it('never replaces a built-in exercise, and leaves the registry clean when it goes away', () => {
    const builtIn = CATALOGUE[0]
    registerPool([shared({ id: builtIn.id, n: 'Impostor' })])
    expect(EXIDX[builtIn.id]).toBe(builtIn)
    expect(allExercises({ customEx: [] }).some(e => e.n === 'Impostor')).toBe(false)
    registerPool([shared()])
    registerPool([])
    expect(EXIDX.cshared).toBeUndefined()
    expect(EXIDX[builtIn.id]).toBe(builtIn)
  })

  it('a custom exercise can still override a built-in one, pool or no pool', () => {
    const builtIn = CATALOGUE[0]
    registerPool([shared()])
    registerCustom([mine({ id: builtIn.id, n: 'Mine instead' })])
    expect(EXIDX[builtIn.id].n).toBe('Mine instead')
    registerCustom([])
    expect(EXIDX[builtIn.id]).toBe(builtIn)
  })

  it('ignores rows that are not exercises', () => {
    registerPool([null, { n: 'no id' }, shared()])
    expect(allExercises({ customEx: [] }).filter(e => e.pool)).toHaveLength(1)
  })
})

describe('a plan file that uses a shared exercise', () => {
  const routine = id => ({ id: 'r1', name: 'Day', emoji: 'dumbbell', ex: [{ id, sets: 3, reps: 8, mode: 'reps' }] })

  it('carries the exercise with it, so the file stands on its own on another server', () => {
    registerPool([shared()])
    const bundle = buildPlanBundle({ unit: 'kg', routines: [routine('cshared')], week: {}, customEx: [] }, 'Mine')
    expect(bundle.customEx).toHaveLength(1)
    expect(bundle.customEx[0]).toMatchObject({ id: 'cshared', n: 'Sled pull-through', bp: 'upper legs', eq: 'weighted' })
    expect(bundle.customEx[0].pool).toBeUndefined()               // a flag of this server, not of the exercise
    // Somewhere the pool does not have it, the file still imports with the exercise intact.
    registerPool([])
    const s = { unit: 'kg', routines: [], week: {}, customEx: [] }
    mergePlan(s, parsePlan(JSON.stringify(bundle)))
    expect(s.customEx.map(c => c.n)).toEqual(['Sled pull-through'])
    expect(s.customEx[0].custom).toBe(true)
    expect(s.routines[0].ex[0].id).toBe(s.customEx[0].id)
  })

  it('imported where the pool already has it, uses the shared one instead of minting a private copy', () => {
    registerPool([shared()])
    const bundle = buildPlanBundle({ unit: 'kg', routines: [routine('cshared')], week: {}, customEx: [] }, 'Mine')
    const s = { unit: 'kg', routines: [], week: {}, customEx: [] }
    mergePlan(s, parsePlan(JSON.stringify(bundle)))
    expect(s.customEx).toEqual([])
    expect(s.routines[0].ex[0].id).toBe('cshared')
  })

  it('does not send the suggester’s own copy twice', () => {
    const own = mine({ id: 'cshared', n: 'My name for it' })
    registerCustom([own])
    registerPool([shared()])
    const bundle = buildPlanBundle({ unit: 'kg', routines: [routine('cshared')], week: {}, customEx: [own] }, 'Mine')
    expect(bundle.customEx.map(c => c.n)).toEqual(['My name for it'])
  })
})

describe('splitModPool', () => {
  it('queues the waiting ones oldest first and the rest newest first', () => {
    const r = splitModPool([
      { id: 'a', status: 'pending', at: 30 }, { id: 'b', status: 'pending', at: 10 },
      { id: 'c', status: 'approved', reviewedAt: 5 }, { id: 'd', status: 'retired', reviewedAt: 9 },
      { id: 'e', status: 'rejected', reviewedAt: 1 }
    ])
    expect(r.pending.map(x => x.id)).toEqual(['b', 'a'])
    expect(r.shared.map(x => x.id)).toEqual(['d', 'c'])
    expect(r.declined.map(x => x.id)).toEqual(['e'])
    expect(splitModPool(null)).toEqual({ pending: [], shared: [], declined: [] })
  })
})

describe('poolErrorText', () => {
  it('words the server’s refusal by its code, and a dead connection as one', () => {
    expect(poolErrorText({ status: 409, data: { code: 'name' } })).toBe(POOL_ERRORS.name)
    expect(poolErrorText({ status: 500, data: {} })).toMatch(/did not work/)
    expect(poolErrorText(new Error('fetch failed'))).toMatch(/No connection/)
  })
})
