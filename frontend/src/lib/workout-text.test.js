import { describe, it, expect, beforeEach } from 'vitest'
import {
  usageOf, logCandidates, initialChoice, initialChoices, convertWeight, setsLine, logMode, entryFromLog, entriesFromDraft,
  unresolved, plainLog, usualTarget, MAX_LOG_TEXT
} from './workout-text.js'
import { CATALOGUE, registerCustom } from './exercises.js'
import { MAX_LOG_TEXT as SRV_MAX_LOG_TEXT, validateLog, resolveLog } from '../../../api/coach/core/logtext.js'

const idOf = name => CATALOGUE.find(e => e.n === name).id
const BENCH = idOf('barbell bench press')
const INCLINE = idOf('barbell incline bench press')
const PULLUP = idOf('pull-up')
const PLANK = idOf('front plank with twist')
const BURPEE = idOf('burpee')
const ROPE = idOf('jump rope')
const RUN = idOf('run')
const ex = id => CATALOGUE.find(e => e.id === id)
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

  it('is sure when one of the model’s names is the row’s name, or the row is one of their own; asks otherwise', () => {
    expect(initialChoice({ names: ['barbell bench press'], matches: [{ id: BENCH, score: 1 }], exact: true }, S())).toEqual({ status: 'sure', id: BENCH })
    // A score alone is not a name: "barbell squat" scores 0.98 against four different squats.
    const squat = { names: ['barbell squat'], exact: true, matches: [{ id: idOf('barbell bench squat'), score: 0.98 }, { id: idOf('barbell front squat'), score: 0.98 }, { id: idOf('barbell full squat'), score: 0.98 }] }
    expect(initialChoice(squat, S())).toEqual({ status: 'ask', id: null })
    // The model's name is a row, but another row scores the same: still a question.
    expect(initialChoice({ names: ['barbell bench press'], matches: [{ id: BENCH, score: 1 }, { id: INCLINE, score: 1 }] }, S())).toEqual({ status: 'ask', id: null })
    expect(initialChoice({ names: ['Pull Up'], matches: [{ id: PULLUP, score: 1 }] }, S())).toEqual({ status: 'sure', id: PULLUP })
    expect(initialChoice({ matches: [{ id: INCLINE, score: 0.8 }], exact: false }, S())).toEqual({ status: 'ask', id: null })
    expect(initialChoice({ matches: [], exact: false }, S())).toEqual({ status: 'ask', id: null })
    expect(initialChoice({ matches: [{ id: 'gone-9999', score: 1 }], exact: true }, S())).toEqual({ status: 'ask', id: null })
    registerCustom([{ id: 'c1', n: 'Мой тренажёр', bp: 'back', custom: true }])
    expect(initialChoice({ matches: [{ id: 'c1', score: 1, custom: true }], exact: true }, S())).toEqual({ status: 'sure', id: 'c1' })
  })

  it('is sure of a close match the person already logs — even one ranked second — and still asks about a weak one', () => {
    const st = S({ workouts: logged([INCLINE]) })
    expect(initialChoice({ matches: [{ id: INCLINE, score: 0.85 }], exact: false }, st)).toEqual({ status: 'sure', id: INCLINE })
    expect(initialChoice({ matches: [{ id: INCLINE, score: 0.6 }], exact: false }, st)).toEqual({ status: 'ask', id: null })
    // Their own squat loses a tie on score and wins the choice.
    const mine = S({ workouts: logged([idOf('barbell full squat')]) })
    const squat = { names: ['barbell squat'], matches: [{ id: idOf('barbell bench squat'), score: 0.98 }, { id: idOf('barbell full squat'), score: 0.98 }] }
    expect(initialChoice(squat, mine)).toEqual({ status: 'sure', id: idOf('barbell full squat') })
  })
})

describe('across the lines', () => {
  it('asks on every line that would be sure of the same exercise — six ticked guesses of one row is a broken answer', () => {
    registerCustom([{ id: 'c1', n: 'Pec Dock', bp: 'chest', custom: true }])
    const stamped = { matches: [{ id: 'c1', score: 1, custom: true }], exact: true }
    const bench = { names: ['barbell bench press'], matches: [{ id: BENCH, score: 1 }], exact: true }
    expect(initialChoices([stamped, stamped, bench], S())).toEqual([
      { status: 'ask', id: null }, { status: 'ask', id: null }, { status: 'sure', id: BENCH }
    ])
    expect(initialChoices([stamped, bench], S())).toEqual([{ status: 'sure', id: 'c1' }, { status: 'sure', id: BENCH }])
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

  it('reads the mode from the rows: reps are reps even for "cardio" exercises, minutes are a hold unless it is cardio', () => {
    expect(logMode(ex(PLANK), [{ sec: 60 }])).toBe('time')
    expect(logMode(ex(PLANK), [{ reps: 10 }])).toBe('reps')
    expect(logMode(ex(PLANK), [{ min: 2 }])).toBe('time')
    expect(logMode(ex(BURPEE), [{ reps: 15 }])).toBe('reps')
    expect(logMode(ex(ROPE), [{ sec: 60 }])).toBe('time')
    expect(logMode(ex(RUN), [{ min: 30, speed: 10 }])).toBe('cardio')
    expect(logMode(ex(BENCH), [{ min: 20 }], 'cardio')).toBe('cardio')
    expect(logMode(ex(BENCH), [])).toBe(null)
  })
})

describe('the session entries', () => {
  it('fills the rows the text gave, ticked — they were done', () => {
    const e = entryFromLog(S(), ex(BENCH), [{ reps: 8, weight: 80 }, { reps: 6, weight: 85 }])
    expect(e.id).toBe(BENCH)
    expect(e.plan).toBe(null)
    expect(e.target).toMatchObject({ id: BENCH, mode: 'reps' })
    expect(e.sets).toEqual([{ w: 80, r: 8, done: true }, { w: 85, r: 6, done: true }])
  })

  it('the target is what the session was meant to be, never what was done — a missed session is not a hit', () => {
    // The routine says squat 5x5 @ 100; three sets at 105 were typed.
    const SQ = idOf('barbell full squat')
    const routine = { id: 'r1', name: 'A', ex: [{ id: SQ, sets: 5, reps: 5, weight: 100, mode: 'reps', prog: 'linear', sg: 'g1' }] }
    const e = entryFromLog(S({ routines: [routine] }), ex(SQ), Array(3).fill({ reps: 5, weight: 105 }))
    expect(e.target).toMatchObject({ sets: 5, reps: 5, weight: 100, mode: 'reps', id: SQ })
    expect(e.target.sg).toBe(undefined)
    // Not in a routine: last time's target, as a freestyle add on the workout screen.
    const last = [{ id: 'w0', d: '2026-10-01', entries: [{ id: BENCH, target: { sets: 3, reps: 8, weight: 80, mode: 'reps' }, sets: Array(3).fill({ w: 80, r: 8, done: true }) }] }]
    expect(entryFromLog(S({ workouts: last }), ex(BENCH), [{ reps: 6, weight: 85 }]).target).toMatchObject({ sets: 3, reps: 8, weight: 80 })
    expect(usualTarget(S(), BENCH)).toMatchObject({ id: BENCH, mode: 'reps' })
  })

  it('reps typed for an exercise the catalogue files as cardio stay reps; cardio carries its id and mode', () => {
    const b = entryFromLog(S(), ex(BURPEE), Array(3).fill({ reps: 15 }))
    expect(b.target.mode).toBe('reps')
    expect(b.sets).toEqual(Array(3).fill({ w: 0, r: 15, done: true }))
    const run = entryFromLog(S(), ex(RUN), [{ min: 30, speed: 10 }])
    expect(run.target).toMatchObject({ id: RUN, mode: 'cardio' })
    expect(run.sets).toEqual([{ min: 30, speed: 10, done: true }])
  })

  it('a hold given in minutes is logged in seconds, not as cardio', () => {
    const e = entryFromLog(S(), ex(PLANK), [{ min: 2 }, { min: 1.5 }])
    expect(e.target.mode).toBe('time')
    expect(e.sets).toEqual([{ sec: 120, w: 0, done: true }, { sec: 90, w: 0, done: true }])
  })

  it('keeps a warm-up a warm-up, and converts a weight typed in pounds for a kilogram profile', () => {
    const e = entryFromLog(S(), ex(BENCH), [{ reps: 5, weight: 95, warmup: true }, { reps: 5, weight: 225 }], { unit: 'lb' })
    expect(e.sets).toEqual([{ w: 43, r: 5, done: true, phase: 'warmup', warmup: true }, { w: 102, r: 5, done: true }])
  })

  it('logs bodyweight reps without a load, and a hold in seconds', () => {
    expect(entryFromLog(S(), CATALOGUE.find(x => x.id === PULLUP), [{ reps: 10 }]).sets).toEqual([{ w: 0, r: 10, done: true }])
    const plank = entryFromLog(S(), ex(PLANK), [{ sec: 60 }, { sec: 45 }])
    expect(plank.target).toMatchObject({ mode: 'time' })
    expect(plank.sets).toEqual([{ sec: 60, w: 0, done: true }, { sec: 45, w: 0, done: true }])
  })

  it('an exercise named without numbers gets last time’s rows, unticked — in the way they last logged it', () => {
    const st = S({ workouts: logged([BENCH]) })
    const e = entryFromLog(st, ex(BENCH), [])
    expect(e.sets.length).toBe(1)
    expect(e.sets.every(s => s.done === false && s.w === 60 && s.r === 8)).toBe(true)
    // A plank they time comes back timed, not as 3 × 10 reps.
    const timed = [{ id: 'w0', d: '2026-10-01', entries: [{ id: PLANK, target: { sets: 2, sec: 60, mode: 'time' }, sets: Array(2).fill({ sec: 60, w: 0, done: true }) }] }]
    const p = entryFromLog(S({ workouts: timed }), ex(PLANK), [])
    expect(p.target.mode).toBe('time')
    expect(p.sets).toEqual(Array(2).fill({ sec: 60, w: 0, done: false }))
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
      when: { weekday: 'monday' },
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

describe('the demo reads the day and the sets with the server’s own patterns', () => {
  it('a day on the first line, the sets on each exercise line', () => {
    const r = plainLog('вчера\nжим лёжа 80x8, 85x6\nпланка 3 по 60 с', '2026-10-22')
    expect(r.date).toBe('2026-10-21')
    expect(r.items.map(i => i.said)).toEqual(['жим лёжа', 'планка'])
    expect(r.items[0].sets).toEqual([{ reps: 8, weight: 80 }, { reps: 6, weight: 85 }])
    expect(r.items[1].sets).toEqual(Array(3).fill({ sec: 60 }))
  })
})

describe('the demo checks its rows like the server', () => {
  it('a distance becomes a speed, and a number no set can have is dropped', () => {
    const r = plainLog('бег 30 мин 5 км\nжим 3x8 8000', '2026-10-22')
    expect(r.items[0].sets).toEqual([{ min: 30, speed: 10 }])
    expect(r.items[1].sets).toEqual(Array(3).fill({ reps: 8 }))
    expect(plainLog('bench 135 lbs 3x5').unit).toBe('lb')
  })
})
