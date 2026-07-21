import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Schematic, { boxKeys, complexLayout, layoutSize } from './Schematic'
import Breakdown from './Breakdown'
import { loadGameData } from '../data/loader'
import { solve } from '../engine/solve'

// Render smoke tests: the schematic layouts (especially Complex, which does its
// own geometry) and the breakdown must not throw on real, branching plans.

const data = loadGameData()

function plan(targets: { item: string; rate?: number }[], sinkOverflow = false) {
  const result = solve(data, {
    minerTier: 3,
    beltMk: 5, // ceiling; each run picks its own tier below it
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
      <Schematic plan={branching} data={data} viewMode="standard" />,
    )
    expect(html).toContain('<svg')
    expect(html).toContain('Storage Container')
  })

  it('renders the complex view with splitters/mergers without throwing', () => {
    const html = renderToStaticMarkup(
      <Schematic plan={branching} data={data} viewMode="complex" />,
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
        <Schematic plan={multi} data={data} viewMode={mode} />,
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
        <Schematic plan={branching} data={data} viewMode={mode} />,
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

describe('complex view: game-legal junctions', () => {
  // Enough smelters that a Merger tree is needed to collect them: a single
  // Merger only takes 3 belts.
  const wide = plan([{ item: 'Desc_IronPlateReinforced_C', rate: 40 }])

  const html = renderToStaticMarkup(
    <Schematic plan={wide} data={data} viewMode="complex" />,
  )

  it('never draws a junction with more than 3 branches', () => {
    const { junctions } = complexLayout(wide)
    expect(junctions.length).toBeGreaterThan(0)
    for (const j of junctions) {
      expect(j.ways).toBeGreaterThanOrEqual(2)
      expect(j.ways).toBeLessThanOrEqual(3)
    }
  })

  it('builds a tree once a stage outgrows one junction', () => {
    // More machines in a stage than a single square can wire means several
    // junctions, which is exactly what the game forces you to build.
    const stage = wide.stages.find((s) => s.machinesBuilt > 3)
    expect(stage).toBeDefined()
    expect([...html.matchAll(/junction--/g)].length).toBeGreaterThan(1)
  })

  it('labels each run with the tier that run actually needs', () => {
    // The plan was solved with a Mk.5 ceiling; low-rate runs must not claim it.
    const tiers = new Set(wide.edges.map((e) => e.tierMk))
    expect(Math.max(...tiers)).toBeLessThanOrEqual(5)
    expect(html).toContain(`Belt Mk.${Math.min(...tiers)}`)
  })
})

describe('sink placement', () => {
  it('draws the sink beside its source, not in the storage column', () => {
    const overflowing = solve(data, {
      minerTier: 3,
      beltMk: 5,
      pipeMk: 2,
      nodes: [
        { resource: 'Desc_OreIron_C', purity: 'pure', count: 2 },
        { resource: 'Desc_OreCopper_C', purity: 'normal', count: 1 },
      ],
      targets: [{ item: 'Desc_IronPlateReinforced_C', rate: 5 }],
      buildMode: 'whole',
      sinkOverflow: true,
    })
    if (!overflowing.ok) throw new Error(overflowing.errors.join('; '))
    const sinks = overflowing.plan.stages.filter((s) => s.kind === 'sink')
    expect(sinks.length).toBeGreaterThan(0)
    const storageDepth = overflowing.plan.stages.find(
      (s) => s.kind === 'storage',
    )!.depth
    // A sink drains one stage, so it belongs one column past that stage. Only
    // a sink fed by the very last machine may share the storage column.
    for (const sink of sinks) {
      const source = overflowing.plan.stages.find(
        (s) => s.id === overflowing.plan.edges.find((e) => e.to === sink.id)!.from,
      )!
      expect(sink.depth).toBe(source.depth + 1)
      expect(sink.depth).toBeLessThanOrEqual(storageDepth)
    }
  })
})

describe('complex view: what the game can actually build', () => {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5
  const touching = (links: ReturnType<typeof complexLayout>['links'], p: { x: number; y: number }) =>
    links.filter(
      (l) =>
        (near(l.x1, p.x) && near(l.y1, p.y)) ||
        (near(l.x2, p.x) && near(l.y2, p.y)),
    ).length

  // A branching plan with stages of many different machine counts.
  const plans = [
    plan([{ item: 'Desc_IronPlateReinforced_C', rate: 40 }]),
    plan([{ item: 'Desc_IronPlate_C', rate: 95 }]),
    plan(
      [
        { item: 'Desc_IronPlate_C', rate: 20 },
        { item: 'Desc_IronScrew_C', rate: 50 },
      ],
      true,
    ),
  ]

  it('gives every Merger exactly one output belt', () => {
    // The rule that makes a Merger a Merger. Feeding several destinations off
    // one Merger would ask the game for a square with three outputs.
    for (const p of plans) {
      const { links, junctions } = complexLayout(p)
      const mergers = junctions.filter((j) => j.kind === 'merger')
      for (const m of mergers) {
        expect(touching(links, m.outPort)).toBe(1)
        expect(touching(links, m.inPort)).toBeLessThanOrEqual(3)
      }
    }
  })

  it('gives every Splitter exactly one input belt', () => {
    for (const p of plans) {
      const { links, junctions } = complexLayout(p)
      for (const s of junctions.filter((j) => j.kind === 'splitter')) {
        expect(touching(links, s.inPort)).toBe(1)
        expect(touching(links, s.outPort)).toBeLessThanOrEqual(3)
      }
    }
  })

  it('draws a loop when a stage has an awkward machine count', () => {
    // 95/min of plates needs 5 constructors, which no plain tree divides evenly.
    const five = plan([{ item: 'Desc_IronPlate_C', rate: 95 }])
    expect(five.stages.some((s) => s.machinesBuilt === 5)).toBe(true)
    const { links, labels } = complexLayout(five)
    expect(links.some((l) => l.loop)).toBe(true)
    expect(labels.some((lb) => lb.note?.includes('1:5 balancer'))).toBe(true)
  })

  it('draws no loop when the machine count already divides evenly', () => {
    const six = plan([{ item: 'Desc_IronPlate_C', rate: 110 }])
    expect(six.stages.some((s) => s.machinesBuilt === 6)).toBe(true)
    expect(complexLayout(six).links.some((l) => l.loop)).toBe(false)
  })
})

describe('dragging Splitters and Mergers', () => {
  const branching = plan([{ item: 'Desc_IronPlate_C', rate: 95 }])

  it('gives every junction a key that survives a replan', () => {
    // Same chain, different rate: the squares are the same squares, so a
    // dragged one has to keep its override.
    const keysOf = (p: ReturnType<typeof plan>) =>
      new Set(complexLayout(p).junctions.map((j) => j.key))
    const a = keysOf(plan([{ item: 'Desc_IronPlate_C', rate: 95 }]))
    const b = keysOf(plan([{ item: 'Desc_IronPlate_C', rate: 90 }]))
    expect(a.size).toBeGreaterThan(0)
    expect([...a].sort()).toEqual([...b].sort())
  })

  it('never gives two junctions the same key', () => {
    const junctions = complexLayout(branching).junctions
    expect(new Set(junctions.map((j) => j.key)).size).toBe(junctions.length)
  })

  it('counts junction keys as draggable boxes, so a drag is not pruned', () => {
    const keys = boxKeys(branching, 'complex')
    for (const j of complexLayout(branching).junctions) {
      expect(keys.has(j.key)).toBe(true)
    }
  })

  it('moves the square and its belts to where it was dragged', () => {
    const before = complexLayout(branching)
    const target = before.junctions[0]
    const moved = { x: target.auto.x + 120, y: target.auto.y - 60 }
    const at = (links: typeof before.links, p: { x: number; y: number }) =>
      links.filter(
        (l) =>
          (Math.abs(l.x1 - p.x) < 0.5 && Math.abs(l.y1 - p.y) < 0.5) ||
          (Math.abs(l.x2 - p.x) < 0.5 && Math.abs(l.y2 - p.y) < 0.5),
      ).length

    const after = complexLayout(branching, { [target.key]: moved })
    const dragged = after.junctions.find((j) => j.key === target.key)!
    expect({ x: dragged.x, y: dragged.y }).toEqual(moved)
    // Its faces moved with it, and the belts are wired to the faces, so no
    // belt is left hanging where the square used to be.
    expect(dragged.outPort).not.toEqual(target.outPort)
    expect(at(after.links, dragged.outPort)).toBe(at(before.links, target.outPort))
    expect(at(after.links, target.outPort)).toBe(0)
  })

  it('leaves every other square where it was', () => {
    const before = complexLayout(branching)
    const target = before.junctions[0]
    const after = complexLayout(branching, {
      [target.key]: { x: target.auto.x + 120, y: target.auto.y - 60 },
    })
    // Dragging one square must not cascade into the rest of the tree.
    for (const j of after.junctions) {
      if (j.key === target.key) continue
      const was = before.junctions.find((b) => b.key === j.key)!
      expect({ x: j.x, y: j.y }).toEqual({ x: was.x, y: was.y })
    }
  })

  it('renders the drag in the svg', () => {
    const target = complexLayout(branching).junctions[0]
    const moved = { x: target.auto.x + 120, y: target.auto.y - 60 }
    const html = renderToStaticMarkup(
      <Schematic
        plan={branching}
        data={data}
        viewMode="complex"
        layout={{ [target.key]: moved }}
      />,
    )
    expect(html).toContain(`translate(${moved.x} ${moved.y})`)
    expect(html).toContain('junction')
  })
})

describe('belts meet the face they come from', () => {
  // The failure this guards against: wiring a belt to the far face of a square
  // so it crosses the square to get there. It still counts as one belt on one
  // port, but on screen the square reads as having an extra output and no
  // input at all.
  const plans = [
    plan([{ item: 'Desc_IronPlate_C', rate: 95 }]), // 1:5 balancers, loop belts
    plan([{ item: 'Desc_IronPlateReinforced_C', rate: 40 }]),
    plan(
      [
        { item: 'Desc_IronPlate_C', rate: 20 },
        { item: 'Desc_IronScrew_C', rate: 50 },
      ],
      true,
    ),
  ]

  /** Whether `other` lies on the outward side of the face at `port`. */
  const outward = (
    side: string,
    port: { x: number; y: number },
    other: { x: number; y: number },
  ) => {
    const slack = 0.5
    if (side === 'left') return other.x <= port.x + slack
    if (side === 'right') return other.x >= port.x - slack
    if (side === 'top') return other.y <= port.y + slack
    return other.y >= port.y - slack
  }

  it('never runs a belt through a junction to reach the far side', () => {
    for (const p of plans) {
      const { links, junctions } = complexLayout(p)
      for (const j of junctions) {
        for (const l of links) {
          const ends = [
            { at: { x: l.x1, y: l.y1 }, far: { x: l.x2, y: l.y2 } },
            { at: { x: l.x2, y: l.y2 }, far: { x: l.x1, y: l.y1 } },
          ]
          for (const port of ['in', 'out'] as const) {
            const p0 = port === 'in' ? j.inPort : j.outPort
            const side = port === 'in' ? j.inSide : j.outSide
            for (const e of ends) {
              if (Math.abs(e.at.x - p0.x) > 0.5 || Math.abs(e.at.y - p0.y) > 0.5) {
                continue
              }
              expect({
                junction: `${j.key} ${side} ${port}`,
                outward: outward(side, p0, e.far),
              }).toEqual({ junction: `${j.key} ${side} ${port}`, outward: true })
            }
          }
        }
      }
    }
  })

  it('points a returning belt back towards the head of the tree', () => {
    // Belts are stored the way they flow, which is what orients the arrowheads.
    // A loop belt runs against the forward flow, so it must be stored that way
    // too rather than normalised left-to-right.
    const { links, junctions } = complexLayout(plans[0])
    const fb = junctions.find((j) => j.key.startsWith('sfb:'))!
    const incoming = links.filter(
      (l) => Math.abs(l.x2 - fb.inPort.x) < 0.5 && Math.abs(l.y2 - fb.inPort.y) < 0.5,
    )
    expect(incoming).toHaveLength(1)
    // It ends at the Splitter, having started further right, out in the return
    // lane: stored end-to-end against the forward flow.
    expect(incoming[0].x1).toBeGreaterThan(incoming[0].x2)
    expect(incoming[0].loop).toBe(true)
  })
})

describe('the return Splitter clears what it feeds', () => {
  it('sits below every Merger it feeds, on every machine count', () => {
    // Its belts leave through the top face, so a Merger level with it (or under
    // it) would need a belt that loops back around the square to arrive.
    for (const rate of [95, 130, 150, 190, 210, 250]) {
      const p = plan([{ item: 'Desc_IronPlate_C', rate }])
      const { junctions } = complexLayout(p)
      for (const fb of junctions.filter((j) => j.key.startsWith('sfb:'))) {
        const run = fb.key.slice('sfb:'.length)
        const fed = junctions.filter((j) => j.key.startsWith(`bmerge:${run}#`))
        expect(fed.length).toBeGreaterThan(0)
        for (const m of fed) {
          expect(fb.outPort.y - m.inPort.y).toBeGreaterThanOrEqual(30)
        }
      }
    }
  })
})
