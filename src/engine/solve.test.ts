import { describe, it, expect } from 'vitest'
import { solve, type PlanInput } from './solve'
import type { Extractor, GameData, Item, Machine, Recipe } from './types'
import { loadGameData } from '../data/loader'

// ---------------------------------------------------------------------------
// Fixture: a minimal, hand-checked dataset so expectations are easy to verify.
//
//   ingot: 1 iron ore -> 1 ingot, 2s, Smelter        (30/min per machine)
//   alt-ingot: 2 iron ore -> 3 ingot, 4s, Smelter    (30 in -> 45 out)
//   plate: 3 ingot -> 2 plate, 4s, Constructor       (45 in -> 30 out)
//   alloy: 2 iron ore + 2 copper ore -> 1 alloy, 4s  (30+30 in -> 15 out)
//   goo:   4 water + 2 iron ore -> 2 goo + 1 sludge, 6s, Refinery
//                                                    (40+20 in -> 20+10 out)
//   widget: 2 ingot -> 1 widget + 2 scrap, 4s        (scrap is sinkable, 10 pts)
//   cycle-a: 1 b -> 1 a / cycle-b: 1 a -> 1 b        (circular)
// ---------------------------------------------------------------------------

const EXP = 1.321929

function item(id: string, name: string, liquid = false, sinkPoints = 0): [string, Item] {
  return [id, { id, name, liquid, sinkPoints }]
}

function machine(id: string, name: string, power: number): [string, Machine] {
  return [id, { id, name, power, powerExponent: EXP }]
}

function miner(tier: number, power: number, rate: number): Extractor {
  return {
    id: `Miner${tier}`,
    name: `Miner Mk.${tier}`,
    power,
    ratePerMin: rate,
    allowedResources: ['ore-iron', 'ore-copper'],
    liquid: false,
  }
}

function fixture(): GameData {
  const recipes: Recipe[] = [
    {
      id: 'r-ingot', name: 'Ingot', alternate: false, time: 2,
      ingredients: [{ item: 'ore-iron', amount: 1 }],
      products: [{ item: 'ingot', amount: 1 }],
      machine: 'Smelter',
    },
    {
      id: 'r-alt-ingot', name: 'Alternate: Ingot', alternate: true, time: 4,
      ingredients: [{ item: 'ore-iron', amount: 2 }],
      products: [{ item: 'ingot', amount: 3 }],
      machine: 'Smelter',
    },
    {
      id: 'r-plate', name: 'Plate', alternate: false, time: 4,
      ingredients: [{ item: 'ingot', amount: 3 }],
      products: [{ item: 'plate', amount: 2 }],
      machine: 'Constructor',
    },
    {
      id: 'r-alloy', name: 'Alloy', alternate: false, time: 4,
      ingredients: [
        { item: 'ore-iron', amount: 2 },
        { item: 'ore-copper', amount: 2 },
      ],
      products: [{ item: 'alloy', amount: 1 }],
      machine: 'Constructor',
    },
    {
      id: 'r-goo', name: 'Goo', alternate: false, time: 6,
      ingredients: [
        { item: 'water', amount: 4 },
        { item: 'ore-iron', amount: 2 },
      ],
      products: [
        { item: 'goo', amount: 2 },
        { item: 'sludge', amount: 1 },
      ],
      machine: 'Refinery',
    },
    {
      id: 'r-widget', name: 'Widget', alternate: false, time: 4,
      ingredients: [{ item: 'ingot', amount: 2 }],
      products: [
        { item: 'widget', amount: 1 },
        { item: 'scrap', amount: 2 },
      ],
      machine: 'Constructor',
    },
    {
      id: 'r-cycle-a', name: 'Cycle A', alternate: false, time: 1,
      ingredients: [{ item: 'cycle-b', amount: 1 }],
      products: [{ item: 'cycle-a', amount: 1 }],
      machine: 'Constructor',
    },
    {
      id: 'r-cycle-b', name: 'Cycle B', alternate: false, time: 1,
      ingredients: [{ item: 'cycle-a', amount: 1 }],
      products: [{ item: 'cycle-b', amount: 1 }],
      machine: 'Constructor',
    },
  ]

  const recipesByProduct = new Map<string, Recipe[]>()
  for (const r of recipes) {
    for (const p of r.products) {
      const list = recipesByProduct.get(p.item) ?? []
      list.push(r)
      recipesByProduct.set(p.item, list)
    }
  }

  return {
    items: new Map([
      item('ore-iron', 'Iron Ore'),
      item('ore-copper', 'Copper Ore'),
      item('water', 'Water', true),
      item('ingot', 'Ingot', false, 2),
      item('plate', 'Plate', false, 6),
      item('alloy', 'Alloy'),
      item('goo', 'Goo', true),
      item('sludge', 'Sludge', true),
      item('widget', 'Widget'),
      item('scrap', 'Scrap', false, 10),
      item('cycle-a', 'Cycle A'),
      item('cycle-b', 'Cycle B'),
    ]),
    recipes: new Map(recipes.map((r) => [r.id, r])),
    recipesByProduct,
    machines: new Map([
      machine('Smelter', 'Smelter', 4),
      machine('Constructor', 'Constructor', 4),
      machine('Refinery', 'Refinery', 30),
    ]),
    awesomeSink: { id: 'Sink', name: 'AWESOME Sink', power: 30, powerExponent: 1.6 },
    minersByTier: new Map([
      [1, miner(1, 5, 60)],
      [2, miner(2, 15, 120)],
      [3, miner(3, 45, 240)],
    ]),
    oilExtractor: {
      id: 'OilPump', name: 'Oil Extractor', power: 40,
      ratePerMin: 120, allowedResources: ['oil'], liquid: true,
    },
    waterExtractor: {
      id: 'WaterPump', name: 'Water Extractor', power: 20,
      ratePerMin: 120, allowedResources: ['water'], liquid: true,
    },
    nodeResources: ['ore-iron', 'ore-copper', 'oil'],
  }
}

const base: Omit<PlanInput, 'targets' | 'nodes'> = {
  minerTier: 1,
  beltMk: 1,
  pipeMk: 1,
}

describe('solve: simple chain (ore -> ingot -> plate)', () => {
  const result = solve(fixture(), {
    ...base,
    nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
    targets: [{ item: 'plate' }],
  })

  it('succeeds', () => {
    expect(result.ok).toBe(true)
  })
  if (!result.ok) return
  const plan = result.plan

  it('computes the max target rate from the node supply', () => {
    // 60 ore -> 60 ingots -> 40 plates
    expect(plan.targets[0].rate).toBeCloseTo(40, 6)
  })

  it('creates extractor, machine and storage stages in depth order', () => {
    const kinds = plan.stages.map((s) => s.kind)
    expect(kinds).toContain('extractor')
    expect(kinds).toContain('machine')
    expect(kinds[kinds.length - 1]).toBe('storage')
    const smelters = plan.stages.find((s) => s.recipeId === 'r-ingot')!
    const constructors = plan.stages.find((s) => s.recipeId === 'r-plate')!
    expect(smelters.count).toBeCloseTo(2, 6) // 60 / 30 per machine
    expect(smelters.machinesBuilt).toBe(2)
    expect(constructors.count).toBeCloseTo(60 / 45, 6)
    expect(constructors.machinesBuilt).toBe(2)
    expect(constructors.lastClockPercent).toBeCloseTo(100 / 3, 3)
    expect(smelters.depth).toBeLessThan(constructors.depth)
  })

  it('computes power with the underclock exponent', () => {
    const constructors = plan.stages.find((s) => s.recipeId === 'r-plate')!
    expect(constructors.powerMW).toBeCloseTo(4 + 4 * Math.pow(1 / 3, EXP), 6)
    const smelters = plan.stages.find((s) => s.recipeId === 'r-ingot')!
    expect(smelters.powerMW).toBeCloseTo(8, 6)
    const minerStage = plan.stages.find((s) => s.kind === 'extractor')!
    expect(minerStage.powerMW).toBeCloseTo(5, 6)
    expect(plan.totalPowerMW).toBeCloseTo(
      5 + 8 + 4 + 4 * Math.pow(1 / 3, EXP), 6,
    )
  })

  it('creates belt edges with lane counts', () => {
    const oreEdge = plan.edges.find((e) => e.item === 'ore-iron')!
    expect(oreEdge.rate).toBeCloseTo(60, 6)
    expect(oreEdge.transport).toBe('belt')
    expect(oreEdge.lanes).toBe(1)
    const storageEdge = plan.edges.find((e) => e.to === 'storage:plate')!
    expect(storageEdge.item).toBe('plate')
    expect(storageEdge.rate).toBeCloseTo(40, 6)
  })
})

describe('solve: node aggregation and belt caps', () => {
  it('sums output of multiple nodes of the same resource', () => {
    const result = solve(fixture(), {
      ...base,
      beltMk: 3, // pure Mk.1 miner outputs 120/min; Mk.1 belt would cap it
      nodes: [
        { resource: 'ore-iron', purity: 'normal', count: 1 },
        { resource: 'ore-iron', purity: 'pure', count: 1 },
      ],
      targets: [{ item: 'ingot' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 60 + 120 = 180 ore -> 180 ingots
    expect(result.plan.targets[0].rate).toBeCloseTo(180, 6)
  })

  it('caps each miner output at the selected belt speed', () => {
    const result = solve(fixture(), {
      ...base,
      minerTier: 3,
      beltMk: 1, // 60/min belt caps the 480/min pure Mk.3 miner
      nodes: [{ resource: 'ore-iron', purity: 'pure', count: 1 }],
      targets: [{ item: 'ingot' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.targets[0].rate).toBeCloseTo(60, 6)
  })

  it('splits high rates across multiple belt lanes', () => {
    const result = solve(fixture(), {
      ...base,
      minerTier: 2,
      beltMk: 2,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 2 }],
      targets: [{ item: 'ingot' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 240 ore over Mk.2 belts (120/min) -> 2 lanes
    const oreEdge = result.plan.edges.find((e) => e.item === 'ore-iron')!
    expect(oreEdge.lanes).toBe(2)
  })
})

describe('solve: multiple raw inputs', () => {
  it('finds the limiting resource and scales the chain to it', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [
        { resource: 'ore-iron', purity: 'normal', count: 1 },
        { resource: 'ore-copper', purity: 'impure', count: 1 },
      ],
      targets: [{ item: 'alloy' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // copper limits: 30/min -> 15 alloy/min (iron surplus stays in the ground)
    expect(result.plan.targets[0].rate).toBeCloseTo(15, 6)
    expect(result.plan.limitingResource).toBe('ore-copper')
  })

  it('errors when a required resource has no node', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'alloy' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/Copper Ore/)
  })
})

describe('solve: water, byproducts and pipes', () => {
  const result = solve(fixture(), {
    ...base,
    nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
    targets: [{ item: 'goo' }],
  })

  it('auto-supplies water with water extractors', () => {
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 60 ore -> 3 refineries -> 60 goo, needing 120 water/min -> 1 extractor
    expect(result.plan.targets[0].rate).toBeCloseTo(60, 6)
    const water = result.plan.stages.find((s) => s.machineId === 'WaterPump')!
    expect(water.machinesBuilt).toBe(1)
    expect(water.powerMW).toBeCloseTo(20, 6)
  })

  it('routes fluids through pipes', () => {
    if (!result.ok) return
    const waterEdge = result.plan.edges.find((e) => e.item === 'water')!
    expect(waterEdge.transport).toBe('pipe')
    expect(waterEdge.lanes).toBe(1) // 120 over a 300 m³/min Mk.1 pipe
  })

  it('reports byproducts as surplus', () => {
    if (!result.ok) return
    expect(result.plan.surplus).toEqual([
      { item: 'sludge', rate: expect.closeTo(30, 6) },
    ])
  })
})

describe('solve: recipe selection', () => {
  it('uses the selected alternate recipe and rescales the chain', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'plate' }],
      recipeSelection: { ingot: 'r-alt-ingot' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 60 ore -> 90 ingots (alt) -> 60 plates
    expect(result.plan.targets[0].rate).toBeCloseTo(60, 6)
    const smelters = result.plan.stages.find((s) => s.recipeId === 'r-alt-ingot')!
    expect(smelters.count).toBeCloseTo(2, 6)
  })

  it('errors on circular recipe chains', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'cycle-a' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/circular/i)
  })
})

describe('solve: target-driven rate', () => {
  it('scales the chain down to a requested rate below the max', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'plate', rate: 20 }], // max is 40
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.targets[0].rate).toBeCloseTo(20, 6)
    // 20 plates -> 30 ingots -> 30 ore
    const smelters = result.plan.stages.find((s) => s.recipeId === 'r-ingot')!
    expect(smelters.count).toBeCloseTo(1, 6)
    const miner = result.plan.stages.find((s) => s.kind === 'extractor')!
    expect(miner.count).toBeCloseTo(0.5, 6) // 30 of a 60/min node
    expect(miner.machinesBuilt).toBe(1)
    expect(miner.lastClockPercent).toBeCloseTo(50, 6)
    expect(miner.powerMW).toBeCloseTo(5 * Math.pow(0.5, EXP), 6)
  })

  it('errors when the requested rate exceeds node capacity', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'plate', rate: 100 }], // max is 40
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/Iron Ore/)
  })

  it('keeps recipe selection under a target rate', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'plate', rate: 30 }],
      recipeSelection: { ingot: 'r-alt-ingot' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.targets[0].rate).toBeCloseTo(30, 6)
    const smelters = result.plan.stages.find(
      (s) => s.recipeId === 'r-alt-ingot',
    )!
    expect(smelters).toBeDefined()
    const miner = result.plan.stages.find((s) => s.kind === 'extractor')!
    expect(miner.count).toBeCloseTo(0.5, 6)
  })

  it('reduces non-limiting extractors to what the target needs', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [
        { resource: 'ore-iron', purity: 'normal', count: 1 }, // 60/min
        { resource: 'ore-copper', purity: 'impure', count: 1 }, // 30/min
      ],
      targets: [{ item: 'alloy', rate: 10 }], // max is 15 (copper-limited)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const iron = result.plan.stages.find(
      (s) => s.kind === 'extractor' && s.outputs[0].item === 'ore-iron',
    )!
    const copper = result.plan.stages.find(
      (s) => s.kind === 'extractor' && s.outputs[0].item === 'ore-copper',
    )!
    expect(iron.count).toBeCloseTo(20 / 60, 6)
    expect(copper.count).toBeCloseTo(20 / 30, 6)
  })

  it('a target equal to the max matches the supply-driven plan', () => {
    const at = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'plate', rate: 40 }],
    })
    const auto = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'plate' }],
    })
    expect(at.ok && auto.ok).toBe(true)
    if (!at.ok || !auto.ok) return
    expect(at.plan.targets[0].rate).toBeCloseTo(auto.plan.targets[0].rate, 6)
    expect(at.plan.totalPowerMW).toBeCloseTo(auto.plan.totalPowerMW, 6)
  })

  it('ignores a non-positive target rate (falls back to max)', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'plate', rate: 0 }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.targets[0].rate).toBeCloseTo(40, 6)
  })
})

describe('solve: multiple outputs', () => {
  it('produces each output into its own storage, sharing intermediates', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      // plate needs 30 ingots; the ingot output adds 30 more -> 60 ingots total
      targets: [
        { item: 'plate', rate: 20 },
        { item: 'ingot', rate: 30 },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const storages = result.plan.stages.filter((s) => s.kind === 'storage')
    expect(storages.map((s) => s.id).sort()).toEqual([
      'storage:ingot',
      'storage:plate',
    ])
    // A single shared ingot stage covers both demands: 60 ingots -> 2 smelters.
    const smelters = result.plan.stages.filter((s) => s.recipeId === 'r-ingot')
    expect(smelters).toHaveLength(1)
    expect(smelters[0].count).toBeCloseTo(2, 6)
    const ore = result.plan.stages.find((s) => s.kind === 'extractor')!
    expect(ore.outputs[0].rate).toBeCloseTo(60, 6)
    // Storage edges carry the requested rates.
    expect(
      result.plan.edges.find((e) => e.to === 'storage:plate')!.rate,
    ).toBeCloseTo(20, 6)
    expect(
      result.plan.edges.find((e) => e.to === 'storage:ingot')!.rate,
    ).toBeCloseTo(30, 6)
  })

  it('requires an explicit rate for every output when there are several', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'plate', rate: 10 }, { item: 'ingot' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/Ingot/)
  })

  it('reports infeasibility across the combined demand', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }], // 60 ore
      targets: [
        { item: 'plate', rate: 40 }, // needs 60 ore alone
        { item: 'ingot', rate: 10 }, // pushes past capacity
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/Iron Ore/)
  })
})

describe('solve: AWESOME Sink overflow mode', () => {
  it('routes sinkable solid surplus into sinks and totals the points', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'widget', rate: 10 }], // 2 scrap per widget -> 20 scrap
      sinkOverflow: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const sink = result.plan.stages.find((s) => s.kind === 'sink')!
    expect(sink).toBeDefined()
    expect(sink.inputs[0].item).toBe('scrap')
    expect(sink.inputs[0].rate).toBeCloseTo(20, 6)
    expect(sink.powerMW).toBeCloseTo(30, 6) // 20/min over one belt -> 1 sink
    // 20 scrap/min * 10 points = 200 points/min
    expect(result.plan.sinkPointsPerMin).toBeCloseTo(200, 6)
    // Sunk surplus is no longer reported as leftover.
    expect(result.plan.surplus.some((s) => s.item === 'scrap')).toBe(false)
    // An edge feeds the sink.
    expect(result.plan.edges.some((e) => e.to === 'sink:scrap')).toBe(true)
  })

  it('leaves liquid surplus untouched (the sink only takes solids)', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'goo' }],
      sinkOverflow: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.sinkPointsPerMin).toBe(0)
    expect(result.plan.stages.some((s) => s.kind === 'sink')).toBe(false)
    expect(result.plan.surplus.some((s) => s.item === 'sludge')).toBe(true)
  })

  it('does nothing when sink mode is off', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'widget', rate: 10 }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.sinkPointsPerMin).toBe(0)
    expect(result.plan.stages.some((s) => s.kind === 'sink')).toBe(false)
    expect(result.plan.surplus.some((s) => s.item === 'scrap')).toBe(true)
  })
})

describe('solve: balanced multi-output max', () => {
  // plate: 1.5 ore each -> solo max 40/min from a 60/min node
  // widget: 2 ore each   -> solo max 30/min from the same node
  // weights 40 and 30 -> k = 60 / (40*1.5 + 30*2) = 0.5 -> 20 plate, 15 widget
  const result = solve(fixture(), {
    ...base,
    nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
    targets: [{ item: 'plate' }, { item: 'widget' }],
  })

  it('succeeds with every rate left blank', () => {
    expect(result.ok).toBe(true)
  })
  if (!result.ok) return
  const plan = result.plan
  const rateOf = (item: string) =>
    plan.targets.find((t) => t.item === item)!.rate

  it('splits the supply proportionally to each solo max', () => {
    expect(rateOf('plate')).toBeCloseTo(20, 6)
    expect(rateOf('widget')).toBeCloseTo(15, 6)
  })

  it('gives every output the same fraction of its solo potential', () => {
    expect(rateOf('plate') / 40).toBeCloseTo(rateOf('widget') / 30, 6)
  })

  it('saturates the limiting resource without exceeding it', () => {
    const ore = plan.stages.find((s) => s.kind === 'extractor')!
    expect(ore.outputs[0].rate).toBeCloseTo(60, 6)
    expect(plan.limitingResource).toBe('ore-iron')
  })

  it('still gives the plain solo max for a single blank output', () => {
    const single = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targets: [{ item: 'plate' }],
    })
    expect(single.ok).toBe(true)
    if (!single.ok) return
    expect(single.plan.targets[0].rate).toBeCloseTo(40, 6)
  })

  it('weighs outputs that do not compete for the same resource', () => {
    // alloy needs copper too; with copper scarce it drags alloy's weight down.
    const mixed = solve(fixture(), {
      ...base,
      nodes: [
        { resource: 'ore-iron', purity: 'normal', count: 1 }, // 60/min
        { resource: 'ore-copper', purity: 'impure', count: 1 }, // 30/min
      ],
      targets: [{ item: 'plate' }, { item: 'alloy' }],
    })
    expect(mixed.ok).toBe(true)
    if (!mixed.ok) return
    const alloy = mixed.plan.targets.find((t) => t.item === 'alloy')!.rate
    const plate = mixed.plan.targets.find((t) => t.item === 'plate')!.rate
    // solo maxes: plate 40 (iron), alloy 15 (copper-limited)
    // iron: 40*1.5 + 15*2 = 90k <= 60 ; copper: 15*2 = 30k <= 30
    // k = min(60/90, 30/30) = 2/3 -> plate 26.67, alloy 10
    expect(plate).toBeCloseTo(80 / 3, 6)
    expect(alloy).toBeCloseTo(10, 6)
  })
})

describe('solve: whole-machine build mode', () => {
  const nodes = [{ resource: 'ore-iron' as const, purity: 'normal' as const, count: 1 }]

  it('underclocks and leaves no overflow in exact mode', () => {
    const result = solve(fixture(), {
      ...base,
      nodes,
      targets: [{ item: 'plate', rate: 20 }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const plate = result.plan.stages.find((s) => s.recipeId === 'r-plate')!
    expect(plate.count).toBeCloseTo(2 / 3, 6)
    expect(plate.lastClockPercent).toBeCloseTo(200 / 3, 6)
    expect(result.plan.surplus).toHaveLength(0)
  })

  it('rounds every stage up to whole machines at 100% clock', () => {
    const result = solve(fixture(), {
      ...base,
      nodes,
      targets: [{ item: 'plate', rate: 20 }],
      buildMode: 'whole',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const plate = result.plan.stages.find((s) => s.recipeId === 'r-plate')!
    const ingot = result.plan.stages.find((s) => s.recipeId === 'r-ingot')!
    // 20 plate -> 10 runs -> 0.67 machine -> 1 machine at 100% -> 30 plate
    expect(plate.machinesBuilt).toBe(1)
    expect(plate.lastClockPercent).toBe(100)
    // 1 plate machine eats 45 ingot -> 1.5 smelters -> 2 at 100% -> 60 ingot
    expect(ingot.machinesBuilt).toBe(2)
    expect(ingot.lastClockPercent).toBe(100)
  })

  it('reports the overproduction of every stage as surplus', () => {
    const result = solve(fixture(), {
      ...base,
      nodes,
      targets: [{ item: 'plate', rate: 20 }],
      buildMode: 'whole',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const surplus = new Map(result.plan.surplus.map((s) => [s.item, s.rate]))
    expect(surplus.get('plate')).toBeCloseTo(10, 6) // 30 made, 20 requested
    expect(surplus.get('ingot')).toBeCloseTo(15, 6) // 60 made, 45 consumed
  })

  it('feeds that overflow into the AWESOME Sink', () => {
    const result = solve(fixture(), {
      ...base,
      nodes,
      targets: [{ item: 'plate', rate: 20 }],
      buildMode: 'whole',
      sinkOverflow: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 10 plate * 6 pts + 15 ingot * 2 pts = 90 pts/min
    expect(result.plan.sinkPointsPerMin).toBeCloseTo(90, 6)
    expect(result.plan.stages.some((s) => s.id === 'sink:plate')).toBe(true)
    expect(result.plan.stages.some((s) => s.id === 'sink:ingot')).toBe(true)
    // Storage still receives exactly what was asked for.
    expect(
      result.plan.edges.find((e) => e.to === 'storage:plate')!.rate,
    ).toBeCloseTo(20, 6)
  })

  it('keeps the sink idle in exact mode (the bug this mode fixes)', () => {
    const result = solve(fixture(), {
      ...base,
      nodes,
      targets: [{ item: 'plate', rate: 20 }],
      sinkOverflow: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.sinkPointsPerMin).toBe(0)
  })

  it('lowers the max rate so the rounded-up chain still fits the nodes', () => {
    const result = solve(fixture(), {
      ...base,
      nodes,
      targets: [{ item: 'plate' }],
      buildMode: 'whole',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Exact mode reaches 40/min, but 2 plate machines would need 90 ore.
    // 1 plate machine (30/min) with 2 smelters consumes exactly 60 ore.
    expect(result.plan.targets[0].rate).toBeCloseTo(30, 4)
    const ore = result.plan.stages.find((s) => s.kind === 'extractor')!
    expect(ore.outputs[0].rate).toBeCloseTo(60, 4)
  })

  it('underclocks extractors in exact mode', () => {
    const result = solve(fixture(), {
      ...base,
      nodes,
      targets: [{ item: 'ingot', rate: 20 }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ore = result.plan.stages.find((s) => s.kind === 'extractor')!
    expect(ore.count).toBeCloseTo(20 / 60, 6)
    expect(ore.outputs[0].rate).toBeCloseTo(20, 6)
  })

  it('runs extractors whole at 100% and overflows the extra ore', () => {
    const result = solve(fixture(), {
      ...base,
      nodes,
      targets: [{ item: 'ingot', rate: 20 }],
      buildMode: 'whole',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 20 ingot -> 1 smelter at 100% -> 30 ingot -> 30 ore pulled,
    // but a whole miner on a normal node yields its full 60/min.
    const ore = result.plan.stages.find((s) => s.kind === 'extractor')!
    expect(ore.machinesBuilt).toBe(1)
    expect(ore.lastClockPercent).toBe(100)
    expect(ore.count).toBe(1)
    expect(ore.outputs[0].rate).toBeCloseTo(60, 6)
    expect(ore.powerMW).toBeCloseTo(5, 6) // full power, no underclock discount
    const surplus = new Map(result.plan.surplus.map((s) => [s.item, s.rate]))
    expect(surplus.get('ore-iron')).toBeCloseTo(30, 6)
    expect(surplus.get('ingot')).toBeCloseTo(10, 6)
  })

  it('engages only the extractors it needs, each at full rate', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 3 }], // 180/min
      targets: [{ item: 'ingot', rate: 20 }],
      buildMode: 'whole',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ore = result.plan.stages.find((s) => s.kind === 'extractor')!
    expect(ore.machinesBuilt).toBe(1) // 2 idle nodes stay unbuilt
    expect(ore.outputs[0].rate).toBeCloseTo(60, 6)
  })

  it('errors when the nodes cannot feed one machine per stage', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'impure', count: 1 }], // 30/min
      targets: [{ item: 'plate' }],
      buildMode: 'whole',
    })
    // 1 plate machine needs 45 ingot -> 2 smelters -> 60 ore > 30 available
    expect(result.ok).toBe(false)
  })
})

describe('solve: raw resource as target', () => {
  it('plans miners straight into storage', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 2 }],
      targets: [{ item: 'ore-iron' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.targets[0].rate).toBeCloseTo(120, 6)
    expect(result.plan.stages.map((s) => s.kind)).toEqual([
      'extractor',
      'storage',
    ])
  })
})

describe('solve: real dataset integration', () => {
  const data = loadGameData()

  it('plans Iron Plates from one normal iron node (Mk.1)', () => {
    const result = solve(data, {
      minerTier: 1, beltMk: 1, pipeMk: 1,
      nodes: [{ resource: 'Desc_OreIron_C', purity: 'normal', count: 1 }],
      targets: [{ item: 'Desc_IronPlate_C' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Wiki: 60 ore -> 2 Smelters -> 60 ingots -> 2 Constructors -> 40 plates
    expect(result.plan.targets[0].rate).toBeCloseTo(40, 6)
    expect(result.plan.totalPowerMW).toBeCloseTo(5 + 8 + 8, 6)
  })

  it('plans Reinforced Iron Plates from one pure iron node (Mk.2)', () => {
    const result = solve(data, {
      minerTier: 2, beltMk: 3, pipeMk: 1,
      nodes: [{ resource: 'Desc_OreIron_C', purity: 'pure', count: 1 }],
      targets: [{ item: 'Desc_IronPlateReinforced_C' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 240 ore/min -> 20 RIP/min (hand-checked against wiki recipe rates)
    expect(result.plan.targets[0].rate).toBeCloseTo(20, 6)
  })
})
