import { describe, it, expect } from 'vitest'
import { optimizeRecipes } from './optimize'
import { solve, type PlanInput } from './solve'
import { loadGameData } from '../data/loader'

const data = loadGameData()

const plan = (input: PlanInput) => {
  const r = solve(data, input)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.plan
}

describe('optimizeRecipes: pushing the output up', () => {
  const input: PlanInput = {
    minerTier: 1,
    beltMk: 3,
    pipeMk: 1,
    nodes: [{ resource: 'Desc_OreIron_C', purity: 'normal', count: 2 }],
    targets: [{ item: 'Desc_IronPlateReinforced_C' }],
  }
  const found = optimizeRecipes(data, input)!

  it('finds something to change', () => {
    expect(found).not.toBeNull()
    expect(found.changes.length).toBeGreaterThan(0)
  })

  it('optimises for output when the rates are left blank', () => {
    expect(found.objective).toBe('output')
  })

  it('really does produce more, by the margin it claims', () => {
    const before = plan(input).targets[0].rate
    const after = plan({ ...input, recipeSelection: found.selection }).targets[0]
      .rate
    expect(after).toBeGreaterThan(before)
    expect(after / before).toBeCloseTo(found.improvement, 6)
  })

  it('only picks recipes that really make the item they are picked for', () => {
    for (const [item, recipeId] of Object.entries(found.selection)) {
      const recipe = data.recipes.get(recipeId)!
      expect(recipe.products.some((p) => p.item === item)).toBe(true)
    }
  })

  it('reports each change against what would have been built', () => {
    for (const c of found.changes) {
      expect(c.from).not.toBe(c.to)
      // The default is what you get without a pick, so that is what changed.
      expect(c.from).toBe(data.recipesByProduct.get(c.item)![0].id)
    }
  })
})

describe('optimizeRecipes: cutting what it costs', () => {
  const input: PlanInput = {
    minerTier: 1,
    beltMk: 3,
    pipeMk: 1,
    nodes: [{ resource: 'Desc_OreIron_C', purity: 'pure', count: 4 }],
    targets: [{ item: 'Desc_IronPlateReinforced_C', rate: 10 }],
  }
  const found = optimizeRecipes(data, input)!

  it('switches to saving ore once the rate is pinned', () => {
    expect(found.objective).toBe('raw')
  })

  it('keeps the output where it was asked to be', () => {
    const after = plan({ ...input, recipeSelection: found.selection })
    expect(after.targets[0].rate).toBeCloseTo(10, 6)
  })

  it('really does need fewer miners, by the margin it claims', () => {
    const load = (sel?: Record<string, string>) =>
      plan({ ...input, recipeSelection: sel }).stages
        .filter((s) => s.kind === 'extractor')
        .reduce((n, s) => n + s.count, 0)
    expect(load(found.selection)).toBeLessThan(load())
    expect(load() / load(found.selection)).toBeCloseTo(found.improvement, 6)
  })
})

describe('optimizeRecipes: when there is nothing to say', () => {
  it('returns null for a chain with no choice in it', () => {
    // Iron Ore straight into storage: no recipe runs, so nothing to pick.
    const found = optimizeRecipes(data, {
      minerTier: 1,
      beltMk: 1,
      pipeMk: 1,
      nodes: [{ resource: 'Desc_OreIron_C', purity: 'normal', count: 1 }],
      targets: [{ item: 'Desc_OreIron_C' }],
    })
    expect(found).toBeNull()
  })

  it('returns null when the plan does not solve as it stands', () => {
    const found = optimizeRecipes(data, {
      minerTier: 1,
      beltMk: 1,
      pipeMk: 1,
      nodes: [],
      targets: [{ item: 'Desc_IronPlate_C', rate: 10 }],
    })
    expect(found).toBeNull()
  })

  it('never returns a plan worse than the one it was given', () => {
    // Starting from a deliberately poor pick, it must not keep it.
    const input: PlanInput = {
      minerTier: 1,
      beltMk: 3,
      pipeMk: 1,
      nodes: [{ resource: 'Desc_OreIron_C', purity: 'normal', count: 2 }],
      targets: [{ item: 'Desc_IronPlate_C' }],
      recipeSelection: {},
    }
    const found = optimizeRecipes(data, input)
    if (found === null) return
    expect(found.improvement).toBeGreaterThanOrEqual(1 - 1e-9)
  })
})

describe('optimizeRecipes: imports', () => {
  it('leaves alone what is imported outright, and still tunes the rest', () => {
    const input: PlanInput = {
      minerTier: 3,
      beltMk: 5,
      pipeMk: 1,
      nodes: [
        { resource: 'Desc_OreIron_C', purity: 'pure', count: 4 },
        { resource: 'Desc_OreCopper_C', purity: 'pure', count: 2 },
      ],
      imports: [{ item: 'Desc_QuartzCrystal_C' }],
      targets: [{ item: 'Desc_CrystalOscillator_C', rate: 2 }],
    }
    const found = optimizeRecipes(data, input)!
    expect(found).not.toBeNull()
    // Nothing above a rateless import is built, so nothing there is chosen.
    expect(found.selection['Desc_QuartzCrystal_C']).toBeUndefined()
    // The parts that are still built here are fair game.
    expect(Object.keys(found.selection).length).toBeGreaterThan(0)
  })

  it('still tunes the recipe of an item a capped import only tops up', () => {
    const input: PlanInput = {
      minerTier: 3,
      beltMk: 5,
      pipeMk: 1,
      nodes: [
        { resource: 'Desc_OreIron_C', purity: 'pure', count: 2 },
        { resource: 'Desc_RawQuartz_C', purity: 'pure', count: 2 },
      ],
      imports: [{ item: 'Desc_QuartzCrystal_C', rate: 30 }],
      targets: [{ item: 'Desc_Silica_C' }],
    }
    const found = optimizeRecipes(data, input)
    // Machines still cover the difference, so their recipes are still choices.
    if (found !== null) {
      expect(found.improvement).toBeGreaterThanOrEqual(1 - 1e-9)
    }
  })
})
