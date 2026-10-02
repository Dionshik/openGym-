import { describe, it, expect } from 'vitest'
import { safeRoute, isRepeat } from './deeplink.js'

describe('where a tapped notification may go', () => {
  it('the sections a notification can point at', () => {
    expect(safeRoute('#/nutrition')).toBe('/nutrition')
    expect(safeRoute('#/body')).toBe('/body')
    expect(safeRoute('#/body?do=weigh')).toBe('/body?do=weigh')
    expect(safeRoute('#/body?do=measure')).toBe('/body?do=measure')
    expect(safeRoute('#/body?do=photo')).toBe('/body?do=photo')
    expect(safeRoute('#/coach')).toBe('/coach')
  })
  it('an action it does not know, or one on another screen, is dropped and the screen still opens', () => {
    expect(safeRoute('#/body?do=delete')).toBe('/body')
    expect(safeRoute('#/nutrition?do=weigh')).toBe('/nutrition')
    expect(safeRoute('#/body?do=weigh&x=1')).toBe('/body')
  })
  it('anything that is not one of the app\'s own addresses opens nothing', () => {
    for (const bad of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', '/nutrition', '#nutrition', '#/admin', '#/settings', '#/nutrition/../admin',
      '#/' + 'a'.repeat(200), '', null, undefined, 7, {}]) {
      expect(safeRoute(bad), String(bad)).toBe(null)
    }
  })
})

describe('the copy of a tap the service worker keeps', () => {
  it('is dropped when the app was started at that very address', () => {
    expect(isRepeat({ type: 'opengym:navigate', url: '#/body?do=weigh', replay: true }, '#/body?do=weigh')).toBe(true)
  })
  it('is followed when the app started somewhere else — the browser ignored the address', () => {
    expect(isRepeat({ url: '#/body?do=weigh', replay: true }, '')).toBe(false)
    expect(isRepeat({ url: '#/body?do=weigh', replay: true }, '#/home')).toBe(false)
  })
  it('a tap while the app is open is never a repeat, whatever the app was started at', () => {
    expect(isRepeat({ url: '#/nutrition' }, '#/nutrition')).toBe(false)
    expect(isRepeat({ url: '#/nutrition', replay: false }, '#/nutrition')).toBe(false)
    expect(isRepeat(null, '')).toBe(false)
    expect(isRepeat({ replay: true }, undefined)).toBe(false)
  })
})

