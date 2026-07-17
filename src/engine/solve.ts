import {
  BELT_TIERS,
  PIPE_TIERS,
  PURITY_MULTIPLIER,
  type Extractor,
  type GameData,
  type ItemId,
  type MachineId,
  type Purity,
  type Recipe,
  type RecipeId,
} from './types'

export interface NodeInput {
  resource: ItemId
  purity: Purity
  count: number
}

export interface PlanInput {
  nodes: NodeInput[]
  minerTier: 1 | 2 | 3
  beltMk: number
  pipeMk: number
  targetItem: ItemId
  /** Per-item recipe override (default recipe when absent) */
  recipeSelection?: Record<ItemId, RecipeId>
}

export interface Flow {
  item: ItemId
  rate: number
}

export interface Stage {
  id: string
  kind: 'extractor' | 'machine' | 'storage'
  machineId: MachineId | null
  machineName: string
  recipeId?: RecipeId
  recipeName?: string
  /** Exact machines needed (fractional) */
  count: number
  /** Machines to build: ceil(count) */
  machinesBuilt: number
  /** Clock % of the last (partial) machine; 100 when count is whole */
  lastClockPercent: number
  powerMW: number
  inputs: Flow[]
  outputs: Flow[]
  depth: number
}

export interface Edge {
  from: string
  to: string
  item: ItemId
  rate: number
  transport: 'belt' | 'pipe'
  lanes: number
}

export interface Plan {
  stages: Stage[]
  edges: Edge[]
  targetRate: number
  limitingResource: ItemId | null
  totalPowerMW: number
  surplus: Flow[]
}

export type SolveResult =
  | { ok: true; plan: Plan }
  | { ok: false; errors: string[] }

const DEFAULT_POWER_EXPONENT = 1.321929
const EPS = 1e-9

function fail(...errors: string[]): SolveResult {
  return { ok: false, errors }
}

/** Effective machine power for a stage of `count` machines: whole machines at
 * 100% plus one machine underclocked to the fractional remainder. */
function stagePower(count: number, power: number, exponent: number): number {
  const whole = Math.floor(count + EPS)
  const frac = count - whole
  return whole * power + (frac > EPS ? power * Math.pow(frac, exponent) : 0)
}

function splitMachines(count: number): { built: number; lastClock: number } {
  const whole = Math.floor(count + EPS)
  const frac = count - whole
  if (frac <= EPS) return { built: whole, lastClock: 100 }
  return { built: whole + 1, lastClock: frac * 100 }
}

export function solve(data: GameData, input: PlanInput): SolveResult {
  const itemName = (id: ItemId) => data.items.get(id)?.name ?? id
  const isLiquid = (id: ItemId) => data.items.get(id)?.liquid ?? false
  const beltSpeed = BELT_TIERS.find((b) => b.mk === input.beltMk)?.speed
  const pipeSpeed = PIPE_TIERS.find((p) => p.mk === input.pipeMk)?.speed
  if (!beltSpeed || !pipeSpeed) return fail('Invalid belt or pipe tier.')
  const transportSpeed = (item: ItemId) =>
    isLiquid(item) ? pipeSpeed : beltSpeed

  // A raw item is extracted, never crafted (ignores Converter ore recipes).
  const isWater = (id: ItemId) =>
    data.waterExtractor.allowedResources.includes(id)
  const isRaw = (id: ItemId) => isWater(id) || data.nodeResources.includes(id)

  const chooseRecipe = (id: ItemId): Recipe | undefined => {
    const selected = input.recipeSelection?.[id]
    if (selected) {
      const recipe = data.recipes.get(selected)
      if (recipe?.products.some((p) => p.item === id)) return recipe
    }
    return data.recipesByProduct.get(id)?.[0]
  }

  // --- 1. Build the recipe closure from the target (cycle-checked) ---------
  const recipeFor = new Map<ItemId, Recipe>()
  const postOrder: ItemId[] = [] // ingredients before their consumers
  const visiting = new Set<ItemId>()
  const visited = new Set<ItemId>()
  const errors: string[] = []

  const visit = (id: ItemId): void => {
    if (visited.has(id) || isRaw(id)) return
    if (visiting.has(id)) {
      errors.push(
        `Circular recipe chain detected at ${itemName(id)}. ` +
          'Pick a different alternate recipe.',
      )
      return
    }
    visiting.add(id)
    const recipe = chooseRecipe(id)
    if (!recipe) {
      errors.push(`No recipe produces ${itemName(id)}.`)
    } else {
      recipeFor.set(id, recipe)
      for (const ing of recipe.ingredients) visit(ing.item)
    }
    visiting.delete(id)
    visited.add(id)
    postOrder.push(id)
  }
  visit(input.targetItem)
  if (errors.length > 0) return fail(...errors)

  const consumersFirst = [...postOrder].reverse()

  // --- 2. Demand per 1 target/min, to find raw requirements ----------------
  const demandPerUnit = new Map<ItemId, number>()
  demandPerUnit.set(input.targetItem, 1)
  for (const id of consumersFirst) {
    const recipe = recipeFor.get(id)
    if (!recipe) continue
    const demand = demandPerUnit.get(id) ?? 0
    if (demand <= EPS) continue
    const prodAmount = recipe.products.find((p) => p.item === id)!.amount
    const runs = demand / prodAmount
    for (const ing of recipe.ingredients) {
      demandPerUnit.set(
        ing.item,
        (demandPerUnit.get(ing.item) ?? 0) + runs * ing.amount,
      )
    }
  }

  // --- 3. Node supply -------------------------------------------------------
  const extractorFor = (resource: ItemId): Extractor | undefined => {
    if (data.oilExtractor.allowedResources.includes(resource)) {
      return data.oilExtractor
    }
    const miner = data.minersByTier.get(input.minerTier)
    return miner?.allowedResources.includes(resource) ? miner : undefined
  }

  const supply = new Map<ItemId, number>()
  const nodeCount = new Map<ItemId, number>()
  for (const node of input.nodes) {
    if (node.count <= 0) continue
    const extractor = extractorFor(node.resource)
    if (!extractor) {
      return fail(`No extractor available for ${itemName(node.resource)}.`)
    }
    const perExtractor = Math.min(
      extractor.ratePerMin * PURITY_MULTIPLIER[node.purity],
      transportSpeed(node.resource),
    )
    supply.set(
      node.resource,
      (supply.get(node.resource) ?? 0) + node.count * perExtractor,
    )
    nodeCount.set(
      node.resource,
      (nodeCount.get(node.resource) ?? 0) + node.count,
    )
  }

  // --- 4. Target rate = tightest supply/requirement ratio ------------------
  let targetRate = Infinity
  let limitingResource: ItemId | null = null
  for (const [id, perUnit] of demandPerUnit) {
    if (!isRaw(id) || isWater(id) || perUnit <= EPS) continue
    const available = supply.get(id) ?? 0
    if (available <= EPS) {
      errors.push(`No node supplies ${itemName(id)}. Add a node for it.`)
      continue
    }
    const ratio = available / perUnit
    if (ratio < targetRate) {
      targetRate = ratio
      limitingResource = id
    }
  }
  if (errors.length > 0) return fail(...errors)
  if (!Number.isFinite(targetRate)) {
    return fail('The chain consumes no node resource. Add a resource node.')
  }

  // --- 5. Scale demand to the target rate and build stages -----------------
  const demand = new Map<ItemId, number>()
  for (const [id, perUnit] of demandPerUnit) demand.set(id, perUnit * targetRate)

  const surplusMap = new Map<ItemId, number>()
  const depth = new Map<ItemId, number>() // raw items default to 0
  const stages: Stage[] = []
  const edges: Edge[] = []
  const producerStageId = (id: ItemId): string =>
    recipeFor.has(id) ? `produce:${id}` : `extract:${id}`

  // Machine stages, producers first so depths resolve bottom-up.
  for (const id of postOrder) {
    const recipe = recipeFor.get(id)
    if (!recipe) continue
    const itemRate = demand.get(id) ?? 0
    if (itemRate <= EPS) continue

    const prodAmount = recipe.products.find((p) => p.item === id)!.amount
    const runs = itemRate / prodAmount // recipe runs per minute
    const perMachineRuns = 60 / recipe.time
    const count = runs / perMachineRuns
    const { built, lastClock } = splitMachines(count)

    const machine = data.machines.get(recipe.machine)
    const power = recipe.variablePower
      ? (recipe.variablePower.min + recipe.variablePower.max) / 2
      : (machine?.power ?? 0)
    const exponent = machine?.powerExponent ?? DEFAULT_POWER_EXPONENT

    const inputs: Flow[] = recipe.ingredients.map((ing) => ({
      item: ing.item,
      rate: ing.amount * runs,
    }))
    const outputs: Flow[] = recipe.products.map((p) => ({
      item: p.item,
      rate: p.amount * runs,
    }))
    for (const p of recipe.products) {
      if (p.item !== id) {
        surplusMap.set(
          p.item,
          (surplusMap.get(p.item) ?? 0) + p.amount * runs,
        )
      }
    }

    const stageDepth =
      1 + Math.max(0, ...recipe.ingredients.map((i) => depth.get(i.item) ?? 0))
    depth.set(id, stageDepth)

    stages.push({
      id: producerStageId(id),
      kind: 'machine',
      machineId: recipe.machine,
      machineName: machine?.name ?? recipe.machine,
      recipeId: recipe.id,
      recipeName: recipe.name,
      count,
      machinesBuilt: built,
      lastClockPercent: lastClock,
      powerMW: stagePower(count, power, exponent),
      inputs,
      outputs,
      depth: stageDepth,
    })

    for (const flow of inputs) {
      edges.push({
        from: producerStageId(flow.item),
        to: producerStageId(id),
        item: flow.item,
        rate: flow.rate,
        transport: isLiquid(flow.item) ? 'pipe' : 'belt',
        lanes: Math.max(1, Math.ceil(flow.rate / transportSpeed(flow.item) - EPS)),
      })
    }
  }

  // Extractor stages for consumed node resources.
  for (const [resource, consumed] of demand) {
    if (!isRaw(resource) || consumed <= EPS) continue
    if (isWater(resource)) {
      const ext = data.waterExtractor
      const count = consumed / ext.ratePerMin
      const { built, lastClock } = splitMachines(count)
      stages.push({
        id: `extract:${resource}`,
        kind: 'extractor',
        machineId: ext.id,
        machineName: ext.name,
        count,
        machinesBuilt: built,
        lastClockPercent: lastClock,
        powerMW: stagePower(count, ext.power, DEFAULT_POWER_EXPONENT),
        inputs: [],
        outputs: [{ item: resource, rate: consumed }],
        depth: 0,
      })
    } else {
      const ext = extractorFor(resource)!
      const count = nodeCount.get(resource)!
      stages.push({
        id: `extract:${resource}`,
        kind: 'extractor',
        machineId: ext.id,
        machineName: ext.name,
        count,
        machinesBuilt: count,
        lastClockPercent: 100,
        powerMW: count * ext.power,
        inputs: [],
        outputs: [{ item: resource, rate: consumed }],
        depth: 0,
      })
    }
  }

  // Storage terminator.
  const targetLiquid = isLiquid(input.targetItem)
  const maxDepth = Math.max(0, ...stages.map((s) => s.depth))
  stages.push({
    id: 'storage',
    kind: 'storage',
    machineId: null,
    machineName: targetLiquid ? 'Fluid Buffer' : 'Storage Container',
    count: 1,
    machinesBuilt: 1,
    lastClockPercent: 100,
    powerMW: 0,
    inputs: [{ item: input.targetItem, rate: targetRate }],
    outputs: [],
    depth: maxDepth + 1,
  })
  edges.push({
    from: producerStageId(input.targetItem),
    to: 'storage',
    item: input.targetItem,
    rate: targetRate,
    transport: targetLiquid ? 'pipe' : 'belt',
    lanes: Math.max(
      1,
      Math.ceil(targetRate / transportSpeed(input.targetItem) - EPS),
    ),
  })

  stages.sort((a, b) => a.depth - b.depth)

  return {
    ok: true,
    plan: {
      stages,
      edges,
      targetRate,
      limitingResource,
      totalPowerMW: stages.reduce((sum, s) => sum + s.powerMW, 0),
      surplus: [...surplusMap]
        .filter(([, rate]) => rate > EPS)
        .map(([item, rate]) => ({ item, rate })),
    },
  }
}
