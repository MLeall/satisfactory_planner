// The console's state: one plain object, so persisting it, sharing it and
// resetting it are all the same operation on the same value.

import type { ViewMode, WiringMode } from '../components/Schematic'
import type { PlanInput } from '../engine/solve'
import type { Purity } from '../engine/types'
import type { ManualLayout } from './manualLayout'

export type BuildMode = NonNullable<PlanInput['buildMode']>
export type PowerShards = NonNullable<PlanInput['powerShards']>

export interface NodeRow {
  key: number
  resource: string
  purity: Purity
  count: number
}

/** An item belted in from a factory that already exists, instead of built. */
export interface ImportRow {
  key: number
  item: string
  /** Free text: blank means "as much as this plan needs". Ignored while `from`
   * names a factory, since the rate then comes from that factory's output. */
  rate: string
  /** Id of one of your other factories, when this part comes from one of them
   * rather than from a rate you typed in. */
  from?: string
}

export interface OutputRow {
  key: number
  item: string
  /** Free text: blank means "plan the maximum these nodes sustain". */
  rate: string
}

export interface PlannerState {
  nodes: NodeRow[]
  imports: ImportRow[]
  minerTier: 1 | 2 | 3
  /** Best belt unlocked; every run picks the cheapest tier below it. */
  beltMk: number
  pipeMk: number
  outputs: OutputRow[]
  selection: Record<string, string>
  buildMode: BuildMode
  powerShards: PowerShards
  viewMode: ViewMode
  /** How the Complex view wires machines together. */
  wiringMode: WiringMode
  /** Label each belt segment with its throughput in the Complex view. */
  showRates: boolean
  layout: ManualLayout
}

export const STORAGE_KEY = 'ficsit-planner-v2'

export function defaults(): PlannerState {
  return {
    nodes: [{ key: 1, resource: 'Desc_OreIron_C', purity: 'normal', count: 1 }],
    imports: [],
    minerTier: 1,
    beltMk: 1,
    pipeMk: 1,
    outputs: [{ key: 1, item: 'Desc_IronPlate_C', rate: '' }],
    selection: {},
    buildMode: 'exact',
    powerShards: 0,
    viewMode: 'standard',
    wiringMode: 'tree',
    showRates: true,
    layout: {},
  }
}

/**
 * A stored value as a plan, with anything a newer build added filled in from
 * the defaults. Nonsense yields the defaults rather than a half-blank console.
 */
export function asPlan(value: unknown): PlannerState {
  if (typeof value !== 'object' || value === null) return defaults()
  return { ...defaults(), ...(value as Partial<PlannerState>) }
}

/** A row key not yet taken by a node or an output. */
export function nextKey(state: PlannerState): number {
  return (
    Math.max(
      0,
      ...state.nodes.map((n) => n.key),
      ...state.imports.map((i) => i.key),
      ...state.outputs.map((o) => o.key),
    ) + 1
  )
}
