import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'
import { encodeShare } from './ui/share'

// Render smoke test for the console wiring. localStorage is absent here, so
// loadState falls back to the defaults: one iron node, one Iron Plate output.
describe('App', () => {
  const html = renderToStaticMarkup(<App />)

  it('renders without throwing', () => {
    expect(html).toContain('FICSIT')
  })

  it('shows a max hint above every output rate field', () => {
    expect(html.match(/class="rate-hint"/g)).toHaveLength(1)
    // 60 ore -> 60 ingots -> 40 plates, the same max the engine reports.
    expect(html).toContain('MAX 40/min')
  })

  it('offers the build mode toggle instead of a sink checkbox', () => {
    expect(html).toContain('Whole machines')
    expect(html).not.toContain('Smart Splitter')
  })
})

describe('App opened from a shared link', () => {
  const stub = (hash: string) => {
    vi.stubGlobal('location', { hash, pathname: '/', search: '', href: 'http://x/' })
    // Saved state must lose to the link: following it asks for that plan.
    vi.stubGlobal('localStorage', {
      getItem: () =>
        JSON.stringify({
          outputs: [{ key: 1, item: 'Desc_IronRod_C', rate: '' }],
        }),
      setItem: () => {},
      removeItem: () => {},
    })
  }

  it('rebuilds the shared plan instead of the saved one', () => {
    stub(
      '#' +
        encodeShare({
          nodes: [
            { key: 1, resource: 'Desc_OreCopper_C', purity: 'pure', count: 2 },
          ],
          outputs: [{ key: 1, item: 'Desc_Wire_C', rate: '' }],
        }),
    )
    try {
      const out = renderToStaticMarkup(<App />)
      expect(out).toContain('Wire output')
      expect(out).not.toContain('Iron Rod output')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('falls back to the saved plan when the fragment is junk', () => {
    stub('#not-a-real-token!!')
    try {
      expect(renderToStaticMarkup(<App />)).toContain('Iron Rod output')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('App with stale persisted state', () => {
  // Regression: a saved plan whose alternate recipe (Iron Alloy Ingot, needs
  // copper) or output item no longer fits the saved nodes used to render the
  // error panel until the user re-picked the recipe by hand. The console must
  // reconcile and draw a schematic on the very first paint instead.
  const stale = {
    nodes: [{ key: 1, resource: 'Desc_OreIron_C', purity: 'normal', count: 1 }],
    outputs: [{ key: 1, item: 'Desc_CopperIngot_C', rate: '' }],
    selection: { Desc_IronIngot_C: 'Recipe_Alternate_IngotIron_C' },
  }

  it('recovers instead of showing the error panel', () => {
    const store = new Map([['ficsit-planner-v2', JSON.stringify(stale)]])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    try {
      const out = renderToStaticMarkup(<App />)
      expect(out).not.toContain('Cannot plan this chain')
      expect(out).toContain('<svg')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
