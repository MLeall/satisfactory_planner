// Searching the alternate recipes for the ones that actually pay off.
//
// Every item in a chain can have several recipes, and the good combinations are
// not obvious: an alternate that halves the ore a stage eats can cost more of
// something else two stages up. The engine is pure and a solve is cheap, so the
// honest way to answer "which alternates should I use here?" is to try them.
//
// The search is coordinate ascent: hold everything fixed, try every recipe for
// one item, keep the best, move to the next item, and repeat until a whole pass
// changes nothing. The set of items to try is recomputed each pass, because
// swapping a recipe rewrites the chain — Cast Screw drops the rod stage and its
// choices with it, and picks up whatever the new ingredients bring in.

import { getChainItems } from './helpers'
import { solve, type PlanInput } from './solve'
import type { GameData, ItemId, RecipeId } from './types'

const EPS = 1e-9

/** Passes without an improvement stop the search; this only bounds the case
 * where each pass keeps finding a slightly better pick. */
const MAX_PASSES = 8

/**
 * What the search is trying to move, decided by the plan it is handed rather
 * than asked of the user: with the output rates blank the plan is free to grow,
 * so the interesting question is how much of it you can get; with the rates
 * pinned the output cannot move at all, so the question becomes what it costs.
 */
export type Objective =
  /** Blank output rates: push the outputs as high as the nodes allow. */
  | 'output'
  /** Fixed output rates: reach them off as few extractors as possible. */
  | 'raw'
  /** Fixed rates and nothing extracted at all: fall back to less power. */
  | 'power'

export interface RecipeChange {
  item: ItemId
  from: RecipeId
  to: RecipeId
}

export interface Optimization {
  /** The winning pick per item, ready to drop straight into `recipeSelection`. */
  selection: Record<ItemId, RecipeId>
  /** Only the picks that differ from the plan the search started with. */
  changes: RecipeChange[]
  objective: Objective
  /** How much better it got: 1.4 is 40% more output, or 40% fewer extractors,
   * depending on the objective. Exactly 1 when nothing beat the start. */
  improvement: number
  /** Plans evaluated, so the console can say how big a search this was. */
  solves: number
}

/** Higher `value` wins; equal value goes to the plan that draws less power, so
 * a swap that changes nothing else is never taken for free. */
interface Score {
  value: number
  powerMW: number
}

const beats = (a: Score, b: Score) =>
  a.value > b.value + EPS ||
  (a.value > b.value - EPS && a.powerMW < b.powerMW - EPS)

/** Extractor-equivalents at 100% clock: the fractional count, not the built
 * count, so a search step that shaves half a miner is still visible. */
function extractorLoad(stages: { kind: string; count: number }[]): number {
  return stages
    .filter((s) => s.kind === 'extractor')
    .reduce((sum, s) => sum + s.count, 0)
}

/**
 * The recipe the plan is really using for an item: the explicit pick when there
 * is one, the dataset's default otherwise. Needed so a "change" is reported
 * against what you would have built, not against an empty selection.
 */
export function effectiveRecipe(
  data: GameData,
  selection: Record<ItemId, RecipeId>,
  item: ItemId,
): RecipeId | undefined {
  return selection[item] ?? data.recipesByProduct.get(item)?.[0]?.id
}

/** Chain items worth trying alternatives for, under a given selection. */
function decisionPoints(
  data: GameData,
  input: PlanInput,
  selection: Record<ItemId, RecipeId>,
): ItemId[] {
  // Only a rateless import truly ends the chain. One with a rate still has
  // machines behind it covering the difference, and those machines still have
  // a recipe worth choosing.
  const leafImports = (input.imports ?? [])
    .filter((i) => i.rate === undefined || i.rate <= 0)
    .map((i) => i.item)

  const seen = new Set<ItemId>()
  for (const t of input.targets) {
    for (const id of getChainItems(data, t.item, selection, leafImports)) {
      seen.add(id)
    }
  }
  return [...seen].filter(
    (id) => (data.recipesByProduct.get(id)?.length ?? 0) > 1,
  )
}

/**
 * Hunt for the recipe selection that best serves the plan you already have.
 * Returns null when the plan does not solve as it stands, or when there is no
 * choice to make — there is nothing to say in either case.
 *
 * Deterministic: the same input always yields the same answer. Coordinate
 * ascent can settle on a local best rather than the global one, which is the
 * price of not enumerating a space that grows multiplicatively; in exchange it
 * costs a few hundred solves rather than a few million.
 */
export function optimizeRecipes(
  data: GameData,
  input: PlanInput,
): Optimization | null {
  const start: Record<ItemId, RecipeId> = { ...(input.recipeSelection ?? {}) }
  let solves = 0
  const evaluate = (selection: Record<ItemId, RecipeId>) => {
    solves++
    return solve(data, { ...input, recipeSelection: selection })
  }

  const first = evaluate(start)
  if (!first.ok) return null
  if (decisionPoints(data, input, start).length === 0) return null

  const baseRates = new Map(first.plan.targets.map((t) => [t.item, t.rate]))
  const baseLoad = extractorLoad(first.plan.stages)
  const basePower = first.plan.totalPowerMW

  const objective: Objective = input.targets.every(
    (t) => t.rate === undefined || t.rate <= 0,
  )
    ? 'output'
    : baseLoad > EPS
      ? 'raw'
      : 'power'

  /**
   * Every objective is scored as "times better than the plan we started from",
   * so the score is 1 at the start whichever one is in play and the improvement
   * is just the winning score. For output that is the *worst-off* target's
   * gain, not the average: a swap that doubles one output by halving another is
   * not an improvement, it is a different plan.
   */
  const scoreOf = (plan: {
    targets: { item: ItemId; rate: number }[]
    stages: { kind: string; count: number }[]
    totalPowerMW: number
  }): Score => {
    const powerMW = plan.totalPowerMW
    if (objective === 'output') {
      let worst = Infinity
      for (const t of plan.targets) {
        const base = baseRates.get(t.item) ?? 0
        if (base <= EPS) continue
        worst = Math.min(worst, t.rate / base)
      }
      return { value: Number.isFinite(worst) ? worst : 0, powerMW }
    }
    if (objective === 'raw') {
      return { value: baseLoad / Math.max(extractorLoad(plan.stages), EPS), powerMW }
    }
    return { value: basePower / Math.max(powerMW, EPS), powerMW }
  }

  let bestSelection = start
  let bestScore = scoreOf(first.plan)

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false
    for (const item of decisionPoints(data, input, bestSelection)) {
      const current = effectiveRecipe(data, bestSelection, item)
      for (const recipe of data.recipesByProduct.get(item) ?? []) {
        if (recipe.id === current) continue
        const trial = { ...bestSelection, [item]: recipe.id }
        const result = evaluate(trial)
        // An alternate can make the chain circular or reach for an ore you have
        // no node for. That is not a failure of the search, just a dead end.
        if (!result.ok) continue
        const score = scoreOf(result.plan)
        if (beats(score, bestScore)) {
          bestSelection = trial
          bestScore = score
          improved = true
        }
      }
    }
    if (!improved) break
  }

  const changes: RecipeChange[] = []
  for (const [item, to] of Object.entries(bestSelection)) {
    const from = effectiveRecipe(data, start, item)
    if (from !== undefined && from !== to) changes.push({ item, from, to })
  }

  return {
    selection: bestSelection,
    changes,
    objective,
    improvement: bestScore.value,
    solves,
  }
}
