// The console's state: one plain object, so persisting it, sharing it and
// resetting it are all the same operation on the same value.

import type { ViewMode, WiringMode } from '../components/Schematic'
import type { PlanInput } from '../engine/solve'
import type { Purity } from '../engine/types'
import type { ManualLayout } from './manualLayout'
import { decodeShare } from './share'

export type BuildMode = NonNullable<PlanInput['buildMode']>
export type PowerShards = NonNullable<PlanInput['powerShards']>

export interface NodeRow {
  key: number
  resource: string
  purity: Purity
  count: number
}

export interface OutputRow {
  key: number
  item: string
  /** Free text: blank means "plan the maximum these nodes sustain". */
  rate: string
}

export interface PlannerState {
  nodes: NodeRow[]
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
 * The plan to open with. A shared fragment wins over whatever this browser had
 * saved, since following the link is an explicit request to see that plan;
 * anything unparseable is ignored rather than allowed to blank the console.
 */
export function hydrate(saved: string | null, fragment: string): PlannerState {
  const shared = fragment ? decodeShare(fragment) : null
  if (shared) return { ...defaults(), ...(shared as Partial<PlannerState>) }
  if (!saved) return defaults()
  try {
    const parsed: unknown = JSON.parse(saved)
    if (typeof parsed !== 'object' || parsed === null) return defaults()
    return { ...defaults(), ...(parsed as Partial<PlannerState>) }
  } catch {
    return defaults()
  }
}

/** A row key not yet taken by a node or an output. */
export function nextKey(state: PlannerState): number {
  return (
    Math.max(
      0,
      ...state.nodes.map((n) => n.key),
      ...state.outputs.map((o) => o.key),
    ) + 1
  )
}
