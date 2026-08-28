import { useEffect, useMemo, useState } from 'react'
import { loadGameData } from '../data/loader'
import { getChainItems, reachableTargets, reconcile } from '../engine/helpers'
import { optimizeRecipes, type Optimization } from '../engine/optimize'
import { solve, type SolveResult } from '../engine/solve'
import type { Recipe } from '../engine/types'
import {
  activeFactory,
  addFactory,
  defaultLibrary,
  hydrateLibrary,
  lookupIn,
  oversubscriptions,
  patchActive,
  planInputOf,
  removeFactory,
  renameFactory,
  resolveOutputs,
  type Library,
  type Oversubscription,
  type Sources,
} from './library'
import { nextKey, STORAGE_KEY, type PlannerState } from './plannerState'

export const data = loadGameData()

export const RESOURCE_OPTIONS = data.nodeResources
  .map((id) => ({ id, name: data.items.get(id)?.name ?? id }))
  .sort((a, b) => a.name.localeCompare(b.name))

/** What can be imported: anything a machine produces, plus the ores themselves.
 * Deliberately not filtered by what the declared nodes reach — the whole point
 * of an import is that it comes from a factory these nodes know nothing about. */
export const IMPORT_OPTIONS = [
  ...new Set([...data.recipesByProduct.keys(), ...data.nodeResources]),
]
  .map((id) => ({ id, name: data.items.get(id)?.name ?? id }))
  .sort((a, b) => a.name.localeCompare(b.name))

export interface ItemOption {
  id: string
  name: string
}

export interface RecipeChoice extends ItemOption {
  recipes: Recipe[]
}

/** What the last recipe search came back with. `none` means the chain offered
 * no choice at all; `unchanged` means it did, and nothing beat what is there. */
export type OptimizeOutcome =
  | { kind: 'applied'; result: Optimization }
  | { kind: 'unchanged' }
  | { kind: 'none' }

export interface Planner {
  /** Every factory, and which one is being edited. */
  library: Library
  /** The plan of the factory being edited. */
  state: PlannerState
  /** Merge a partial change into that plan; everything else is preserved. */
  patch: (change: Partial<PlannerState>) => void
  reset: () => void

  factories: { id: string; name: string }[]
  activeId: string
  activeName: string
  selectFactory: (id: string) => void
  newFactory: () => void
  renameActive: (name: string) => void
  deleteFactory: (id: string) => void
  /** What each of your factories produces: what an import may draw on. */
  sources: Sources
  /** Factories drawing on one output of a third, each planned as if alone. */
  oversubscribed: Oversubscription[]

  /** Items reachable from the declared nodes and imports. */
  targetOptions: ItemOption[]
  /** Crafted items of the current chain, deepest ingredient first: the things
   * it would make sense to import instead of building. */
  chainItems: ItemOption[]
  /** Chain items with more than one recipe, i.e. worth offering a swap. */
  recipeChoices: RecipeChoice[]
  /** Recipe actually in force per item, after reconciliation. */
  selection: Record<string, string>
  /** Output rows with unreachable items already swapped out. */
  outputs: PlannerState['outputs']
  /** Balanced max per output, so it stays visible while a rate is typed in. */
  maxRates: Map<string, number>
  /** Search the alternate recipes and apply the best combination found. */
  optimize: () => void
  /** What that search came back with, cleared by the next edit. */
  optimization: OptimizeOutcome | null
  result: SolveResult
  nextKey: number
}

function initialLibrary(): Library {
  if (typeof location === 'undefined') return defaultLibrary()
  let saved: string | null = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage unavailable — planning still works in-memory */
  }
  return hydrateLibrary(saved, location.hash.slice(1))
}

/**
 * All of the console's behaviour in one place: the library of factories, their
 * persistence, the cleanup of choices the current nodes no longer support, and
 * the solves — the active plan, the same chain at maximum for the MAX hints,
 * and every other factory, because an import has to know what its source
 * really produces.
 */
export function usePlanner(): Planner {
  const [library, setLibrary] = useState<Library>(initialLibrary)
  const [optimization, setOptimization] = useState<OptimizeOutcome | null>(null)

  const factory = activeFactory(library)
  const state = factory.plan

  const patch = (change: Partial<PlannerState>) => {
    // Any edit can move what the best recipes are, so the last answer stops
    // being one rather than sitting there going quietly stale.
    setOptimization(null)
    setLibrary((l) => patchActive(l, change))
  }

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(library))
    } catch {
      /* storage unavailable — planning still works in-memory */
    }
  }, [library])

  // The plan is in our hands now, so drop it from the address bar: leaving it
  // there would show a link that goes stale the moment anything is edited.
  useEffect(() => {
    if (typeof location === 'undefined' || !location.hash) return
    history.replaceState(null, '', location.pathname + location.search)
  }, [])

  // Every factory's output, so an import row can be told what it may draw on.
  // Solving the others is what lets a change in one factory reach the plans
  // buying from it on the very same keystroke.
  const sources = useMemo(() => resolveOutputs(data, library), [library])

  const { nodes, outputs, selection, imports } = state
  const resources = useMemo(() => nodes.map((n) => n.resource), [nodes])
  const importItems = useMemo(() => imports.map((i) => i.item), [imports])
  // Only an import with no rate ends the chain. One with a rate still has
  // machines behind it covering the difference, and those machines still have a
  // recipe worth choosing, so the chain has to keep them.
  const leafImportItems = useMemo(
    () =>
      imports.filter((i) => !i.from && !(Number(i.rate) > 0)).map((i) => i.item),
    [imports],
  )

  const targetOptions = useMemo(
    () =>
      reachableTargets(data, resources, importItems)
        .map((id) => ({ id, name: data.items.get(id)?.name ?? id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [resources, importItems],
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
        importItems,
      ),
    [resources, outputs, selection, importItems],
  )

  useEffect(() => {
    const swapped = outputs.some((o, i) => o.item !== clean.targets[i])
    if (clean.selection === selection && !swapped) return
    setLibrary((l) =>
      patchActive(l, {
        selection: clean.selection,
        outputs: outputs.map((o, i) => ({
          ...o,
          item: clean.targets[i] ?? o.item,
        })),
      }),
    )
  }, [clean, selection, outputs])

  const effectiveOutputs = useMemo(
    () => outputs.map((o, i) => ({ ...o, item: clean.targets[i] ?? o.item })),
    [outputs, clean],
  )

  const chainItems = useMemo(() => {
    const ids = new Set<string>()
    for (const o of effectiveOutputs) {
      const chain = getChainItems(data, o.item, clean.selection, leafImportItems)
      for (const id of chain) ids.add(id)
    }
    // getChainItems lists consumers before their ingredients; reversed, the
    // deepest ingredient comes first — the part you are likeliest to already
    // have a factory for, so it makes the best default for a new import row.
    return [...ids]
      .reverse()
      .map((id) => ({ id, name: data.items.get(id)?.name ?? id }))
  }, [effectiveOutputs, clean, leafImportItems])

  const recipeChoices = useMemo(
    () =>
      chainItems
        .map((c) => ({ ...c, recipes: data.recipesByProduct.get(c.id) ?? [] }))
        .filter((c) => c.recipes.length > 1)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [chainItems],
  )

  // One translation of the console into engine input, shared with the resolver
  // that works out what every factory produces — so what this schematic draws
  // is exactly what the factories buying from it are told they can have.
  const input = useMemo(
    () => planInputOf(data, state, lookupIn(sources)),
    [state, sources],
  )

  const result = useMemo(() => solve(data, input), [input])

  // The same chain solved with every rate blank, so the MAX hint stays visible
  // (and stays the max) while a number is being dialled in.
  const maxRates = useMemo(() => {
    const rates = new Map<string, number>()
    const r = solve(data, {
      ...input,
      targets: input.targets.map((t) => ({ item: t.item })),
    })
    if (r.ok) for (const t of r.plan.targets) rates.set(t.item, t.rate)
    return rates
  }, [input])

  const oversubscribed = useMemo(() => oversubscriptions(library), [library])

  const optimize = () => {
    const found = optimizeRecipes(data, input)
    if (!found) {
      setOptimization({ kind: 'none' })
      return
    }
    if (found.changes.length === 0) {
      setOptimization({ kind: 'unchanged' })
      return
    }
    setOptimization({ kind: 'applied', result: found })
    setLibrary((l) => patchActive(l, { selection: found.selection }))
  }

  return {
    library,
    state,
    patch,
    reset: () => {
      setOptimization(null)
      setLibrary(defaultLibrary())
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
    },
    factories: library.factories.map((f) => ({ id: f.id, name: f.name })),
    activeId: factory.id,
    activeName: factory.name,
    selectFactory: (id) => {
      setOptimization(null)
      setLibrary((l) => ({ ...l, activeId: id }))
    },
    newFactory: () => {
      setOptimization(null)
      setLibrary(addFactory)
    },
    renameActive: (name) =>
      setLibrary((l) => renameFactory(l, l.activeId, name)),
    deleteFactory: (id) =>
      setLibrary((l) => removeFactory(l, id, lookupIn(sources))),
    sources,
    oversubscribed,
    targetOptions,
    chainItems,
    recipeChoices,
    selection: clean.selection,
    outputs: effectiveOutputs,
    maxRates,
    optimize,
    optimization,
    result,
    nextKey: nextKey(state),
  }
}
