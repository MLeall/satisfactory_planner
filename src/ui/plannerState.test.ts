import { describe, it, expect } from 'vitest'
import { asPlan, defaults, nextKey } from './plannerState'

describe('asPlan', () => {
  it('fills what an older build never wrote from the defaults', () => {
    const partial = asPlan({ beltMk: 3 })
    expect(partial.beltMk).toBe(3)
    expect(partial.powerShards).toBe(defaults().powerShards)
    expect(partial.nodes).toEqual(defaults().nodes)
  })

  it('gives the defaults for anything that is not a plan', () => {
    expect(asPlan(null)).toEqual(defaults())
    expect(asPlan(42)).toEqual(defaults())
  })
})

describe('nextKey', () => {
  it('never reuses a key already in use', () => {
    const state = {
      ...defaults(),
      nodes: [{ key: 4, resource: 'x', purity: 'normal' as const, count: 1 }],
      outputs: [{ key: 9, item: 'y', rate: '' }],
    }
    expect(nextKey(state)).toBe(10)
  })

  it('starts at 1 with everything removed', () => {
    expect(nextKey({ ...defaults(), nodes: [], outputs: [] })).toBe(1)
  })
})
