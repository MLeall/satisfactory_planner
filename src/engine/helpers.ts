import type { GameData, ItemId, Recipe, RecipeId } from './types'

/**
 * Items producible from the given node resources (water always available):
 * fixpoint closure over all recipes, considering any recipe (default or
 * alternate) whose ingredients are fully available.
 */
export function reachableTargets(
  data: GameData,
  resources: ItemId[],
): ItemId[] {
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

  const water = new Set(data.waterExtractor.allowedResources)
  return [...available].filter(
    (id) => !water.has(id) && (resources.includes(id) || !data.nodeResources.includes(id)),
  )
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
