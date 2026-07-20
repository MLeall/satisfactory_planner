import type { GameData, ItemId, Recipe, RecipeId } from './types'

/**
 * Everything obtainable from the given node resources (water always available):
 * fixpoint closure over all recipes, considering any recipe (default or
 * alternate) whose ingredients are fully available.
 */
function availableItems(data: GameData, resources: ItemId[]): Set<ItemId> {
  const available = new Set<ItemId>(resources)
  for (const w of data.waterExtractor.allowedResources) available.add(w)

  let grew = true
  while (grew) {
    grew = false
    for (const recipe of data.recipes.values()) {
      if (recipe.ingredients.some((i) => !available.has(i.item))) continue
      for (const p of recipe.products) {
        if (!available.has(p.item)) {
          available.add(p.item)
          grew = true
        }
      }
    }
  }
  return available
}

/** Items the user may pick as an output: everything reachable, minus water and
 * minus raw resources they have no node for. */
export function reachableTargets(
  data: GameData,
  resources: ItemId[],
): ItemId[] {
  const available = availableItems(data, resources)
  const water = new Set(data.waterExtractor.allowedResources)
  return [...available].filter(
    (id) => !water.has(id) && (resources.includes(id) || !data.nodeResources.includes(id)),
  )
}

export interface Reconciled {
  targets: ItemId[]
  selection: Record<ItemId, RecipeId>
}

/**
 * Drop console state that the current set of nodes no longer supports: output
 * items that became unreachable and recipe overrides whose ingredients are no
 * longer obtainable. Without this the planner keeps solving against a stale
 * pick and only reports "no node supplies X", leaving the user to hunt down the
 * recipe by hand.
 *
 * Returns the original arrays/objects by identity when nothing changed, so
 * callers can feed the result straight back into state without looping.
 */
export function reconcile(
  data: GameData,
  resources: ItemId[],
  targets: ItemId[],
  selection: Record<ItemId, RecipeId>,
): Reconciled {
  const available = availableItems(data, resources)

  const usable = (item: ItemId, recipeId: RecipeId): boolean => {
    const recipe = data.recipes.get(recipeId)
    if (!recipe || !recipe.products.some((p) => p.item === item)) return false
    return recipe.ingredients.every((i) => available.has(i.item))
  }
  const kept = Object.entries(selection).filter(([item, id]) => usable(item, id))
  const nextSelection =
    kept.length === Object.keys(selection).length
      ? selection
      : Object.fromEntries(kept)

  // Reconcile against the option list the console actually offers, not the raw
  // closure: an item can be craftable yet still be an ore we have no node for.
  const options = new Set(reachableTargets(data, resources))
  const [fallback] = options
  // With no reachable item at all there is nothing better to offer; leave the
  // target alone and let the solver explain what is missing.
  const nextTargets =
    fallback === undefined || targets.every((t) => options.has(t))
      ? targets
      : targets.map((t) => (options.has(t) ? t : fallback))

  return { targets: nextTargets, selection: nextSelection }
}

function chooseRecipe(
  data: GameData,
  id: ItemId,
  selection: Record<ItemId, RecipeId>,
): Recipe | undefined {
  const selected = selection[id]
  if (selected) {
    const recipe = data.recipes.get(selected)
    if (recipe?.products.some((p) => p.item === id)) return recipe
  }
  return data.recipesByProduct.get(id)?.[0]
}

/**
 * Crafted items in the current chain (target first, ingredients after their
 * consumers). Raw resources and water excluded. Tolerates cycles.
 */
export function getChainItems(
  data: GameData,
  targetItem: ItemId,
  selection: Record<ItemId, RecipeId>,
): ItemId[] {
  const isRaw = (id: ItemId) =>
    data.nodeResources.includes(id) ||
    data.waterExtractor.allowedResources.includes(id)

  const result: ItemId[] = []
  const seen = new Set<ItemId>()
  const queue: ItemId[] = [targetItem]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id) || isRaw(id)) continue
    seen.add(id)
    const recipe = chooseRecipe(data, id, selection)
    if (!recipe) continue
    result.push(id)
    for (const ing of recipe.ingredients) queue.push(ing.item)
  }
  return result
}
