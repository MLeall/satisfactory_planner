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
//   cycle-a: 1 b -> 1 a / cycle-b: 1 a -> 1 b        (circular)
// ---------------------------------------------------------------------------

const EXP = 1.321929

function item(id: string, name: string, liquid = false): [string, Item] {
  return [id, { id, name, liquid }]
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
      item('ingot', 'Ingot'),
      item('plate', 'Plate'),
      item('alloy', 'Alloy'),
      item('goo', 'Goo', true),
      item('sludge', 'Sludge', true),
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

const base: Omit<PlanInput, 'targetItem' | 'nodes'> = {
  minerTier: 1,
  beltMk: 1,
  pipeMk: 1,
}

describe('solve: simple chain (ore -> ingot -> plate)', () => {
  const result = solve(fixture(), {
    ...base,
    nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
    targetItem: 'plate',
  })

  it('succeeds', () => {
    expect(result.ok).toBe(true)
  })
  if (!result.ok) return
  const plan = result.plan

  it('computes the max target rate from the node supply', () => {
    // 60 ore -> 60 ingots -> 40 plates
    expect(plan.targetRate).toBeCloseTo(40, 6)
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
    const storageEdge = plan.edges.find((e) => e.to === 'storage')!
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
      targetItem: 'ingot',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 60 + 120 = 180 ore -> 180 ingots
    expect(result.plan.targetRate).toBeCloseTo(180, 6)
  })

  it('caps each miner output at the selected belt speed', () => {
    const result = solve(fixture(), {
      ...base,
      minerTier: 3,
      beltMk: 1, // 60/min belt caps the 480/min pure Mk.3 miner
      nodes: [{ resource: 'ore-iron', purity: 'pure', count: 1 }],
      targetItem: 'ingot',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.targetRate).toBeCloseTo(60, 6)
  })

  it('splits high rates across multiple belt lanes', () => {
    const result = solve(fixture(), {
      ...base,
      minerTier: 2,
      beltMk: 2,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 2 }],
      targetItem: 'ingot',
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
      targetItem: 'alloy',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // copper limits: 30/min -> 15 alloy/min (iron surplus stays in the ground)
    expect(result.plan.targetRate).toBeCloseTo(15, 6)
    expect(result.plan.limitingResource).toBe('ore-copper')
  })

  it('errors when a required resource has no node', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targetItem: 'alloy',
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
    targetItem: 'goo',
  })

  it('auto-supplies water with water extractors', () => {
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 60 ore -> 3 refineries -> 60 goo, needing 120 water/min -> 1 extractor
    expect(result.plan.targetRate).toBeCloseTo(60, 6)
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
      targetItem: 'plate',
      recipeSelection: { ingot: 'r-alt-ingot' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 60 ore -> 90 ingots (alt) -> 60 plates
    expect(result.plan.targetRate).toBeCloseTo(60, 6)
    const smelters = result.plan.stages.find((s) => s.recipeId === 'r-alt-ingot')!
    expect(smelters.count).toBeCloseTo(2, 6)
  })

  it('errors on circular recipe chains', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targetItem: 'cycle-a',
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
      targetItem: 'plate',
      targetRate: 20, // max is 40
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.targetRate).toBeCloseTo(20, 6)
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
      targetItem: 'plate',
      targetRate: 100, // max is 40
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/Iron Ore/)
  })

  it('keeps recipe selection under a target rate', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targetItem: 'plate',
      recipeSelection: { ingot: 'r-alt-ingot' },
      targetRate: 30, // alt max is 60
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.targetRate).toBeCloseTo(30, 6)
    // 30 plates -> 45 ingots (alt: 2 ore -> 3 ingot) -> 30 ore
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
      targetItem: 'alloy',
      targetRate: 10, // max is 15 (copper-limited)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 10 alloy -> 20 iron + 20 copper
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
      targetItem: 'plate',
      targetRate: 40,
    })
    const auto = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targetItem: 'plate',
    })
    expect(at.ok && auto.ok).toBe(true)
    if (!at.ok || !auto.ok) return
    expect(at.plan.targetRate).toBeCloseTo(auto.plan.targetRate, 6)
    expect(at.plan.totalPowerMW).toBeCloseTo(auto.plan.totalPowerMW, 6)
  })

  it('ignores a non-positive target rate (falls back to max)', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 1 }],
      targetItem: 'plate',
      targetRate: 0,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.targetRate).toBeCloseTo(40, 6)
  })
})

describe('solve: raw resource as target', () => {
  it('plans miners straight into storage', () => {
    const result = solve(fixture(), {
      ...base,
      nodes: [{ resource: 'ore-iron', purity: 'normal', count: 2 }],
      targetItem: 'ore-iron',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.targetRate).toBeCloseTo(120, 6)
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
      targetItem: 'Desc_IronPlate_C',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Wiki: 60 ore -> 2 Smelters -> 60 ingots -> 2 Constructors -> 40 plates
    expect(result.plan.targetRate).toBeCloseTo(40, 6)
    expect(result.plan.totalPowerMW).toBeCloseTo(5 + 8 + 8, 6)
  })

  it('plans Reinforced Iron Plates from one pure iron node (Mk.2)', () => {
    const result = solve(data, {
      minerTier: 2, beltMk: 3, pipeMk: 1,
      nodes: [{ resource: 'Desc_OreIron_C', purity: 'pure', count: 1 }],
      targetItem: 'Desc_IronPlateReinforced_C',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 240 ore/min -> 20 RIP/min (hand-checked against wiki recipe rates)
    expect(result.plan.targetRate).toBeCloseTo(20, 6)
  })
})
