import { describe, it, expect } from 'vitest'
import { decodeShare, encodeShare, shareUrl } from './share'

const state = {
  nodes: [{ key: 1, resource: 'Desc_OreIron_C', purity: 'pure', count: 2 }],
  outputs: [{ key: 1, item: 'Desc_IronPlate_C', rate: '40' }],
  minerTier: 2,
  selection: { Desc_IronIngot_C: 'Recipe_Alternate_PureIronIngot_C' },
  layout: { 'extract:Desc_OreIron_C': { x: 12, y: -34 } },
}

describe('encodeShare / decodeShare', () => {
  it('round-trips a plan', () => {
    expect(decodeShare(encodeShare(state))).toEqual(state)
  })

  it('produces a token safe to drop in a URL unescaped', () => {
    // Plain base64 would emit + / =, which a URL would mangle.
    expect(encodeShare(state)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('survives non-ASCII text', () => {
    const odd = { note: 'Ferro puro — 250% ✦' }
    expect(decodeShare(encodeShare(odd))).toEqual(odd)
  })

  it('returns null for anything that is not one of our tokens', () => {
    for (const bad of ['', 'not-base64!!', 'YWJj', '!!!', 'eyJh']) {
      expect(decodeShare(bad)).toBeNull()
    }
  })

  it('returns null rather than throwing on a truncated token', () => {
    const token = encodeShare(state)
    expect(decodeShare(token.slice(0, token.length - 5))).toBeNull()
  })
})

describe('shareUrl', () => {
  it('hangs the plan off the fragment, leaving the path alone', () => {
    const url = shareUrl('https://example.com/planner?x=1#old', state)
    expect(url.startsWith('https://example.com/planner?x=1#')).toBe(true)
    expect(url).toContain(encodeShare(state))
  })

  it('round-trips through the fragment it produced', () => {
    const url = shareUrl('https://example.com/', state)
    const fragment = url.slice(url.indexOf('#') + 1)
    expect(decodeShare(fragment)).toEqual(state)
  })
})
