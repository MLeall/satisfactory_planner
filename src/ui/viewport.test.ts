import { describe, it, expect } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitView,
  panBy,
  toSvg,
  viewBox,
  zoomAt,
  type View,
} from './viewport'

// The viewport shows a window of SVG user space sized (boxW/zoom, boxH/zoom)
// with its top-left corner at (view.x, view.y). zoom = 1 means one SVG unit
// per CSS pixel.

describe('viewBox', () => {
  it('spans the box divided by the zoom', () => {
    expect(viewBox({ zoom: 1, x: 0, y: 0 }, 800, 600)).toBe('0 0 800 600')
    expect(viewBox({ zoom: 2, x: 10, y: 20 }, 800, 600)).toBe('10 20 400 300')
    expect(viewBox({ zoom: 0.5, x: 0, y: 0 }, 800, 600)).toBe('0 0 1600 1200')
  })
})

describe('toSvg', () => {
  it('maps a point in the box to SVG user space', () => {
    expect(toSvg({ zoom: 2, x: 100, y: 50 }, 40, 20)).toEqual({ x: 120, y: 60 })
  })
})

describe('zoomAt', () => {
  const view: View = { zoom: 1, x: 0, y: 0 }

  it('holds the point under the cursor still', () => {
    const before = toSvg(view, 300, 200)
    const after = zoomAt(view, 2, 300, 200)
    expect(toSvg(after, 300, 200)).toEqual(before)
    expect(after.zoom).toBe(2)
  })

  it('holds it still when zooming out too', () => {
    const start: View = { zoom: 3, x: 120, y: 90 }
    const before = toSvg(start, 250, 110)
    const after = zoomAt(start, 0.5, 250, 110)
    expect(toSvg(after, 250, 110).x).toBeCloseTo(before.x)
    expect(toSvg(after, 250, 110).y).toBeCloseTo(before.y)
  })

  it('clamps to the zoom limits without drifting', () => {
    const zoomedIn = zoomAt({ zoom: MAX_ZOOM, x: 0, y: 0 }, 4, 100, 100)
    expect(zoomedIn.zoom).toBe(MAX_ZOOM)
    // Clamped to no change, so the view must not move at all.
    expect(zoomedIn.x).toBe(0)
    expect(zoomedIn.y).toBe(0)
    expect(zoomAt({ zoom: MIN_ZOOM, x: 0, y: 0 }, 0.1, 0, 0).zoom).toBe(MIN_ZOOM)
  })
})

describe('panBy', () => {
  it('moves the window against the drag, scaled by the zoom', () => {
    // Dragging the canvas 100px right shows content further left.
    expect(panBy({ zoom: 2, x: 100, y: 100 }, 100, 40)).toEqual({
      zoom: 2,
      x: 50,
      y: 80,
    })
  })

  it('leaves the zoom alone', () => {
    expect(panBy({ zoom: 0.75, x: 0, y: 0 }, 10, 10).zoom).toBe(0.75)
  })
})

describe('fitView', () => {
  it('scales the drawing down to fit and centres it', () => {
    const v = fitView(1600, 600, 800, 600)
    expect(v.zoom).toBe(0.5) // width is the binding dimension
    // Horizontally exact, vertically centred over the leftover space.
    expect(v.x).toBe(0)
    expect(v.y).toBe(-300)
  })

  it('never enlarges past 1:1, so small plans are not blown up', () => {
    expect(fitView(100, 100, 800, 600).zoom).toBe(1)
  })

  it('stays within the zoom limits for an enormous drawing', () => {
    expect(fitView(100000, 100000, 800, 600).zoom).toBe(MIN_ZOOM)
  })

  it('survives a container that has not been measured yet', () => {
    const v = fitView(800, 600, 0, 0)
    expect(Number.isFinite(v.zoom)).toBe(true)
    expect(v.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
  })
})
