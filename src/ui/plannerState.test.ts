import { describe, it, expect } from 'vitest'
import { defaults, hydrate, nextKey } from './plannerState'
import { encodeShare } from './share'

describe('hydrate', () => {
  it('falls back to the defaults with nothing saved and nothing shared', () => {
    expect(hydrate(null, '')).toEqual(defaults())
  })

  it('restores what was saved', () => {
    const saved = { ...defaults(), beltMk: 4, buildMode: 'whole' as const }
    expect(hydrate(JSON.stringify(saved), '')).toEqual(saved)
  })

  it('fills gaps in a saved state from the defaults', () => {
    // A state written by an older build is missing the newer fields.
    const partial = hydrate(JSON.stringify({ beltMk: 3 }), '')
    expect(partial.beltMk).toBe(3)
    expect(partial.powerShards).toBe(defaults().powerShards)
    expect(partial.nodes).toEqual(defaults().nodes)
  })

  it('lets a shared link win over the saved plan', () => {
    // Following a link is an explicit request to see that plan, not this one.
    const saved = JSON.stringify({ ...defaults(), beltMk: 6 })
    const shared = encodeShare({ beltMk: 2, minerTier: 3 })
    const state = hydrate(saved, shared)
    expect(state.beltMk).toBe(2)
    expect(state.minerTier).toBe(3)
  })

  it('ignores a corrupt saved state instead of blanking the app', () => {
    expect(hydrate('{not json', '')).toEqual(defaults())
  })

  it('ignores a tampered fragment and keeps the saved plan', () => {
    const saved = JSON.stringify({ ...defaults(), beltMk: 6 })
    expect(hydrate(saved, 'not-a-real-token').beltMk).toBe(6)
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
