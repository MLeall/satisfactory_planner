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

export interface TargetOutput {
  item: ItemId
  /** Desired output per minute. For a single target, omit (or <= 0) to plan the
   * maximum the declared nodes can sustain. Required with multiple targets. */
  rate?: number
}

export interface PlanInput {
  nodes: NodeInput[]
  minerTier: 1 | 2 | 3
  beltMk: number
  pipeMk: number
  /** One or more output items to produce, each into its own storage. */
  targets: TargetOutput[]
  /** Per-item recipe override (default recipe when absent) */
  recipeSelection?: Record<ItemId, RecipeId>
  /** Route sinkable surplus into AWESOME Sinks for coupon points. */
  sinkOverflow?: boolean
  /**
   * `exact` (default) underclocks the fractional machine of every stage, so the
   * chain produces precisely the demand and nothing overflows. `whole` rounds
   * every stage up to whole machines running at 100%, the way factories are
   * usually built; each stage then overproduces and the excess becomes surplus
   * (and coupon points when `sinkOverflow` is on).
   */
  buildMode?: 'exact' | 'whole'
}

export interface Flow {
  item: ItemId
  rate: number
}

export interface Stage {
  id: string
  kind: 'extractor' | 'machine' | 'storage' | 'sink'
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

export interface PlanTarget {
  item: ItemId
  rate: number
}

export interface Plan {
  stages: Stage[]
  edges: Edge[]
  targets: PlanTarget[]
  limitingResource: ItemId | null
  totalPowerMW: number
  surplus: Flow[]
  /** AWESOME Sink coupon points per minute (0 when sink mode is off). */
  sinkPointsPerMin: number
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

const round2 = (n: number) => Number(n.toFixed(2))

interface NodeGroup {
  perExtractor: number
  count: number
}

/** Minimal extractors to cover `required`, engaging the most productive nodes
 * first. In exact mode the last one is underclocked to the remainder, so the
 * extracted rate matches `required`; in whole mode every engaged extractor
 * runs at 100% and the surplus ore becomes overflow. */
function fillExtractors(
  required: number,
  groups: NodeGroup[],
  wholeOnly: boolean,
): { count: number; built: number; lastClock: number; extracted: number } {
  let remaining = required
  let whole = 0
  let frac = 0
  let extracted = 0
  for (const g of [...groups].sort((a, b) => b.perExtractor - a.perExtractor)) {
    if (remaining <= EPS) break
    const units = remaining / g.perExtractor
    if (units >= g.count - EPS) {
      whole += g.count
      extracted += g.count * g.perExtractor
      remaining -= g.count * g.perExtractor
    } else if (wholeOnly) {
      const engaged = Math.max(1, Math.ceil(units - EPS))
      whole += engaged
      extracted += engaged * g.perExtractor
      remaining = 0
    } else {
      const w = Math.floor(units + EPS)
      whole += w
      frac = (remaining - w * g.perExtractor) / g.perExtractor
      extracted += remaining
      remaining = 0
    }
  }
  const count = whole + frac
  return frac > EPS
    ? { count, built: whole + 1, lastClock: frac * 100, extracted }
    : { count, built: whole, lastClock: 100, extracted }
}

export function solve(data: GameData, input: PlanInput): SolveResult {
  const itemName = (id: ItemId) => data.items.get(id)?.name ?? id
  const isLiquid = (id: ItemId) => data.items.get(id)?.liquid ?? false
  const beltSpeed = BELT_TIERS.find((b) => b.mk === input.beltMk)?.speed
  const pipeSpeed = PIPE_TIERS.find((p) => p.mk === input.pipeMk)?.speed
  if (!beltSpeed || !pipeSpeed) return fail('Invalid belt or pipe tier.')
  const transportSpeed = (item: ItemId) =>
    isLiquid(item) ? pipeSpeed : beltSpeed
  const lanesFor = (item: ItemId, rate: number) =>
    Math.max(1, Math.ceil(rate / transportSpeed(item) - EPS))

  if (input.targets.length === 0) return fail('Add at least one output item.')

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

  // --- 1. Recipe closure over all targets (cycle-checked) ------------------
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
  for (const t of input.targets) visit(t.item)
  if (errors.length > 0) return fail(...errors)

  const consumersFirst = [...postOrder].reverse()

  const wholeMode = input.buildMode === 'whole'

  interface Propagation {
    /** Rate each item must supply to its consumers (targets included) */
    need: Map<ItemId, number>
    /** Rate each crafted item is actually produced at (>= need in whole mode) */
    made: Map<ItemId, number>
    /** Recipe runs per minute, per crafted item */
    runs: Map<ItemId, number>
  }

  /** Propagate item demand top-down through the chosen recipes. In whole mode
   * every stage is rounded up to entire machines first, so its ingredient pull
   * reflects what those machines really consume at 100%. */
  const propagate = (seed: Map<ItemId, number>, whole = wholeMode): Propagation => {
    const need = new Map(seed)
    const made = new Map<ItemId, number>()
    const runs = new Map<ItemId, number>()
    for (const id of consumersFirst) {
      const recipe = recipeFor.get(id)
      if (!recipe) continue
      const d = need.get(id) ?? 0
      if (d <= EPS) continue
      const prodAmount = recipe.products.find((p) => p.item === id)!.amount
      let r = d / prodAmount
      if (whole) {
        const perMachineRuns = 60 / recipe.time
        // A stage with any demand at all still needs a whole machine.
        r = Math.max(1, Math.ceil(r / perMachineRuns - EPS)) * perMachineRuns
      }
      runs.set(id, r)
      made.set(id, r * prodAmount)
      for (const ing of recipe.ingredients) {
        need.set(ing.item, (need.get(ing.item) ?? 0) + r * ing.amount)
      }
    }
    return { need, made, runs }
  }

  /** Node resources consumed per unit of `item`, ignoring machine rounding. */
  const rawPerUnit = (item: ItemId): Map<ItemId, number> => {
    const perUnit = new Map<ItemId, number>()
    for (const [id, v] of propagate(new Map([[item, 1]]), false).need) {
      if (isRaw(id) && !isWater(id) && v > EPS) perUnit.set(id, v)
    }
    return perUnit
  }

  // --- 2. Node supply -------------------------------------------------------
  const extractorFor = (resource: ItemId): Extractor | undefined => {
    if (data.oilExtractor.allowedResources.includes(resource)) {
      return data.oilExtractor
    }
    const miner = data.minersByTier.get(input.minerTier)
    return miner?.allowedResources.includes(resource) ? miner : undefined
  }

  const supply = new Map<ItemId, number>()
  const nodeGroups = new Map<ItemId, NodeGroup[]>()
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
    const groups = nodeGroups.get(node.resource) ?? []
    groups.push({ perExtractor, count: node.count })
    nodeGroups.set(node.resource, groups)
  }

  // --- 3. Resolve each target's output rate --------------------------------
  const targetRates = new Map<ItemId, number>()
  let limitingResource: ItemId | null = null

  // Max mode: every rate left blank. Each target is weighted by what it would
  // produce on its own from these nodes, then all of them are scaled by the
  // same factor k until the tightest resource runs out. With a single target
  // this degenerates to k = 1, i.e. plain solo max.
  const balanced = input.targets.every(
    (t) => t.rate === undefined || t.rate <= EPS,
  )

  if (balanced) {
    const perUnit = new Map<ItemId, Map<ItemId, number>>()
    const weights = new Map<ItemId, number>()
    for (const t of input.targets) {
      const pu = rawPerUnit(t.item)
      let soloMax = Infinity
      for (const [id, v] of pu) {
        const available = supply.get(id) ?? 0
        if (available <= EPS) {
          errors.push(`No node supplies ${itemName(id)}. Add a node for it.`)
          continue
        }
        soloMax = Math.min(soloMax, available / v)
      }
      if (errors.length === 0 && !Number.isFinite(soloMax)) {
        return fail('The chain consumes no node resource. Add a resource node.')
      }
      perUnit.set(t.item, pu)
      weights.set(t.item, (weights.get(t.item) ?? 0) + soloMax)
    }
    if (errors.length > 0) return fail(...errors)

    // Raw draw per unit of k, summed over the weighted targets.
    const perK = new Map<ItemId, number>()
    for (const [item, w] of weights) {
      for (const [raw, v] of perUnit.get(item)!) {
        perK.set(raw, (perK.get(raw) ?? 0) + w * v)
      }
    }
    let k = Infinity
    for (const [raw, v] of perK) {
      const ratio = (supply.get(raw) ?? 0) / v
      if (ratio < k) {
        k = ratio
        limitingResource = raw
      }
    }

    const seedFor = (kk: number) =>
      new Map([...weights].map(([item, w]) => [item, kk * w]))
    const fits = (kk: number) => {
      for (const [id, v] of propagate(seedFor(kk)).need) {
        if (!isRaw(id) || isWater(id) || v <= EPS) continue
        if (v > (supply.get(id) ?? 0) + EPS) return false
      }
      return true
    }
    // Rounding up to whole machines only ever raises the raw draw, so the
    // linear k above is an upper bound and feasibility is monotonic in k.
    if (wholeMode && !fits(k)) {
      let lo = 0
      let hi = k
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2
        if (fits(mid)) lo = mid
        else hi = mid
      }
      k = lo
      if (k <= EPS) {
        return fail(
          'Whole-machine mode needs at least one full machine per stage, and ' +
            'your nodes cannot feed them. Add nodes or switch to exact mode.',
        )
      }
    }
    for (const [item, w] of weights) targetRates.set(item, k * w)
  } else {
    for (const t of input.targets) {
      if (t.rate === undefined || t.rate <= EPS) {
        errors.push(`Set an output rate for ${itemName(t.item)}.`)
        continue
      }
      targetRates.set(t.item, (targetRates.get(t.item) ?? 0) + t.rate)
    }
    if (errors.length > 0) return fail(...errors)
  }

  // --- 4. Absolute demand + feasibility ------------------------------------
  const prop = propagate(targetRates)
  const demand = prop.need

  // Whole-machine overproduction of a target goes to its own storage in max
  // mode (you asked for as much as possible), not to the sink.
  if (balanced) {
    for (const [item, rate] of targetRates) {
      const over = (prop.made.get(item) ?? 0) - (demand.get(item) ?? 0)
      if (over > EPS) {
        targetRates.set(item, rate + over)
        demand.set(item, prop.made.get(item)!)
      }
    }
  }

  if (!balanced) {
    let tightest = Infinity
    for (const [id, need] of demand) {
      if (!isRaw(id) || isWater(id) || need <= EPS) continue
      const available = supply.get(id) ?? 0
      if (available <= EPS) {
        errors.push(`No node supplies ${itemName(id)}. Add a node for it.`)
        continue
      }
      if (need > available + EPS) {
        errors.push(
          `Your nodes supply ${round2(available)}/min of ${itemName(id)}, but ` +
            `${round2(need)}/min is needed. Add nodes or lower the targets.`,
        )
        continue
      }
      const ratio = available / need
      if (ratio < tightest) {
        tightest = ratio
        limitingResource = id
      }
    }
    if (errors.length > 0) return fail(...errors)
  }

  // --- 5. Build stages and edges -------------------------------------------
  const surplusMap = new Map<ItemId, number>()
  const byproductSource = new Map<ItemId, string>()
  const depth = new Map<ItemId, number>() // raw items default to 0
  const stages: Stage[] = []
  const edges: Edge[] = []
  const producerStageId = (id: ItemId): string =>
    recipeFor.has(id) ? `produce:${id}` : `extract:${id}`

  // Machine stages, producers first so depths resolve bottom-up.
  for (const id of postOrder) {
    const recipe = recipeFor.get(id)
    if (!recipe) continue
    const runs = prop.runs.get(id) ?? 0 // recipe runs per minute
    if (runs <= EPS) continue

    const prodAmount = recipe.products.find((p) => p.item === id)!.amount
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
    const stageId = producerStageId(id)
    for (const p of recipe.products) {
      if (p.item !== id) {
        surplusMap.set(p.item, (surplusMap.get(p.item) ?? 0) + p.amount * runs)
        byproductSource.set(p.item, stageId)
      }
    }
    // Whole machines at 100% make more than the chain pulls; the excess is
    // overflow, routed exactly like a byproduct.
    const over = prodAmount * runs - (demand.get(id) ?? 0)
    if (over > EPS) {
      surplusMap.set(id, (surplusMap.get(id) ?? 0) + over)
      byproductSource.set(id, stageId)
    }

    const stageDepth =
      1 + Math.max(0, ...recipe.ingredients.map((i) => depth.get(i.item) ?? 0))
    depth.set(id, stageDepth)

    stages.push({
      id: stageId,
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
        to: stageId,
        item: flow.item,
        rate: flow.rate,
        transport: isLiquid(flow.item) ? 'pipe' : 'belt',
        lanes: lanesFor(flow.item, flow.rate),
      })
    }
  }

  // Extractor stages for consumed node resources.
  for (const [resource, consumed] of demand) {
    if (!isRaw(resource) || consumed <= EPS) continue
    const stageId = `extract:${resource}`
    let ext: Extractor
    let count: number
    let built: number
    let lastClock: number
    let extracted: number

    if (isWater(resource)) {
      ext = data.waterExtractor
      count = consumed / ext.ratePerMin
      if (wholeMode) count = Math.max(1, Math.ceil(count - EPS))
      const split = splitMachines(count)
      built = split.built
      lastClock = split.lastClock
      extracted = wholeMode ? count * ext.ratePerMin : consumed
    } else {
      ext = extractorFor(resource)!
      const filled = fillExtractors(
        consumed,
        nodeGroups.get(resource) ?? [],
        wholeMode,
      )
      count = filled.count
      built = filled.built
      lastClock = filled.lastClock
      extracted = filled.extracted
    }

    stages.push({
      id: stageId,
      kind: 'extractor',
      machineId: ext.id,
      machineName: ext.name,
      count,
      machinesBuilt: built,
      lastClockPercent: lastClock,
      powerMW: stagePower(count, ext.power, DEFAULT_POWER_EXPONENT),
      inputs: [],
      outputs: [{ item: resource, rate: extracted }],
      depth: 0,
    })

    // Extractors at 100% pull more than the chain consumes; that is overflow.
    const over = extracted - consumed
    if (over > EPS) {
      surplusMap.set(resource, (surplusMap.get(resource) ?? 0) + over)
      byproductSource.set(resource, stageId)
    }
  }

  const producerDepth = Math.max(0, ...stages.map((s) => s.depth))
  const terminalDepth = producerDepth + 1

  // One storage container per requested output.
  for (const [item, rate] of targetRates) {
    const liquid = isLiquid(item)
    stages.push({
      id: `storage:${item}`,
      kind: 'storage',
      machineId: null,
      machineName: liquid ? 'Fluid Buffer' : 'Storage Container',
      count: 1,
      machinesBuilt: 1,
      lastClockPercent: 100,
      powerMW: 0,
      inputs: [{ item, rate }],
      outputs: [],
      depth: terminalDepth,
    })
    edges.push({
      from: producerStageId(item),
      to: `storage:${item}`,
      item,
      rate,
      transport: liquid ? 'pipe' : 'belt',
      lanes: lanesFor(item, rate),
    })
  }

  // AWESOME Sinks: consume sinkable (solid, point-bearing) surplus for coupons.
  let sinkPointsPerMin = 0
  if (input.sinkOverflow) {
    const sink = data.awesomeSink
    for (const [item, rate] of surplusMap) {
      if (rate <= EPS || isLiquid(item)) continue
      const points = data.items.get(item)?.sinkPoints ?? 0
      if (points <= 0) continue
      sinkPointsPerMin += rate * points
      surplusMap.delete(item)
      const lanes = lanesFor(item, rate) // one input belt per sink
      stages.push({
        id: `sink:${item}`,
        kind: 'sink',
        machineId: sink.id,
        machineName: sink.name,
        count: lanes,
        machinesBuilt: lanes,
        lastClockPercent: 100,
        powerMW: lanes * sink.power,
        inputs: [{ item, rate }],
        outputs: [],
        depth: terminalDepth,
      })
      edges.push({
        from: byproductSource.get(item) ?? producerStageId(item),
        to: `sink:${item}`,
        item,
        rate,
        transport: 'belt',
        lanes,
      })
    }
  }

  stages.sort((a, b) => a.depth - b.depth)

  return {
    ok: true,
    plan: {
      stages,
      edges,
      targets: [...targetRates].map(([item, rate]) => ({ item, rate })),
      limitingResource,
      totalPowerMW: stages.reduce((sum, s) => sum + s.powerMW, 0),
      surplus: [...surplusMap]
        .filter(([, rate]) => rate > EPS)
        .map(([item, rate]) => ({ item, rate })),
      sinkPointsPerMin,
    },
  }
}
