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

describe('App with an imported input', () => {
  it('plans around the import instead of building it', () => {
    vi.stubGlobal('location', {
      hash:
        '#' +
        encodeShare({
          nodes: [
            { key: 1, resource: 'Desc_OreIron_C', purity: 'pure', count: 2 },
          ],
          imports: [{ key: 2, item: 'Desc_IronIngot_C', rate: '120' }],
          outputs: [{ key: 3, item: 'Desc_IronPlate_C', rate: '' }],
        }),
      pathname: '/',
      search: '',
      href: 'http://x/',
    })
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    const html = renderToStaticMarkup(<App />)

    // Two pure nodes on a Mk.1 belt yield 120 ore -> 120 ingots, and 120 more
    // arrive on the belt: 240 ingots -> 160 plates.
    expect(html).toContain('MAX 160/min')
    expect(html).toContain('Belted in from elsewhere')
    expect(html).toContain('<strong>120/min Iron Ingot</strong>')
    // The smelters stay, sized to just the half the import does not cover.
    expect(html).toContain('120/min Iron Ingot</td>')
  })
})

describe('App with several factories', () => {
  it('plans the open one off what the other one produces', () => {
    vi.stubGlobal('location', {
      hash:
        '#' +
        encodeShare({
          activeId: 'f2',
          factories: [
            {
              id: 'f1',
              name: 'Smelting',
              plan: {
                nodes: [
                  {
                    key: 1,
                    resource: 'Desc_OreIron_C',
                    purity: 'normal',
                    count: 1,
                  },
                ],
                outputs: [{ key: 1, item: 'Desc_IronIngot_C', rate: '' }],
              },
            },
            {
              id: 'f2',
              name: 'Plates',
              plan: {
                nodes: [],
                imports: [
                  { key: 1, item: 'Desc_IronIngot_C', rate: '', from: 'f1' },
                ],
                outputs: [{ key: 2, item: 'Desc_IronPlate_C', rate: '' }],
              },
            },
          ],
        }),
      pathname: '/',
      search: '',
      href: 'http://x/',
    })
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    const html = renderToStaticMarkup(<App />)

    // Smelting makes 60 ingots off one node; Plates buys all of them and turns
    // them into 40 plates, with no miner of its own.
    expect(html).toContain('MAX 40/min')
    expect(html).toContain('<strong>60/min Iron Ingot</strong>')
    expect(html).not.toContain('Miner Mk.1')
    // The rate is the source's output, and not editable here.
    expect(html).toContain('From Smelting')
    expect(html).toContain('disabled=""')
  })
})
