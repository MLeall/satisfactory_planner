import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Schematic, { boxKeys, layoutSize } from './Schematic'
import Breakdown from './Breakdown'
import { loadGameData } from '../data/loader'
import { solve } from '../engine/solve'

// Render smoke tests: the schematic layouts (especially Complex, which does its
// own geometry) and the breakdown must not throw on real, branching plans.

const data = loadGameData()

function plan(targets: { item: string; rate?: number }[], sinkOverflow = false) {
  const result = solve(data, {
    minerTier: 3,
    beltMk: 5,
    pipeMk: 2,
    nodes: [
      { resource: 'Desc_OreIron_C', purity: 'pure', count: 2 },
      { resource: 'Desc_OreCopper_C', purity: 'normal', count: 1 },
    ],
    targets,
    sinkOverflow,
  })
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result.plan
}

describe('Schematic rendering', () => {
  // Reinforced Iron Plate branches (plates + screws share iron ingots).
  const branching = plan([{ item: 'Desc_IronPlateReinforced_C', rate: 10 }])

  it('renders the standard view without throwing', () => {
    const html = renderToStaticMarkup(
      <Schematic plan={branching} data={data} beltMk={5} pipeMk={2} viewMode="standard" />,
    )
    expect(html).toContain('<svg')
    expect(html).toContain('Storage Container')
  })

  it('renders the complex view with splitters/mergers without throwing', () => {
    const html = renderToStaticMarkup(
      <Schematic plan={branching} data={data} beltMk={5} pipeMk={2} viewMode="complex" />,
    )
    expect(html).toContain('<svg')
    // Junction glyphs for splitter (S) and/or merger (M) appear when flows fan out.
    expect(html).toMatch(/junction--(splitter|merger)/)
  })

  it('renders multiple outputs and a sink stage', () => {
    const multi = plan(
      [
        { item: 'Desc_IronPlate_C', rate: 20 },
        { item: 'Desc_IronPlateReinforced_C', rate: 5 },
      ],
      true,
    )
    for (const mode of ['standard', 'complex'] as const) {
      const html = renderToStaticMarkup(
        <Schematic plan={multi} data={data} beltMk={5} pipeMk={2} viewMode={mode} />,
      )
      expect(html).toContain('<svg')
    }
  })
})

describe('layoutSize', () => {
  const branching = plan([{ item: 'Desc_IronPlateReinforced_C', rate: 10 }])

  it('reports the size the rendered svg actually uses', () => {
    for (const mode of ['standard', 'complex'] as const) {
      const { width, height } = layoutSize(branching, mode)
      const html = renderToStaticMarkup(
        <Schematic plan={branching} data={data} beltMk={5} pipeMk={2} viewMode={mode} />,
      )
      expect(html).toContain(`viewBox="0 0 ${width} ${height}"`)
    }
  })

  it('makes the complex view taller, since machines are drawn one by one', () => {
    expect(layoutSize(branching, 'complex').height).toBeGreaterThan(
      layoutSize(branching, 'standard').height,
    )
  })
})

describe('manual layout', () => {
  const branching = plan([{ item: 'Desc_IronPlateReinforced_C', rate: 10 }])

  it('draws a box where the user dragged it', () => {
    const key = [...boxKeys(branching, 'standard')][0]
    const html = renderToStaticMarkup(
      <Schematic
        plan={branching}
        data={data}
        beltMk={5}
        pipeMk={2}
        viewMode="standard"
        layout={{ [key]: { x: 777, y: 888 } }}
      />,
    )
    expect(html).toContain('translate(777 888)')
  })

  it('keys standard boxes by stage and complex boxes by machine', () => {
    const standard = boxKeys(branching, 'standard')
    const complex = boxKeys(branching, 'complex')
    // Stage ids are stable across replans, which is what makes a dragged
    // position survive an output-rate change.
    expect([...standard].every((k) => !k.includes('#'))).toBe(true)
    expect([...complex].some((k) => k.includes('#'))).toBe(true)
    expect(complex.size).toBeGreaterThan(standard.size)
  })
})

describe('Breakdown rendering', () => {
  it('renders tiles, table and sink points without throwing', () => {
    const multi = plan(
      [
        { item: 'Desc_IronPlate_C', rate: 20 },
        { item: 'Desc_IronScrew_C', rate: 20 },
      ],
      true,
    )
    const html = renderToStaticMarkup(<Breakdown plan={multi} data={data} />)
    expect(html).toContain('System breakdown')
    expect(html).toContain('Machines to build')
  })
})
