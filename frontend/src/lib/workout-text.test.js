import { describe, it, expect, beforeEach } from 'vitest'
import {
  usageOf, logCandidates, initialChoice, convertWeight, setsLine, logMode, entryFromLog, entriesFromDraft,
  unresolved, plainLog, MAX_LOG_TEXT
} from './workout-text.js'
import { CATALOGUE, registerCustom } from './exercises.js'
import { MAX_LOG_TEXT as SRV_MAX_LOG_TEXT, validateLog, resolveLog } from '../../../api/coach/core/logtext.js'

const idOf = name => CATALOGUE.find(e => e.n === name).id
const BENCH = idOf('barbell bench press')
const INCLINE = idOf('barbell incline bench press')
const PULLUP = idOf('pull-up')
const PLANK = idOf('front plank with twist')
const S = (over = {}) => ({ unit: 'kg', customEx: [], routines: [], workouts: [], exWeights: {}, ...over })
const logged = ids => [{ id: 'w1', d: '2026-10-01', entries: ids.map(id => ({ id, sets: [{ w: 60, r: 8, done: true }] })) }]

beforeEach(() => registerCustom([]))

describe('the server and the app agree', () => {
  it('on how much text one request carries', () => expect(SRV_MAX_LOG_TEXT).toBe(MAX_LOG_TEXT))
})

describe('which exercise a line is', () => {
  it('counts what the person already does, from routines and logged workouts', () => {
    const u = usageOf(S({ routines: [{ ex: [{ id: BENCH }] }], workouts: logged([BENCH, PULLUP]) }))
    expect(u).toEqual({ [BENCH]: 2, [PULLUP]: 1 })
  })

  it('moves an exercise they log ahead of near-equal rows they never did', () => {
    const item = { said: 'zzz', matches: [{ id: INCLINE, score: 0.9 }, { id: BENCH, score: 0.88 }] }
    expect(logCandidates(item, S()).map(e => e.id)).toEqual([INCLINE, BENCH])
    expect(logCandidates(item, S({ workouts: logged([BENCH]) })).map(e => e.id)).toEqual([BENCH, INCLINE])
  })

  it('is sure when the name is a catalogue row or one of their own; asks otherwise', () => {
    expect(initialChoice({ matches: [{ id: BENCH, score: 1 }], exact: true }, S())).toEqual({ status: 'sure', id: BENCH })
    expect(initialChoice({ matches: [{ id: INCLINE, score: 0.8 }], exact: false }, S())).toEqual({ status: 'ask', id: null })
    expect(initialChoice({ matches: [], exact: false }, S())).toEqual({ status: 'ask', id: null })
    expect(initialChoice({ matches: [{ id: 'gone-9999', score: 1 }], exact: true }, S())).toEqual({ status: 'ask', id: null })
    registerCustom([{ id: 'c1', n: 'Мой тренажёр', bp: 'back', custom: true }])
    expect(initialChoice({ matches: [{ id: 'c1', score: 1, custom: true }], exact: true }, S())).toEqual({ status: 'sure', id: 'c1' })
  })

  it('is sure of a close match the person already logs, and still asks about a weak one', () => {
    const st = S({ workouts: logged([INCLINE]) })
    expect(initialChoice({ matches: [{ id: INCLINE, score: 0.85 }], exact: false }, st)).toEqual({ status: 'sure', id: INCLINE })
    expect(initialChoice({ matches: [{ id: INCLINE, score: 0.6 }], exact: false }, st)).toEqual({ status: 'ask', id: null })
  })
})

describe('the rows', () => {
  it('converts a weight read in the other unit to the quarter', () => {
    expect(convertWeight(100, 'kg', 'lb')).toBe(220.5)
    expect(convertWeight(225, 'lb', 'kg')).toBe(102)
    expect(convertWeight(80, 'kg', 'kg')).toBe(80)
    expect(convertWeight(0, 'lb', 'kg')).toBe(0)
  })

  it('reads as a line on the draft', () => {
    expect(setsLine([{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }, { reps: 8, weight: 80 }], 'kg')).toBe('3 × 8 · 80 kg')
    expect(setsLine([{ reps: 8, weight: 80 }, { reps: 6, weight: 85 }], 'kg')).toBe('80×8, 85×6')
    expect(setsLine([{ reps: 10 }, { reps: 10 }], 'kg')).toBe('2 × 10')
    expect(setsLine([{ sec: 60 }, { sec: 60 }], 'kg')).toBe('2 × 60 s')
    expect(setsLine([{ min: 30, speed: 10 }], 'kg')).toBe('1 × 30 min @ 10 km/h')
    expect(setsLine([{ reps: 5, weight: 40, warmup: true }, { reps: 5, weight: 100 }], 'kg')).toBe('1 × 5 · 100 kg')
    expect(setsLine([], 'kg')).toBe('')
  })

  it('logs a hold as a timed exercise and minutes as cardio, whatever the catalogue default', () => {
    const plank = CATALOGUE.find(e => e.id === PLANK)
    expect(logMode(plank, [{ sec: 60 }])).toBe('time')
    expect(logMode(plank, [{ reps: 10 }])).toBe('reps')
    expect(logMode(CATALOGUE.find(e => e.id === BENCH), [{ min: 20 }])).toBe('cardio')
  })
})

describe('the session entries', () => {
  it('fills the rows the text gave, ticked — they were done', () => {
    const e = entryFromLog(S(), CATALOGUE.find(x => x.id === BENCH), [{ reps: 8, weight: 80 }, { reps: 6, weight: 85 }])
    expect(e.id).toBe(BENCH)
    expect(e.plan).toBe(null)
    expect(e.target).toMatchObject({ sets: 2, reps: 8, weight: 80, mode: 'reps' })
    expect(e.sets).toEqual([{ w: 80, r: 8, done: true }, { w: 85, r: 6, done: true }])
  })

  it('keeps a warm-up a warm-up, and converts a weight typed in pounds for a kilogram profile', () => {
    const e = entryFromLog(S(), CATALOGUE.find(x => x.id === BENCH), [{ reps: 5, weight: 95, warmup: true }, { reps: 5, weight: 225 }], { unit: 'lb' })
    expect(e.sets).toEqual([{ w: 43, r: 5, done: true, phase: 'warmup', warmup: true }, { w: 102, r: 5, done: true }])
    expect(e.target.sets).toBe(1)
  })

  it('logs bodyweight reps without a load, and a hold in seconds', () => {
    expect(entryFromLog(S(), CATALOGUE.find(x => x.id === PULLUP), [{ reps: 10 }]).sets).toEqual([{ w: 0, r: 10, done: true }])
    const plank = entryFromLog(S(), CATALOGUE.find(x => x.id === PLANK), [{ sec: 60 }, { sec: 45 }])
    expect(plank.target).toMatchObject({ mode: 'time', sets: 2, sec: 60 })
    expect(plank.sets).toEqual([{ sec: 60, w: 0, done: true }, { sec: 45, w: 0, done: true }])
  })

  it('an exercise named without numbers gets last time’s rows, unticked, to fill in', () => {
    const st = S({ workouts: logged([BENCH]) })
    const e = entryFromLog(st, CATALOGUE.find(x => x.id === BENCH), [])
    expect(e.sets.length).toBe(3)
    expect(e.sets.every(s => s.done === false && s.w === 60 && s.r === 8)).toBe(true)
  })

  it('takes the chosen lines in the text’s order and skips the ones left out', () => {
    const items = [{ sets: [{ reps: 8, weight: 80 }] }, { sets: [{ reps: 10 }] }, { sets: [{ sec: 60 }] }]
    const choices = [{ status: 'sure', id: BENCH }, { status: 'skip', id: null }, { status: 'chosen', id: PLANK }]
    expect(entriesFromDraft(S(), items, choices).map(e => e.id)).toEqual([BENCH, PLANK])
    expect(unresolved([{ status: 'ask' }, { status: 'sure' }, { status: 'ask' }, { status: 'skip' }])).toBe(2)
  })
})

describe('end to end through the shared core', () => {
  it('a validated, resolved answer becomes a draft the app can open', () => {
    const v = validateLog({
      when: { weekday: 'monday' }, unit: 'kg',
      items: [
        { said: 'жим лёжа', names: ['barbell bench press'], create: { name: 'Жим лёжа' }, sets: [{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }] },
        { said: 'что-то непонятное', names: ['zzqx widget'], create: { name: 'Непонятное' }, sets: [{ reps: 12, weight: 20 }] }
      ]
    }, { today: '2026-10-16' })
    const r = resolveLog(v.result, S())
    expect(r.date).toBe('2026-10-12')
    const choices = r.items.map(it => initialChoice(it, S()))
    expect(choices[0]).toEqual({ status: 'sure', id: BENCH })
    expect(choices[1].status).toBe('ask')
    expect(entriesFromDraft(S(), r.items, [choices[0], { status: 'skip' }]).map(e => e.sets.length)).toEqual([2])
  })
})

describe('the demo, with no model behind it', () => {
  it('splits lines and reads "3x8 80" and "3х8 по 80" by pattern', () => {
    const r = plainLog('жим лёжа 3х8 по 80\nприсед 5x5 100, подтягивания')
    expect(r.items.map(i => i.said)).toEqual(['жим лёжа', 'присед', 'подтягивания'])
    expect(r.items[0].sets).toEqual(Array(3).fill({ reps: 8, weight: 80 }))
    expect(r.items[1].sets.length).toBe(5)
    expect(r.items[2].sets).toEqual([])
    expect(r.date).toBe(null)
  })
})
