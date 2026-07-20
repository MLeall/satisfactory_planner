import { describe, it, expect } from 'vitest'
import { moveBox, pruneLayout, type ManualLayout } from './manualLayout'

describe('pruneLayout', () => {
  const layout: ManualLayout = {
    'produce:iron': { x: 10, y: 20 },
    'extract:ore': { x: 30, y: 40 },
  }

  it('keeps boxes that still exist, so an output-only change survives', () => {
    const kept = pruneLayout(layout, new Set(['produce:iron', 'extract:ore']))
    expect(kept).toEqual(layout)
  })

  it('returns the same object when nothing was dropped', () => {
    // Identity matters: the caller feeds this straight back into state.
    const keys = new Set(['produce:iron', 'extract:ore', 'storage:iron'])
    expect(pruneLayout(layout, keys)).toBe(layout)
  })

  it('drops boxes the new chain no longer has', () => {
    expect(pruneLayout(layout, new Set(['produce:iron']))).toEqual({
      'produce:iron': { x: 10, y: 20 },
    })
  })

  it('drops everything when the chain is replaced wholesale', () => {
    expect(pruneLayout(layout, new Set(['produce:copper']))).toEqual({})
  })

  it('leaves an empty layout alone', () => {
    const empty: ManualLayout = {}
    expect(pruneLayout(empty, new Set(['a']))).toBe(empty)
  })
})

describe('moveBox', () => {
  it('records a position for a box that had none', () => {
    expect(moveBox({}, 'a', { x: 5, y: 6 }, 12, 8)).toEqual({
      a: { x: 17, y: 14 },
    })
  })

  it('accumulates from the position already recorded', () => {
    const layout: ManualLayout = { a: { x: 100, y: 100 } }
    expect(moveBox(layout, 'a', { x: 0, y: 0 }, -10, 5).a).toEqual({
      x: 90,
      y: 105,
    })
  })

  it('does not mutate the layout it was given', () => {
    const layout: ManualLayout = { a: { x: 1, y: 1 } }
    moveBox(layout, 'a', { x: 1, y: 1 }, 9, 9)
    expect(layout.a).toEqual({ x: 1, y: 1 })
  })

  it('leaves other boxes untouched', () => {
    const layout: ManualLayout = { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } }
    expect(moveBox(layout, 'a', { x: 1, y: 1 }, 4, 4).b).toEqual({ x: 2, y: 2 })
  })
})
