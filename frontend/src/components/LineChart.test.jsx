// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import LineChart from './LineChart.jsx'
import { fmtDate, isoOf } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const point = (year, month, day, y) => ({
  d: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  t: new Date(year, month - 1, day, 12).getTime(),
  y
})

const firstPoints = [
  { t: Date.UTC(2026, 0, 1), y: 80, d: '2026-01-01' },
  { t: Date.UTC(2026, 0, 15), y: 82, d: '2026-01-15' },
]
const nextPoints = [
  { t: Date.UTC(2026, 1, 1), y: 78, d: '2026-02-01' },
  { t: Date.UTC(2026, 1, 15), y: 79, d: '2026-02-15' },
]

function renderChart(points) {
  act(() => root.render(<LineChart points={points} axes={false} unit="kg" />))
}

function hoverAt(clientX) {
  act(() => {
    container.querySelector('.chart-i').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX }))
  })
  return container.querySelector('.ctip').textContent
}

describe('LineChart hover date', () => {
  it('keeps same-year points in the compact format', () => {
    const first = point(2026, 1, 15, 70)
    renderChart([first, point(2026, 2, 15, 71)])

    expect(hoverAt(0)).toBe(`${fmtDate(first.d, true)} · 70 kg`)
  })

  it('includes the calendar year at a short cross-year boundary', () => {
    const first = point(2025, 11, 30, 70)
    const last = point(2026, 2, 1, 71)
    renderChart([first, last])

    expect(hoverAt(0)).toBe(`${fmtDate(first.d, true, true)} · 70 kg`)
    expect(hoverAt(340)).toBe(`${fmtDate(last.d, true, true)} · 71 kg`)
  })

  it('keeps a single point compact', () => {
    const only = point(2026, 7, 4, 70)
    renderChart([only])

    expect(hoverAt(170)).toBe(`${fmtDate(only.d, true)} · 70 kg`)
  })

  it('uses timestamp-only points when deciding whether to show the year', () => {
    const first = point(2025, 12, 31, 70)
    const last = point(2026, 1, 1, 71)
    const timestampOnly = [{ t: first.t, y: first.y }, { t: last.t, y: last.y }]
    renderChart(timestampOnly)

    const lastIso = isoOf(new Date(last.t))
    expect(hoverAt(340)).toBe(`${fmtDate(lastIso, true, true)} · 71 kg`)
  })
})

describe('LineChart forecast', () => {
  const pts = [point(2026, 8, 1, 38), point(2026, 9, 1, 38.5), point(2026, 10, 1, 39)]
  const ahead = [
    { t: pts[2].t, y: 39, lo: 38.2, hi: 39.8 },
    { t: new Date(2026, 10, 1, 12).getTime(), y: 39.5, lo: 38.4, hi: 40.6 },
    { t: new Date(2026, 11, 1, 12).getTime(), y: 40, lo: 38.6, hi: 41.4 }
  ]
  const xs = el => el.getAttribute('points').split(' ').map(p => +p.split(',')[0])
  const draw = forecast => act(() => root.render(<LineChart points={pts} axes={false} unit="cm" forecast={forecast} />))

  it('without one the chart is drawn exactly as before', () => {
    renderChart(pts)
    const plain = container.innerHTML
    draw(null)
    expect(container.querySelector('.cfc')).toBeNull()
    draw([])
    expect(container.querySelector('.cfc')).toBeNull()
    act(() => root.render(<LineChart points={pts} axes={false} unit="kg" />))
    expect(container.innerHTML).toBe(plain)
  })

  it('draws a band and a dashed line past the last point, and makes room for them', () => {
    draw(null)
    const lineBefore = xs(container.querySelector('svg > polyline'))
    draw(ahead)
    const g = container.querySelector('.cfc')
    expect(g.querySelector('polygon').getAttribute('points').split(' ')).toHaveLength(6)
    expect(g.querySelector('polyline').getAttribute('stroke-dasharray')).toBeTruthy()
    const lineAfter = xs(container.querySelector('svg > polyline'))
    // The measured curve no longer reaches the right edge: the forecast takes that space.
    expect(lineAfter.at(-1)).toBeLessThan(lineBefore.at(-1))
    expect(xs(g.querySelector('polyline'))[0]).toBeCloseTo(lineAfter.at(-1), 1)
    expect(xs(g.querySelector('polyline')).at(-1)).toBeCloseTo(lineBefore.at(-1), 1)
  })

  it('the tooltip still reports measured points only', () => {
    draw(ahead)
    expect(hoverAt(340)).toBe(`${fmtDate(pts[2].d, true)} · 39 cm`)
  })

  it('ignores a forecast that starts before the last point or has holes in it', () => {
    draw([{ t: pts[0].t, y: 38, lo: 37, hi: 39 }, { t: pts[1].t, y: 38.5, lo: 37, hi: 40 }])
    expect(container.querySelector('.cfc')).toBeNull()
    draw([{ t: ahead[0].t, y: 39 }, { t: ahead[1].t, y: NaN, lo: 1, hi: 2 }])
    expect(container.querySelector('.cfc')).toBeNull()
  })
})

describe('LineChart second series', () => {
  const left = [point(2026, 8, 1, 38), point(2026, 9, 1, 38.4), point(2026, 10, 1, 38.8)]
  const right = [point(2026, 7, 1, 39.6), point(2026, 9, 1, 39.9), point(2026, 10, 15, 40.4)]
  const xs = el => el.getAttribute('points').split(' ').map(p => +p.split(',')[0])
  const ys = el => el.getAttribute('points').split(' ').map(p => +p.split(',')[1])
  const draw = second => act(() => root.render(<LineChart points={left} axes={false} unit="cm" second={second} />))

  it('without one, or with a single point, the chart is drawn exactly as before', () => {
    act(() => root.render(<LineChart points={left} axes={false} unit="cm" />))
    const plain = container.innerHTML
    for (const s of [null, [], [right[0]], [{ t: NaN, y: 1 }, { t: 2, y: NaN }]]) {
      draw(s)
      expect(container.querySelector('.csec'), JSON.stringify(s)).toBeNull()
      expect(container.innerHTML).toBe(plain)
    }
  })

  it('draws the other series on the same axes, which stretch to hold both in time and in value', () => {
    draw(null)
    const alone = container.querySelector('svg > polyline:not(.csec)')
    const aloneX = xs(alone), aloneY = ys(alone)
    draw(right)
    const main = container.querySelector('svg > polyline:not(.csec)'), sec = container.querySelector('.csec')
    expect(sec.getAttribute('points').split(' ')).toHaveLength(3)
    // the other side starts earlier and ends later: the main curve no longer spans the full width
    expect(xs(main)[0]).toBeGreaterThan(aloneX[0])
    expect(xs(main).at(-1)).toBeLessThan(aloneX.at(-1))
    expect(xs(sec)[0]).toBeCloseTo(aloneX[0], 1)
    expect(xs(sec).at(-1)).toBeCloseTo(aloneX.at(-1), 1)
    // and it is the higher one: drawn above, with the main curve pushed down the scale
    expect(Math.max(...ys(sec))).toBeLessThan(Math.min(...ys(main)))
    expect(ys(main)[0]).toBeGreaterThanOrEqual(aloneY[0])
  })

  it('the tooltip stays with the main series', () => {
    draw(right)
    expect(hoverAt(340)).toBe(`${fmtDate(left[2].d, true)} · 38.8 cm`)
  })
})

describe('LineChart hover state', () => {
  it('clears the tooltip and hover markers when points are replaced, then allows hovering again', () => {
    renderChart(firstPoints)
    hoverAt(170)

    expect(container.querySelector('.ctip')).toBeTruthy()
    expect(container.querySelector('.cvl')).toBeTruthy()
    expect(container.querySelector('.chl')).toBeTruthy()

    renderChart(nextPoints)

    expect(container.querySelector('.ctip')).toBeNull()
    expect(container.querySelector('.cvl')).toBeNull()
    expect(container.querySelector('.chl')).toBeNull()

    hoverAt(170)
    expect(container.querySelector('.ctip')).toBeTruthy()
    expect(container.querySelector('.cvl')).toBeTruthy()
  })
})
