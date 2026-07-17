import { describe, it, expect } from 'vitest'
import { loadGameData } from './loader'

// Expected values verified against https://satisfactory.wiki.gg/
const data = loadGameData()

describe('loadGameData: items', () => {
  it('loads solid items', () => {
    const ore = data.items.get('Desc_OreIron_C')
    expect(ore).toBeDefined()
    expect(ore!.name).toBe('Iron Ore')
    expect(ore!.liquid).toBe(false)
  })

  it('loads fluids flagged as liquid', () => {
    expect(data.items.get('Desc_Water_C')!.liquid).toBe(true)
    expect(data.items.get('Desc_LiquidOil_C')!.liquid).toBe(true)
  })

  it('loads AWESOME Sink points per item', () => {
    expect(data.items.get('Desc_IronPlate_C')!.sinkPoints).toBeGreaterThan(0)
  })
})

describe('loadGameData: AWESOME Sink', () => {
  it('loads the sink building with wiki power (30 MW)', () => {
    expect(data.awesomeSink.name).toBe('AWESOME Sink')
    expect(data.awesomeSink.power).toBe(30)
  })
})

describe('loadGameData: recipes', () => {
  it('loads the default Iron Ingot recipe with its machine', () => {
    const recipes = data.recipesByProduct.get('Desc_IronIngot_C')!
    const def = recipes.find((r) => !r.alternate)!
    expect(def.name).toBe('Iron Ingot')
    expect(def.time).toBe(2)
    expect(def.ingredients).toEqual([{ item: 'Desc_OreIron_C', amount: 1 }])
    expect(def.products).toEqual([{ item: 'Desc_IronIngot_C', amount: 1 }])
    expect(def.machine).toBe('Desc_SmelterMk1_C')
  })

  it('lists default recipes before alternates', () => {
    const recipes = data.recipesByProduct.get('Desc_IronIngot_C')!
    expect(recipes.length).toBeGreaterThan(1)
    expect(recipes[0].alternate).toBe(false)
    expect(recipes.some((r) => r.name === 'Alternate: Pure Iron Ingot')).toBe(true)
  })

  it('never picks Unpackage recipes as the default (they are circular)', () => {
    const fuel = data.recipesByProduct.get('Desc_LiquidFuel_C')!
    expect(fuel[0].name).not.toMatch(/^Unpackage/)
    expect(fuel[0].alternate).toBe(false)
  })

  it('excludes build-gun and workshop-only recipes', () => {
    for (const r of data.recipes.values()) {
      expect(r.machine).toBeTruthy()
      expect(data.machines.has(r.machine)).toBe(true)
    }
  })
})

describe('loadGameData: machines', () => {
  it('loads Smelter with wiki power values', () => {
    const smelter = data.machines.get('Desc_SmelterMk1_C')!
    expect(smelter.name).toBe('Smelter')
    expect(smelter.power).toBe(4)
    expect(smelter.powerExponent).toBeCloseTo(1.321929, 5)
  })

  it('loads Constructor at 4 MW and Assembler at 15 MW', () => {
    expect(data.machines.get('Desc_ConstructorMk1_C')!.power).toBe(4)
    expect(data.machines.get('Desc_AssemblerMk1_C')!.power).toBe(15)
  })
})

describe('loadGameData: extractors', () => {
  it('loads miners Mk.1-3 with base rates 60/120/240 per minute', () => {
    expect(data.minersByTier.get(1)!.ratePerMin).toBe(60)
    expect(data.minersByTier.get(2)!.ratePerMin).toBe(120)
    expect(data.minersByTier.get(3)!.ratePerMin).toBe(240)
    expect(data.minersByTier.get(1)!.power).toBe(5)
    expect(data.minersByTier.get(2)!.power).toBe(15)
    expect(data.minersByTier.get(3)!.power).toBe(45)
  })

  it('loads the Oil Extractor: 120 m³/min, 40 MW', () => {
    expect(data.oilExtractor.ratePerMin).toBe(120)
    expect(data.oilExtractor.power).toBe(40)
    expect(data.oilExtractor.liquid).toBe(true)
  })

  it('loads the Water Extractor: 120 m³/min, 20 MW', () => {
    expect(data.waterExtractor.ratePerMin).toBe(120)
    expect(data.waterExtractor.power).toBe(20)
  })

  it('exposes node resources (miner ores + crude oil, not water)', () => {
    expect(data.nodeResources).toContain('Desc_OreIron_C')
    expect(data.nodeResources).toContain('Desc_LiquidOil_C')
    expect(data.nodeResources).not.toContain('Desc_Water_C')
  })
})
