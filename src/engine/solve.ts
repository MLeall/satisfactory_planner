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

export interface ImportInput {
  item: ItemId
  /** Delivered per minute, as a ceiling rather than a promise: the plan takes
   * what it needs up to this, and builds the difference itself when it can.
   * Omit (or <= 0) for as much as the plan needs, which no longer leaves
   * anything to build and so can never be the limiting resource. */
  rate?: number
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
  /** Belt/pipe tier: the best the player has unlocked, used as a ceiling. It
   * sizes the lane count and the miner cap; each individual run then drops to
   * the cheapest tier that still carries it. */
  beltMk: number
  pipeMk: number
  /** One or more output items to produce, each into its own storage. */
  targets: TargetOutput[]
  /**
   * Items belted in from a factory that already exists. An import with no rate
   * ends the chain outright: nothing that would have produced the item is
   * planned. An import with a rate is a partial supply — the machines (or the
   * miner) here cover only what it does not, and disappear entirely once it
   * covers everything.
   */
  imports?: ImportInput[]
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
  /**
   * Power Shards installed in every machine and extractor, each unlocking
   * another 50% of clock on top of the base 100% (0 → 100%, 1 → 150%,
   * 2 → 200%, 3 → 250%). Defaults to 0, i.e. no overclocking.
   */
  powerShards?: 0 | 1 | 2 | 3
}

export interface Flow {
  item: ItemId
  rate: number
}

export interface Stage {
  id: string
  kind: 'extractor' | 'machine' | 'storage' | 'sink' | 'import'
  machineId: MachineId | null
  machineName: string
  recipeId?: RecipeId
  recipeName?: string
  /** Exact machines needed at 100% clock (fractional) */
  count: number
  /** Machines to build: ceil(count / maxClock) */
  machinesBuilt: number
  /** Clock % of the last (partial) machine; the max clock when count divides */
  lastClockPercent: number
  powerMW: number
  /** Power Shards this stage consumes across all of its machines */
  powerShards: number
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
  /** Cheapest belt/pipe Mk that carries one lane of this run, capped at the
   * unlocked tier. Building Mk.6 everywhere is a waste when Mk.2 keeps up. */
  tierMk: number
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
  /** Power Shards the whole plan consumes */
  totalPowerShards: number
  surplus: Flow[]
  /** What the chain actually pulls from each imported input, per minute. */
  imports: Flow[]
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

/** Shards needed to run a machine at `clock` (1 = 100%): one per 50% above
 * the base clock, matching the game's 100/150/200/250% slider steps. */
function shardsFor(clock: number): number {
  return Math.max(0, Math.ceil((clock - 1) / 0.5 - EPS))
}

interface Split {
  /** Machines to build */
  built: number
  /** Clock % of the last machine (the max clock when nothing is left over) */
  lastClock: number
  /** Sum of clock^exponent, i.e. power in units of one machine at 100% */
  powerUnits: number
  shards: number
}

/** Lay `count` machine-equivalents (at 100% clock) out over as few machines as
 * `clockMax` allows: every machine but the last runs at `clockMax`, the last
 * one takes the remainder. With clockMax = 1 this is the plain whole-machines-
 * plus-one-underclocked layout. */
function split(count: number, clockMax: number, exponent: number): Split {
  const full = Math.floor(count / clockMax + EPS)
  const rest = count - full * clockMax
  const fullUnits = full * Math.pow(clockMax, exponent)
  const fullShards = full * shardsFor(clockMax)
  if (rest <= EPS) {
    return {
      built: full,
      lastClock: clockMax * 100,
      powerUnits: fullUnits,
      shards: fullShards,
    }
  }
  return {
    built: full + 1,
    lastClock: rest * 100,
    powerUnits: fullUnits + Math.pow(rest, exponent),
    shards: fullShards + shardsFor(rest),
  }
}

const round2 = (n: number) => Number(n.toFixed(2))

interface NodeGroup {
  /** Rate one extractor of this group sustains, belt cap included */
  perExtractor: number
  /** Clock it runs at to reach `perExtractor` (1 = 100%, never below) */
  clock: number
  count: number
}

interface Filled extends Split {
  /** Extractor-equivalents at 100% clock */
  count: number
  extracted: number
}

/** Minimal extractors to cover `required`, engaging the most productive nodes
 * first. In exact mode the last one is underclocked to the remainder, so the
 * extracted rate matches `required`; in whole mode every engaged extractor
 * runs at its full clock and the surplus ore becomes overflow. */
function fillExtractors(
  required: number,
  groups: NodeGroup[],
  wholeOnly: boolean,
  exponent: number,
): Filled {
  let remaining = required
  let built = 0
  let count = 0
  let extracted = 0
  let powerUnits = 0
  let shards = 0
  let lastClock = 100
  const engage = (n: number, clock: number) => {
    built += n
    count += n * clock
    powerUnits += n * Math.pow(clock, exponent)
    shards += n * shardsFor(clock)
    if (n > 0) lastClock = clock * 100
  }
  for (const g of [...groups].sort((a, b) => b.perExtractor - a.perExtractor)) {
    if (remaining <= EPS) break
    const units = remaining / g.perExtractor
    if (units >= g.count - EPS) {
      engage(g.count, g.clock)
      extracted += g.count * g.perExtractor
      remaining -= g.count * g.perExtractor
    } else if (wholeOnly) {
      const engaged = Math.max(1, Math.ceil(units - EPS))
      engage(engaged, g.clock)
      extracted += engaged * g.perExtractor
      remaining = 0
    } else {
      const w = Math.floor(units + EPS)
      engage(w, g.clock)
      const frac = (remaining - w * g.perExtractor) / g.perExtractor
      // The leftover extractor runs at whatever clock covers the remainder.
      if (frac > EPS) engage(1, frac * g.clock)
      extracted += remaining
      remaining = 0
    }
  }
  return { count, built, lastClock, powerUnits, shards, extracted }
}

/**
 * The largest scale a monotonic feasibility test still accepts. It grows before
 * it bisects: a plan whose imports cover the small end draws on no node at all
 * down there, so `start` cannot be assumed to be an upper bound. Infinity means
 * the test never failed, i.e. nothing limits the plan at all.
 */
export function largestFitting(
  fits: (scale: number) => boolean,
  start: number,
): number {
  let lo = 0
  let hi = Number.isFinite(start) && start > 0 ? start : 1
  let bounded = false
  for (let i = 0; i < 64; i++) {
    if (!fits(hi)) {
      bounded = true
      break
    }
    lo = hi
    hi *= 2
  }
  if (!bounded) return Infinity
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return lo
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

  /** A run of `rate` split over `lanes`: the cheapest unlocked tier whose speed
   * covers one lane. Lanes are sized against the ceiling, so such a tier always
   * exists and the search only ever walks down from it. */
  const tierFor = (item: ItemId, rate: number, lanes: number): number => {
    const liquid = isLiquid(item)
    const ceiling = liquid ? input.pipeMk : input.beltMk
    const tiers = liquid ? PIPE_TIERS : BELT_TIERS
    const perLane = rate / lanes
    const enough = tiers.find(
      (t) => t.mk <= ceiling && t.speed >= perLane - EPS,
    )
    return enough?.mk ?? ceiling
  }

  /** An edge, with its lane count and tier resolved from the rate. */
  const edge = (from: string, to: string, item: ItemId, rate: number): Edge => {
    const lanes = lanesFor(item, rate)
    return {
      from,
      to,
      item,
      rate,
      transport: isLiquid(item) ? 'pipe' : 'belt',
      lanes,
      tierMk: tierFor(item, rate, lanes),
    }
  }

  if (input.targets.length === 0) return fail('Add at least one output item.')

  // An import arrives on a belt from a factory that already exists, so the
  // chain stops at it exactly like a raw resource: no recipe is chosen for it,
  // and none of the machines that would have made it are planned.
  const imported = new Map<ItemId, number>()
  for (const imp of input.imports ?? []) {
    const rate = imp.rate === undefined || imp.rate <= 0 ? Infinity : imp.rate
    const prev = imported.get(imp.item)
    imported.set(imp.item, prev === undefined ? rate : prev + rate)
  }
  const isImported = (id: ItemId) => imported.has(id)
  /** Only a rateless import is a leaf on sight, because there is nothing left
   * for machines here to do. A capped one still descends into its recipe: the
   * machines have to be planned for whatever the import does not cover. */
  const isLeafImport = (id: ItemId) => imported.get(id) === Infinity

  // A raw item is extracted, never crafted (ignores Converter ore recipes).
  const isWater = (id: ItemId) =>
    data.waterExtractor.allowedResources.includes(id)
  const isRaw = (id: ItemId) =>
    isLeafImport(id) || isWater(id) || data.nodeResources.includes(id)

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
  // Max clock as a multiplier: 1 (no shard) to 2.5 (three shards).
  const maxClock = 1 + 0.5 * (input.powerShards ?? 0)

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
      // What arrives on a belt is not built here. A stage whose import covers
      // the whole demand ends up with no runs at all, and the loop that turns
      // runs into stages already drops those, so the machines simply vanish.
      const local = d - Math.min(d, imported.get(id) ?? 0)
      if (local <= EPS) continue
      const prodAmount = recipe.products.find((p) => p.item === id)!.amount
      let r = local / prodAmount
      if (whole) {
        const perMachineRuns = (60 / recipe.time) * maxClock
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

  const nodeSupply = new Map<ItemId, number>()
  const nodeGroups = new Map<ItemId, NodeGroup[]>()
  for (const node of input.nodes) {
    if (node.count <= 0) continue
    const extractor = extractorFor(node.resource)
    if (!extractor) {
      return fail(`No extractor available for ${itemName(node.resource)}.`)
    }
    const atFullClock = extractor.ratePerMin * PURITY_MULTIPLIER[node.purity]
    const perExtractor = Math.min(
      atFullClock * maxClock,
      transportSpeed(node.resource),
    )
    // Overclocking past what the belt can carry buys nothing but power draw,
    // so the clock stops at the cap; a belt-capped node stays at 100%.
    const clock = Math.max(1, perExtractor / atFullClock)
    nodeSupply.set(
      node.resource,
      (nodeSupply.get(node.resource) ?? 0) + node.count * perExtractor,
    )
    const groups = nodeGroups.get(node.resource) ?? []
    groups.push({ perExtractor, clock, count: node.count })
    nodeGroups.set(node.resource, groups)
  }

  /** Everything an item can come from: what the nodes here yield, plus what is
   * belted in. Declaring both a node and an import for the same ore is not a
   * contradiction — the import is used first and the miner covers the rest. */
  const supplyOf = (id: ItemId) =>
    (nodeSupply.get(id) ?? 0) + (imported.get(id) ?? 0)

  /** Items an import only partly covers, the rest built or mined here. Their
   * raw draw bends at the cap, so the plan's maximum stops being a ratio to
   * read off and has to be searched for instead. */
  const hybrid = [...imported].some(
    ([id, cap]) =>
      Number.isFinite(cap) && (recipeFor.has(id) || nodeSupply.has(id)),
  )

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

    const seedFor = (kk: number) =>
      new Map([...weights].map(([item, w]) => [item, kk * w]))
    /** Does what this seed pulls fit inside the nodes plus the imports? */
    const fitsSeed = (seed: Map<ItemId, number>): boolean => {
      for (const [id, v] of propagate(seed).need) {
        if (!isRaw(id) || isWater(id) || v <= EPS) continue
        if (v > supplyOf(id) + EPS) return false
      }
      return true
    }
    const fits = (kk: number) => fitsSeed(seedFor(kk))

    for (const t of input.targets) {
      if (hybrid) {
        // With a capped import in the chain this target's solo maximum is no
        // longer a ratio to read off — below the cap it draws on no node at
        // all, above it the machines kick in — so search for it instead.
        const solo = largestFitting(
          (r) => fitsSeed(new Map([[t.item, r]])),
          1,
        )
        if (solo === Infinity) {
          return fail(
            `Nothing limits ${itemName(t.item)}: the imports sustain it at ` +
              'any rate. Set an output rate, or give the imports a rate of ' +
              'their own.',
          )
        }
        if (solo <= EPS) {
          errors.push(
            `Your nodes and imports cannot sustain ${itemName(t.item)} at any ` +
              'rate. Add a node, or raise an import.',
          )
          continue
        }
        weights.set(t.item, (weights.get(t.item) ?? 0) + solo)
        continue
      }
      const pu = rawPerUnit(t.item)
      let soloMax = Infinity
      for (const [id, v] of pu) {
        const available = supplyOf(id)
        if (available <= EPS) {
          errors.push(
            `No node or import supplies ${itemName(id)}. Add a node or an ` +
              'import for it.',
          )
          continue
        }
        soloMax = Math.min(soloMax, available / v)
      }
      // Nothing finite to scale against: either the chain draws on no node at
      // all, or everything it draws on is an import with no declared rate.
      if (errors.length === 0 && !Number.isFinite(soloMax)) {
        return fail(
          pu.size === 0
            ? 'The chain consumes no node resource. Add a resource node.'
            : `Nothing limits ${itemName(t.item)}: every input it draws on is ` +
                'an unlimited import. Set an output rate, or give the imports ' +
                'a rate of their own.',
        )
      }
      perUnit.set(t.item, pu)
      weights.set(t.item, (weights.get(t.item) ?? 0) + soloMax)
    }
    if (errors.length > 0) return fail(...errors)

    let k = Infinity
    if (!hybrid) {
      // Raw draw per unit of k, summed over the weighted targets.
      const perK = new Map<ItemId, number>()
      for (const [item, w] of weights) {
        for (const [raw, v] of perUnit.get(item)!) {
          perK.set(raw, (perK.get(raw) ?? 0) + w * v)
        }
      }
      for (const [raw, v] of perK) {
        const ratio = supplyOf(raw) / v
        if (ratio < k) {
          k = ratio
          limitingResource = raw
        }
      }
    }

    // Feasibility is monotonic in k whatever the mode: rounding up to whole
    // machines only ever raises the raw draw, and a capped import only bends
    // it. So where the linear k is not already the answer, the maximum is the
    // largest k the plan still fits at.
    if (hybrid || (wholeMode && !fits(k))) {
      k = largestFitting(fits, k)
      if (k === Infinity) {
        return fail(
          'Nothing limits this plan: the imports sustain it at any rate. Set ' +
            'an output rate, or give the imports a rate of their own.',
        )
      }
      if (k <= EPS) {
        return fail(
          wholeMode
            ? 'Whole-machine mode needs at least one full machine per stage, ' +
              'and your nodes cannot feed them. Add nodes or switch to exact mode.'
            : 'Your nodes and imports cannot sustain this chain at any rate. ' +
              'Add a node, or raise an import.',
        )
      }
    }
    for (const [item, w] of weights) targetRates.set(item, k * w)

    // Which input actually ran out, read off the finished scale rather than off
    // a ratio a capped import would have made meaningless. A capped import only
    // counts as a ceiling while the machines here are not already covering the
    // difference; past that point it is the ore behind them that binds.
    if (hybrid) {
      let tightest = Infinity
      for (const [id, v] of propagate(seedFor(k)).need) {
        if (isWater(id) || v <= EPS) continue
        const cap = imported.get(id) ?? Infinity
        const capped = Number.isFinite(cap) && v <= cap + EPS
        if (!isRaw(id) && !capped) continue
        const ratio = supplyOf(id) / v
        if (ratio < tightest) {
          tightest = ratio
          limitingResource = id
        }
      }
    }
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
      const available = supplyOf(id)
      if (available <= EPS) {
        errors.push(
          `No node or import supplies ${itemName(id)}. Add a node or an ` +
            'import for it.',
        )
        continue
      }
      if (need > available + EPS) {
        errors.push(
          isImported(id)
            ? `You import ${round2(available)}/min of ${itemName(id)}, but ` +
                `${round2(need)}/min is needed. Raise the import, or lower ` +
                'the targets.'
            : `Your nodes supply ${round2(available)}/min of ${itemName(id)}, but ` +
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
  /** The stage that makes an item *here*, as opposed to belting it in. */
  const localStageId = (id: ItemId): string =>
    recipeFor.has(id) ? `produce:${id}` : `extract:${id}`

  /**
   * How much of an item actually arrives on the import belt: what is left of
   * the demand once the machines here have made what they were going to make,
   * never more than the declared rate. Taking the machines off first is what
   * stops a whole-machine plan from asking the other factory for parts it is
   * already overproducing.
   */
  const importedRate = (id: ItemId): number =>
    Math.min(
      imported.get(id) ?? 0,
      Math.max(0, (demand.get(id) ?? 0) - (prop.made.get(id) ?? 0)),
    )

  /**
   * The belts carrying `rate` of `item` into `to`. A partly imported item comes
   * in on two of them — one from the import, one from the machines covering the
   * difference — split in the proportion the two sources supply it, which is
   * what merging the import into the local line does in the game.
   */
  const feed = (to: string, item: ItemId, rate: number): void => {
    const total = demand.get(item) ?? 0
    const share = total > EPS ? importedRate(item) / total : 0
    if (share >= 1 - EPS) {
      edges.push(edge(`import:${item}`, to, item, rate))
    } else if (share <= EPS) {
      edges.push(edge(localStageId(item), to, item, rate))
    } else {
      edges.push(edge(`import:${item}`, to, item, rate * share))
      edges.push(edge(localStageId(item), to, item, rate * (1 - share)))
    }
  }

  // Machine stages, producers first so depths resolve bottom-up.
  for (const id of postOrder) {
    const recipe = recipeFor.get(id)
    if (!recipe) continue
    const runs = prop.runs.get(id) ?? 0 // recipe runs per minute
    if (runs <= EPS) continue

    const prodAmount = recipe.products.find((p) => p.item === id)!.amount
    const perMachineRuns = 60 / recipe.time
    const count = runs / perMachineRuns

    const machine = data.machines.get(recipe.machine)
    const power = recipe.variablePower
      ? (recipe.variablePower.min + recipe.variablePower.max) / 2
      : (machine?.power ?? 0)
    const exponent = machine?.powerExponent ?? DEFAULT_POWER_EXPONENT
    const { built, lastClock, powerUnits, shards } = split(
      count,
      maxClock,
      exponent,
    )

    const inputs: Flow[] = recipe.ingredients.map((ing) => ({
      item: ing.item,
      rate: ing.amount * runs,
    }))
    const outputs: Flow[] = recipe.products.map((p) => ({
      item: p.item,
      rate: p.amount * runs,
    }))
    const stageId = localStageId(id)
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
      powerMW: power * powerUnits,
      powerShards: shards,
      inputs,
      outputs,
      depth: stageDepth,
    })

    for (const flow of inputs) feed(stageId, flow.item, flow.rate)
  }

  // Import stages: one per item the plan really does belt in, whether it ends
  // the chain outright or only tops up what the machines here make.
  const importFlows: Flow[] = []
  for (const item of demand.keys()) {
    const rate = importedRate(item)
    if (rate <= EPS) continue
    importFlows.push({ item, rate })
    stages.push({
      id: `import:${item}`,
      kind: 'import',
      machineId: null,
      machineName: 'Imported',
      count: 1,
      machinesBuilt: 0,
      lastClockPercent: 100,
      powerMW: 0,
      powerShards: 0,
      inputs: [],
      outputs: [{ item, rate }],
      depth: 0,
    })
  }

  // Extractor stages for the node resources the imports did not already cover.
  for (const [resource, total] of demand) {
    if (!isRaw(resource) || total <= EPS) continue
    const consumed = total - importedRate(resource)
    if (consumed <= EPS) continue
    const stageId = `extract:${resource}`
    let ext: Extractor
    let count: number
    let built: number
    let lastClock: number
    let powerUnits: number
    let shards: number
    let extracted: number

    if (isWater(resource)) {
      ext = data.waterExtractor
      // Same belt-cap reasoning as node groups, against the pipe this time.
      const clock = Math.max(
        1,
        Math.min(maxClock, transportSpeed(resource) / ext.ratePerMin),
      )
      count = consumed / ext.ratePerMin
      if (wholeMode) count = Math.max(1, Math.ceil(count / clock - EPS)) * clock
      const s = split(count, clock, DEFAULT_POWER_EXPONENT)
      built = s.built
      lastClock = s.lastClock
      powerUnits = s.powerUnits
      shards = s.shards
      extracted = wholeMode ? count * ext.ratePerMin : consumed
    } else {
      ext = extractorFor(resource)!
      const filled = fillExtractors(
        consumed,
        nodeGroups.get(resource) ?? [],
        wholeMode,
        DEFAULT_POWER_EXPONENT,
      )
      count = filled.count
      built = filled.built
      lastClock = filled.lastClock
      powerUnits = filled.powerUnits
      shards = filled.shards
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
      powerMW: ext.power * powerUnits,
      powerShards: shards,
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
      powerShards: 0,
      inputs: [{ item, rate }],
      outputs: [],
      depth: terminalDepth,
    })
    feed(`storage:${item}`, item, rate)
  }

  // AWESOME Sinks: consume sinkable (solid, point-bearing) surplus for coupons.
  let sinkPointsPerMin = 0
  if (input.sinkOverflow) {
    const sink = data.awesomeSink
    const depthOfStage = new Map(stages.map((s) => [s.id, s.depth]))
    for (const [item, rate] of surplusMap) {
      if (rate <= EPS || isLiquid(item)) continue
      const points = data.items.get(item)?.sinkPoints ?? 0
      if (points <= 0) continue
      sinkPointsPerMin += rate * points
      surplusMap.delete(item)
      const lanes = lanesFor(item, rate) // one input belt per sink
      const from = byproductSource.get(item) ?? localStageId(item)
      stages.push({
        id: `sink:${item}`,
        kind: 'sink',
        machineId: sink.id,
        machineName: sink.name,
        count: lanes,
        machinesBuilt: lanes,
        lastClockPercent: 100,
        powerMW: lanes * sink.power,
        powerShards: 0,
        inputs: [{ item, rate }],
        outputs: [],
        // Right beside the stage it drains, not parked at the far right: the
        // belt then only crosses the empty gap between two columns.
        depth: (depthOfStage.get(from) ?? producerDepth) + 1,
      })
      edges.push(edge(from, `sink:${item}`, item, rate))
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
      totalPowerShards: stages.reduce((sum, s) => sum + s.powerShards, 0),
      surplus: [...surplusMap]
        .filter(([, rate]) => rate > EPS)
        .map(([item, rate]) => ({ item, rate })),
      imports: importFlows,
      sinkPointsPerMin,
    },
  }
}
