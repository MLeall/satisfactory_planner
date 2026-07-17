import { describe, it, expect } from 'vitest'
import { reachableTargets, getChainItems } from './helpers'
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
