// Several factories at once, and the belts running between them.
//
// A plan on its own answers "what do I build here". Once you can import a part
// instead of making it, the question becomes "and where does that part come
// from", and the honest answer is usually another factory you have already
// planned. So the console holds a library of named plans rather than one plan,
// and an import row can name the factory it draws on instead of a rate: the
// rate is then whatever that factory actually produces, and it follows along
// when you change it.

import { reconcile } from '../engine/helpers'
import type { PlanInput, TargetOutput } from '../engine/solve'
import { solve } from '../engine/solve'
import type { GameData, ItemId } from '../engine/types'
import { asPlan, defaults, type ImportRow, type PlannerState } from './plannerState'
import { decodeShare } from './share'

export interface Factory {
  /** Stable for the life of the factory: import rows point at it. */
  id: string
  name: string
  plan: PlannerState
}

export interface Library {
  factories: Factory[]
  activeId: string
}

/** What each factory produces, per item, keyed by factory id. */
export type Sources = Map<string, Map<ItemId, number>>

/** Where an import row goes to find out what its source factory makes. Passed
 * as a function rather than the map itself so the resolver can hand over its
 * own half-built recursion without pretending to be a finished Map. */
export type SourceLookup = (factoryId: string) => Map<ItemId, number> | undefined

export const lookupIn =
  (sources: Sources): SourceLookup =>
  (id) =>
    sources.get(id)

export function defaultLibrary(): Library {
  return {
    factories: [{ id: 'f1', name: 'Factory 1', plan: defaults() }],
    activeId: 'f1',
  }
}

/** Lowest unused id. Deliberately not random: the same library always renders
 * the same, and a shared link keeps pointing at the factory it meant. */
function nextId(factories: Factory[]): string {
  const used = new Set(factories.map((f) => f.id))
  for (let i = 1; ; i++) if (!used.has(`f${i}`)) return `f${i}`
}

export function activePlan(lib: Library): PlannerState {
  const found = lib.factories.find((f) => f.id === lib.activeId)
  return found?.plan ?? lib.factories[0]?.plan ?? defaults()
}

export function activeFactory(lib: Library): Factory {
  return (
    lib.factories.find((f) => f.id === lib.activeId) ??
    lib.factories[0] ?? { id: 'f1', name: 'Factory 1', plan: defaults() }
  )
}

/** Merge a change into the plan of the factory currently being edited. */
export function patchActive(
  lib: Library,
  change: Partial<PlannerState>,
): Library {
  return {
    ...lib,
    factories: lib.factories.map((f) =>
      f.id === lib.activeId ? { ...f, plan: { ...f.plan, ...change } } : f,
    ),
  }
}

export function addFactory(lib: Library): Library {
  const id = nextId(lib.factories)
  const name = `Factory ${lib.factories.length + 1}`
  return {
    factories: [...lib.factories, { id, name, plan: defaults() }],
    activeId: id,
  }
}

export function renameFactory(
  lib: Library,
  id: string,
  name: string,
): Library {
  return {
    ...lib,
    factories: lib.factories.map((f) => (f.id === id ? { ...f, name } : f)),
  }
}

/**
 * Drop a factory, and cut the belts that ran from it: an import row pointing at
 * something that no longer exists keeps the rate it was last resolved at and
 * becomes an ordinary typed-in import, rather than silently delivering nothing.
 */
export function removeFactory(
  lib: Library,
  id: string,
  sources: SourceLookup = () => undefined,
): Library {
  const kept = lib.factories.filter((f) => f.id !== id)
  if (kept.length === 0) return defaultLibrary()
  const detached = kept.map((f) => ({
    ...f,
    plan: {
      ...f.plan,
      imports: f.plan.imports.map((row) =>
        row.from === id
          ? {
              key: row.key,
              item: row.item,
              rate: String(sources(id)?.get(row.item) ?? 0),
            }
          : row,
      ),
    },
  }))
  return {
    factories: detached,
    activeId: detached.some((f) => f.id === lib.activeId)
      ? lib.activeId
      : detached[0].id,
  }
}

/**
 * What an import row delivers. A row naming one of your factories takes
 * whatever that factory produces of the item — nothing when it produces none,
 * which is the truthful answer and shows up as a shortfall. Otherwise it is the
 * rate typed in, and undefined means "as much as this plan needs".
 */
export function importRate(
  row: ImportRow,
  sources: SourceLookup,
): number | undefined {
  if (row.from) return sources(row.from)?.get(row.item) ?? 0
  const rate = Number(row.rate)
  return row.rate.trim() !== '' && rate > 0 ? rate : undefined
}

/**
 * A stored plan as the engine wants it. Everything that decides what gets
 * solved lives here and nowhere else, so a factory's advertised output is
 * always the output of the very same plan its own schematic draws.
 */
export function planInputOf(
  data: GameData,
  plan: PlannerState,
  sources: SourceLookup,
): PlanInput {
  const resources = plan.nodes.map((n) => n.resource)
  const importItems = plan.imports.map((i) => i.item)
  const clean = reconcile(
    data,
    resources,
    plan.outputs.map((o) => o.item),
    plan.selection,
    importItems,
  )
  const targets: TargetOutput[] = plan.outputs.map((o, i) => {
    const item = clean.targets[i] ?? o.item
    const rate = Number(o.rate)
    return o.rate.trim() !== '' && rate > 0 ? { item, rate } : { item }
  })
  return {
    nodes: plan.nodes,
    imports: plan.imports.map((row) => {
      const rate = importRate(row, sources)
      return rate === undefined ? { item: row.item } : { item: row.item, rate }
    }),
    minerTier: plan.minerTier,
    beltMk: plan.beltMk,
    pipeMk: plan.pipeMk,
    targets,
    recipeSelection: clean.selection,
    buildMode: plan.buildMode,
    powerShards: plan.powerShards,
    // Whole-machine plans always sink their overflow; exact plans have nothing
    // but byproducts to sink, so they just report them.
    sinkOverflow: plan.buildMode === 'whole',
  }
}

/**
 * What every factory produces, resolved depth-first because a factory's output
 * depends on what it imports. A cycle — A feeding B feeding A — is cut by
 * treating the way back as delivering nothing, so a wiring mistake surfaces as
 * a shortfall in the plan instead of hanging the page.
 */
export function resolveOutputs(data: GameData, lib: Library): Sources {
  const byId = new Map(lib.factories.map((f) => [f.id, f]))
  const done: Sources = new Map()
  const visiting = new Set<string>()

  const outputsOf = (id: string): Map<ItemId, number> => {
    const cached = done.get(id)
    if (cached) return cached
    const factory = byId.get(id)
    // Not cached on the way back through a cycle: the outer call still has to
    // compute this factory properly once it unwinds.
    if (!factory || visiting.has(id)) return new Map()
    visiting.add(id)
    const result = solve(data, planInputOf(data, factory.plan, outputsOf))
    visiting.delete(id)
    const produced = new Map<ItemId, number>()
    if (result.ok) {
      for (const t of result.plan.targets) produced.set(t.item, t.rate)
    }
    done.set(id, produced)
    return produced
  }

  for (const f of lib.factories) outputsOf(f.id)
  return done
}

export interface Oversubscription {
  /** The factory being drawn on. */
  from: string
  item: ItemId
  /** Names of the factories drawing on it. */
  consumers: string[]
}

/**
 * Two factories both drawing on the same output of a third are each planned as
 * if they had all of it, because neither knows about the other. The belt cannot
 * say so, and the solver has no reason to, so the library does.
 */
export function oversubscriptions(lib: Library): Oversubscription[] {
  const drawn = new Map<string, string[]>()
  for (const f of lib.factories) {
    for (const row of f.plan.imports) {
      if (!row.from) continue
      const key = `${row.from} ${row.item}`
      const list = drawn.get(key) ?? []
      // One factory listing the same source twice is its own business.
      if (!list.includes(f.name)) list.push(f.name)
      drawn.set(key, list)
    }
  }
  const result: Oversubscription[] = []
  for (const [key, consumers] of drawn) {
    if (consumers.length < 2) continue
    const [from, item] = key.split(' ')
    result.push({ from, item, consumers })
  }
  return result
}

/** A stored or shared value as a library. Anything unparseable falls back to a
 * fresh one rather than being allowed to blank the console. A value written
 * before there were several factories is a bare plan; it becomes the single
 * factory of a new library instead of being thrown away. */
function asLibrary(value: unknown): Library | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Partial<Library> & Partial<PlannerState>
  if (Array.isArray(raw.factories)) {
    const factories = raw.factories
      .filter((f): f is Factory => typeof f === 'object' && f !== null)
      .map((f, i) => ({
        id: typeof f.id === 'string' ? f.id : `f${i + 1}`,
        name: typeof f.name === 'string' ? f.name : `Factory ${i + 1}`,
        plan: asPlan(f.plan),
      }))
    if (factories.length === 0) return null
    const active = factories.some((f) => f.id === raw.activeId)
    return { factories, activeId: active ? raw.activeId! : factories[0].id }
  }
  if (!Array.isArray(raw.outputs) && !Array.isArray(raw.nodes)) return null
  return {
    factories: [{ id: 'f1', name: 'Factory 1', plan: asPlan(value) }],
    activeId: 'f1',
  }
}

/**
 * The library to open with. A shared fragment wins over whatever this browser
 * had saved, since following the link is an explicit request to see that plan;
 * anything unparseable is ignored rather than allowed to blank the console.
 */
export function hydrateLibrary(
  saved: string | null,
  fragment: string,
): Library {
  const shared = fragment ? asLibrary(decodeShare(fragment)) : null
  if (shared) return shared
  if (!saved) return defaultLibrary()
  try {
    return asLibrary(JSON.parse(saved)) ?? defaultLibrary()
  } catch {
    return defaultLibrary()
  }
}
