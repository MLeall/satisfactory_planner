import { describe, it, expect } from 'vitest'
import { reachableTargets, getChainItems, reconcile } from './helpers'
import { loadGameData } from '../data/loader'

const data = loadGameData()

describe('reachableTargets', () => {
  it('includes the raw resource itself and its direct products', () => {
    const targets = reachableTargets(data, ['Desc_OreIron_C'])
    expect(targets).toContain('Desc_OreIron_C')
    expect(targets).toContain('Desc_IronIngot_C')
    expect(targets).toContain('Desc_IronPlate_C')
    expect(targets).toContain('Desc_IronPlateReinforced_C')
  })

  it('excludes items needing unavailable resources', () => {
    const targets = reachableTargets(data, ['Desc_OreIron_C'])
    expect(targets).not.toContain('Desc_CopperIngot_C')
    expect(targets).not.toContain('Desc_CopperSheet_C')
  })

  it('treats water as always available (chains via alternates)', () => {
    // Alternate: Pure Iron Ingot uses water + iron ore in a Refinery
    const targets = reachableTargets(data, ['Desc_OreIron_C'])
    expect(targets).toContain('Desc_IronIngot_C')
  })

  it('unlocks more items when more resources are supplied', () => {
    const ironOnly = reachableTargets(data, ['Desc_OreIron_C'])
    const ironCopper = reachableTargets(data, [
      'Desc_OreIron_C',
      'Desc_OreCopper_C',
    ])
    expect(ironCopper).toContain('Desc_Cable_C')
    expect(ironCopper.length).toBeGreaterThan(ironOnly.length)
  })

  it('returns only water-producible items for no resources', () => {
    const targets = reachableTargets(data, [])
    expect(targets).not.toContain('Desc_IronIngot_C')
  })
})

describe('getChainItems', () => {
  it('lists crafted items of the default chain, consumers before producers', () => {
    const chain = getChainItems(data, 'Desc_IronPlateReinforced_C', {})
    expect(chain[0]).toBe('Desc_IronPlateReinforced_C')
    expect(chain).toContain('Desc_IronPlate_C')
    expect(chain).toContain('Desc_IronScrew_C')
    expect(chain).toContain('Desc_IronRod_C')
    expect(chain).toContain('Desc_IronIngot_C')
    expect(chain).not.toContain('Desc_OreIron_C') // raw, not crafted
  })

  it('reflects the recipe selection', () => {
    // Alternate: Cast Screw makes screws directly from ingots (no rods)
    const castScrew = data.recipesByProduct
      .get('Desc_IronScrew_C')!
      .find((r) => r.name === 'Alternate: Cast Screw')!
    const chain = getChainItems(data, 'Desc_IronPlateReinforced_C', {
      Desc_IronScrew_C: castScrew.id,
    })
    expect(chain).not.toContain('Desc_IronRod_C')
  })

  it('does not loop on circular selections', () => {
    // Just needs to terminate and include the target
    const chain = getChainItems(data, 'Desc_Plastic_C', {})
    expect(chain).toContain('Desc_Plastic_C')
  })
})

describe('reconcile', () => {
  // Alternate: Iron Alloy Ingot needs iron ore AND copper ore.
  const IRON_ALLOY = 'Recipe_Alternate_IngotIron_C'

  it('keeps a selection whose ingredients are all still supplied', () => {
    const { selection } = reconcile(
      data,
      ['Desc_OreIron_C', 'Desc_OreCopper_C'],
      ['Desc_IronPlate_C'],
      { Desc_IronIngot_C: IRON_ALLOY },
    )
    expect(selection).toEqual({ Desc_IronIngot_C: IRON_ALLOY })
  })

  it('drops a selection stranded by a removed node', () => {
    const { selection } = reconcile(data, ['Desc_OreIron_C'], ['Desc_IronPlate_C'], {
      Desc_IronIngot_C: IRON_ALLOY,
    })
    expect(selection).toEqual({})
  })

  it('drops selections pointing at a missing or mismatched recipe', () => {
    const { selection } = reconcile(data, ['Desc_OreIron_C'], ['Desc_IronPlate_C'], {
      Desc_IronIngot_C: 'Recipe_DoesNotExist_C',
      Desc_IronPlate_C: 'Recipe_IngotIron_C', // does not produce Iron Plate
    })
    expect(selection).toEqual({})
  })

  it('falls back to a reachable item when a target is stranded', () => {
    // Copper Ingot is unreachable from iron alone (Cable is not: see the
    // Alternate: Iron Wire recipe).
    const { targets } = reconcile(
      data,
      ['Desc_OreIron_C'],
      ['Desc_CopperIngot_C'],
      {},
    )
    expect(targets).toHaveLength(1)
    expect(targets[0]).not.toBe('Desc_CopperIngot_C')
    expect(reachableTargets(data, ['Desc_OreIron_C'])).toContain(targets[0])
  })

  it('reconciles against the offered options, not raw craftability', () => {
    // Copper Ore is craftable via Converter recipes, but with no copper node it
    // is not an option the console offers, so it must not survive as a target.
    const { targets } = reconcile(
      data,
      ['Desc_OreIron_C'],
      ['Desc_OreCopper_C'],
      {},
    )
    expect(targets[0]).not.toBe('Desc_OreCopper_C')
  })

  it('leaves reachable targets untouched', () => {
    const { targets } = reconcile(
      data,
      ['Desc_OreIron_C'],
      ['Desc_IronPlate_C', 'Desc_IronRod_C'],
      {},
    )
    expect(targets).toEqual(['Desc_IronPlate_C', 'Desc_IronRod_C'])
  })

  it('returns the same object identity when nothing changed', () => {
    const targets = ['Desc_IronPlate_C']
    const selection = { Desc_IronIngot_C: 'Recipe_Alternate_PureIronIngot_C' }
    const out = reconcile(data, ['Desc_OreIron_C'], targets, selection)
    expect(out.targets).toBe(targets)
    expect(out.selection).toBe(selection)
  })
})
