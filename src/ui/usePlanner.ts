import { useEffect, useMemo, useState } from 'react'
import { loadGameData } from '../data/loader'
import { getChainItems, reachableTargets, reconcile } from '../engine/helpers'
import { solve, type SolveResult, type TargetOutput } from '../engine/solve'
import type { Recipe } from '../engine/types'
import {
  defaults,
  hydrate,
  nextKey,
  STORAGE_KEY,
  type PlannerState,
} from './plannerState'

export const data = loadGameData()

export const RESOURCE_OPTIONS = data.nodeResources
  .map((id) => ({ id, name: data.items.get(id)?.name ?? id }))
  .sort((a, b) => a.name.localeCompare(b.name))

export interface ItemOption {
  id: string
  name: string
}

export interface RecipeChoice extends ItemOption {
  recipes: Recipe[]
}

export interface Planner {
  state: PlannerState
  /** Merge a partial change into the state; everything else is preserved. */
  patch: (change: Partial<PlannerState>) => void
  reset: () => void
  /** Items reachable from the declared nodes. */
  targetOptions: ItemOption[]
  /** Chain items with more than one recipe, i.e. worth offering a swap. */
  recipeChoices: RecipeChoice[]
  /** Recipe actually in force per item, after reconciliation. */
  selection: Record<string, string>
  /** Output rows with unreachable items already swapped out. */
  outputs: PlannerState['outputs']
  /** Balanced max per output, so it stays visible while a rate is typed in. */
  maxRates: Map<string, number>
  result: SolveResult
  nextKey: number
}

function initialState(): PlannerState {
  if (typeof location === 'undefined') return defaults()
  let saved: string | null = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage unavailable — planning still works in-memory */
  }
  return hydrate(saved, location.hash.slice(1))
}

/**
 * All of the console's behaviour in one place: state, persistence, the cleanup
 * of choices the current nodes no longer support, and the two solves (the plan
 * itself, and the same chain at maximum for the MAX hints).
 */
export function usePlanner(): Planner {
  const [state, setState] = useState<PlannerState>(initialState)
  const patch = (change: Partial<PlannerState>) =>
    setState((s) => ({ ...s, ...change }))

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable — planning still works in-memory */
    }
  }, [state])

  // The plan is in our hands now, so drop it from the address bar: leaving it
  // there would show a link that goes stale the moment anything is edited.
  useEffect(() => {
    if (typeof location === 'undefined' || !location.hash) return
    history.replaceState(null, '', location.pathname + location.search)
  }, [])

  const { nodes, outputs, selection, minerTier, beltMk, pipeMk } = state
  const resources = useMemo(() => nodes.map((n) => n.resource), [nodes])

  const targetOptions = useMemo(
    () =>
      reachableTargets(data, resources)
        .map((id) => ({ id, name: data.items.get(id)?.name ?? id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [resources],
  )

  // Editing the nodes can strand an output item or an alternate recipe that the
  // remaining resources no longer reach. Reconcile first and plan off the
  // cleaned values, so the schematic follows the inputs instead of stalling on
  // an error until the user re-picks the recipe by hand.
  const clean = useMemo(
    () =>
      reconcile(
        data,
        resources,
        outputs.map((o) => o.item),
        selection,
      ),
    [resources, outputs, selection],
  )

  useEffect(() => {
    const swapped = outputs.some((o, i) => o.item !== clean.targets[i])
    if (clean.selection === selection && !swapped) return
    setState((s) => ({
      ...s,
      selection: clean.selection,
      outputs: s.outputs.map((o, i) => ({ ...o, item: clean.targets[i] ?? o.item })),
    }))
  }, [clean, selection, outputs])

  const effectiveOutputs = useMemo(
    () => outputs.map((o, i) => ({ ...o, item: clean.targets[i] ?? o.item })),
    [outputs, clean],
  )

  const recipeChoices = useMemo(() => {
    const ids = new Set<string>()
    for (const o of effectiveOutputs) {
      for (const id of getChainItems(data, o.item, clean.selection)) ids.add(id)
    }
    return [...ids]
      .map((id) => ({
        id,
        name: data.items.get(id)?.name ?? id,
        recipes: data.recipesByProduct.get(id) ?? [],
      }))
      .filter((c) => c.recipes.length > 1)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [effectiveOutputs, clean])

  const targets: TargetOutput[] = useMemo(
    () =>
      effectiveOutputs.map((o) => {
        const rate = Number(o.rate)
        return o.rate.trim() !== '' && rate > 0
          ? { item: o.item, rate }
          : { item: o.item }
      }),
    [effectiveOutputs],
  )

  // Everything both solves share, so the two never drift apart.
  const common = useMemo(
    () => ({
      nodes,
      minerTier,
      beltMk,
      pipeMk,
      recipeSelection: clean.selection,
      buildMode: state.buildMode,
      powerShards: state.powerShards,
    }),
    [nodes, minerTier, beltMk, pipeMk, clean, state.buildMode, state.powerShards],
  )

  const result = useMemo(
    () =>
      solve(data, {
        ...common,
        targets,
        // Whole-machine plans always sink their overflow; exact plans have
        // nothing but byproducts to sink, so they just report them.
        sinkOverflow: common.buildMode === 'whole',
      }),
    [common, targets],
  )

  // The same chain solved with every rate blank, so the MAX hint stays visible
  // (and stays the max) while a number is being dialled in.
  const maxRates = useMemo(() => {
    const rates = new Map<string, number>()
    const r = solve(data, {
      ...common,
      targets: effectiveOutputs.map((o) => ({ item: o.item })),
    })
    if (r.ok) for (const t of r.plan.targets) rates.set(t.item, t.rate)
    return rates
  }, [common, effectiveOutputs])

  return {
    state,
    patch,
    reset: () => {
      setState(defaults())
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
    },
    targetOptions,
    recipeChoices,
    selection: clean.selection,
    outputs: effectiveOutputs,
    maxRates,
    result,
    nextKey: nextKey(state),
  }
}
