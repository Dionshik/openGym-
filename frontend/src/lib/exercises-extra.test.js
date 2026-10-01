// The catalogue rows that are not upstream's (scripts/build-extra-exercises.mjs).
//
// They are generated, so what is pinned here is not their content but the promises the
// generator makes: nothing in them needs a word the app does not already have, nothing in them
// is a second copy of an exercise, and an id that has shipped never goes away.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { EXDB } from './exercises-data.js'
import { EXTRA } from './exercises-extra.js'
import { EXTRA_WGER } from './exercises-extra-wger.js'
import { CATALOGUE, EXIDX, BODYPARTS, searchExercises, isCardio } from './exercises.js'
import { ALL_EQUIPMENT } from './equipment.js'
import { musclesOf } from './muscles.js'
import { matchExercise } from './import-csv.js'
import { _setLangState, exerciseNameFor, exerciseNameSearchText, instrFor } from './i18n-core.js'
import { tokens } from '../../../api/coach/core/match.js'
import { LIBRARY } from '../../../api/coach/core/library.js'
import ruNames, { ALIASES } from '../exercise-names/ru.js'
import ruSteps from '../instr-extra/ru.js'

const ALL = [...EXTRA, ...EXTRA_WGER]
const uniq = f => new Set(EXDB.flatMap(e => [].concat(f(e) ?? [])))
const lock = JSON.parse(readFileSync(new URL('../../../scripts/exercise-extra-sources/ids.lock.json', import.meta.url), 'utf8'))
const attribution = JSON.parse(readFileSync(new URL('../../../licenses/wger-attribution.json', import.meta.url), 'utf8'))

describe('extra catalogue rows', () => {
  it('are appended to the upstream dataset, which itself is untouched', () => {
    expect(EXDB).toHaveLength(1324)
    expect(CATALOGUE).toHaveLength(EXDB.length + ALL.length)
    expect(CATALOGUE[EXDB.length].id).toBe(ALL[0].id)
    expect(ALL.length).toBeGreaterThan(300)
  })

  it('have ids that are unique, prefixed by source, and never an upstream or a custom id', () => {
    const ids = ALL.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const upstream = new Set(EXDB.map(e => e.id))
    for (const e of ALL) {
      expect(e.id, e.n).toMatch(/^(fe|lh|wg)_[0-9a-f]{8}$/)
      expect(upstream.has(e.id), e.id).toBe(false)
      expect(EXIDX[e.id].n).toBe(e.n)
    }
    expect(EXTRA.every(e => e.src === 'fedb' || e.src === 'longhaul')).toBe(true)
    expect(EXTRA_WGER.every(e => e.src === 'wger')).toBe(true)
  })

  it('keep every id that ever shipped', () => {
    const now = new Set(ALL.map(e => e.id))
    for (const id of Object.keys(lock)) expect(now.has(id), `${id} (${lock[id]}) was released and is gone`).toBe(true)
    for (const id of now) expect(lock[id], `${id} is not in ids.lock.json — run the generator`).toBeTruthy()
  })

  it('use only the vocabulary the upstream dataset already has', () => {
    const bp = uniq(e => e.bp), eq = uniq(e => e.eq), tg = uniq(e => e.tg), sm = uniq(e => e.sm)
    for (const e of ALL) {
      expect(bp.has(e.bp), `${e.n}: bp ${e.bp}`).toBe(true)
      expect(eq.has(e.eq), `${e.n}: eq ${e.eq}`).toBe(true)
      expect(tg.has(e.tg), `${e.n}: tg ${e.tg}`).toBe(true)
      for (const m of e.sm) expect(sm.has(m), `${e.n}: sm ${m}`).toBe(true)
      // …which is what makes these two true without touching either list
      expect(BODYPARTS).toContain(e.bp)
      expect(ALL_EQUIPMENT).toContain(e.eq)
    }
  })

  it('have a lower-case name, steps, and a muscle map (unless they are cardio)', () => {
    for (const e of ALL) {
      expect(e.n).toBe(e.n.toLowerCase())
      expect(e.n.trim().length).toBeGreaterThan(2)
      expect(Array.isArray(e.st) && e.st.length > 0, e.n).toBe(true)
      // No animation for any of them. A free-exercise-db row may name two photographs — start
      // and end position — and then names both, as paths under the instance's own image folder
      // (the files are fetched at run time and are not in this repository).
      expect(e.gif, e.n).toBeUndefined()
      if (e.img || e.img2) {
        expect(e.src, e.n).toBe('fedb')
        expect(e.img, e.n).toMatch(/^fedb\/[A-Za-z0-9_-]+\/0\.jpg$/)
        expect(e.img2, e.n).toBe(e.img.replace(/0\.jpg$/, '1.jpg'))
      }
      if (isCardio(e)) expect(e.tg).toBe('cardiovascular system')
      else expect(Object.keys(musclesOf(e)).length, e.n).toBeGreaterThan(0)
    }
  })

  it('most free-exercise-db rows have their two photographs, and the paths match what the media step downloads', () => {
    const withPhotos = ALL.filter(e => e.img)
    expect(withPhotos.length).toBeGreaterThan(250)
    // docker-compose.yml copies exercises/<dir>/0.jpg and 1.jpg to img/fedb/<dir>/ from a pinned
    // commit; the generator records the same commit. If one moves, both must.
    const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8')
    const generator = readFileSync(new URL('../../../scripts/build-extra-exercises.mjs', import.meta.url), 'utf8')
    const pinned = generator.match(/free-exercise-db', sha: '([0-9a-f]{40})'/)[1]
    expect(compose).toContain(pinned)
    expect(compose).toContain('/out/img/fedb/')
    expect(readFileSync(new URL('../../../scripts/fetch-media.sh', import.meta.url), 'utf8')).toContain(pinned)
    // Shown through the catalogue as-is in a self-hosted build (no CDN media base).
    expect(EXIDX[withPhotos[0].id].img2).toBe(withPhotos[0].img2)
  })

  it('never repeat a name — an upstream one or each other’s', () => {
    const key = n => [...tokens(n)].sort().join(' ')
    const seen = new Map(EXDB.map(e => [key(e.n), e.n]))
    for (const e of ALL) {
      const k = key(e.n)
      expect(seen.get(k), `"${e.n}" repeats "${seen.get(k)}"`).toBeUndefined()
      seen.set(k, e.n)
    }
  })

  it('fill the gaps they were brought in for', () => {
    const has = q => searchExercises(ALL, q).length > 0
    for (const q of ['face pull', 'nordic', 'snatch', 'clean and jerk', 'atlas', 'z press', 'hip thrust', 'pallof', 'hollow hold', 'foam roller']) expect(has(q), q).toBe(true)
  })

  it('are known to the Coach’s copy of the catalogue', () => {
    const server = new Map(LIBRARY.map(e => [e.id, e]))
    expect(LIBRARY).toHaveLength(CATALOGUE.length)
    for (const e of ALL) expect(server.get(e.id), `${e.id} missing — run node scripts/build-coach-assets.mjs`).toMatchObject({ n: e.n, bp: e.bp, eq: e.eq, tg: e.tg })
  })

  it('can be matched by an import, without changing what an upstream name resolves to', () => {
    expect(matchExercise('Bench Press')).toBe('0025')
    expect(matchExercise('Face Pull')).toBe('0203')               // the curated alias still wins
    const nordic = ALL.find(e => e.n === 'nordic hamstring curl')
    expect(matchExercise('Nordic Hamstring Curl')).toBe(nordic.id)
  })
})

describe('Russian pack for the extra rows', () => {
  const ids = new Set(ALL.map(e => e.id))
  it('names only extra rows, and only in Cyrillic', () => {
    expect(Object.keys(ruNames).length).toBeGreaterThan(200)
    for (const [id, name] of Object.entries(ruNames)) {
      expect(ids.has(id), id).toBe(true)
      expect(name).toMatch(/[а-яё]/i)
    }
  })
  it('has aliases and steps only for rows it names', () => {
    for (const id of Object.keys(ALIASES)) expect(ruNames[id], id).toBeTruthy()
    for (const [id, st] of Object.entries(ruSteps)) {
      expect(ruNames[id], id).toBeTruthy()
      expect(Array.isArray(st) && st.length > 0).toBe(true)
    }
  })
})

describe('Russian, as the app uses it', () => {
  const snatch = EXTRA.find(e => e.n === 'snatch')
  afterEach(() => _setLangState('en', {}, null, null))

  it('shows the Russian name with the English one beside it, and upstream rows as they were', () => {
    _setLangState('ru', {}, ruSteps, ruNames, ALIASES)
    expect(exerciseNameFor(snatch)).toBe(`${ruNames[snatch.id]} (snatch)`)
    expect(exerciseNameFor(EXDB[0])).toBe(EXDB[0].n)             // a partial pack: no entry, no change
    expect(instrFor(snatch)).toBe(ruSteps[snatch.id])
    expect(instrFor(EXDB[0])).toBe(EXDB[0].st)                   // the extra pack alone has no upstream steps
  })

  it('finds an extra row by its Russian name and by an alias, and by English as before', () => {
    _setLangState('ru', {}, null, ruNames, ALIASES)
    const word = ruNames[snatch.id].toLowerCase().split(/\s+/)[0]
    expect(searchExercises(ALL, word).map(e => e.id)).toContain(snatch.id)
    const [aliasId, alias] = Object.entries(ALIASES).find(([id, a]) => !ruNames[id].toLowerCase().includes(a.split(' ')[0].toLowerCase()))
    expect(exerciseNameSearchText(EXIDX[aliasId])).toContain(alias)
    expect(searchExercises(ALL, alias.split(' ')[0]).map(e => e.id)).toContain(aliasId)
    expect(searchExercises(ALL, 'snatch').map(e => e.id)).toContain(snatch.id)
  })

  it('aliases are a search aid only — never shown, and gone with the language', () => {
    _setLangState('ru', {}, null, ruNames, ALIASES)
    expect(exerciseNameFor(snatch)).not.toContain(ALIASES[snatch.id] || '\u0000')
    _setLangState('en', {}, null, ruNames, ALIASES)
    expect(exerciseNameSearchText(snatch)).toBe('snatch')
    // hu and pt-BR name every upstream row and none of the extra ones: those fall back to English.
    _setLangState('hu', {}, null, { [EXDB[0].id]: 'magyar név' }, null)
    expect(exerciseNameFor(snatch)).toBe('snatch')
  })
})

describe('wger attribution', () => {
  it('lists every wger row with its licence and its authors’ page', () => {
    const listed = new Map(attribution.exercises.map(x => [x.id, x]))
    expect(listed.size).toBe(EXTRA_WGER.length)
    for (const e of EXTRA_WGER) {
      const a = listed.get(e.id)
      expect(a, e.n).toBeTruthy()
      expect(a.licence).toMatch(/^CC/)
      expect(a.url).toMatch(/^https:\/\/wger\.de\//)
    }
  })
})
