import rawData from './data1.0.json'
import type {
  Extractor,
  GameData,
  Item,
  ItemId,
  Machine,
  Recipe,
} from '../engine/types'

interface RawPart {
  item: string
  amount: number
}

interface RawRecipe {
  className: string
  name: string
  alternate: boolean
  time: number
  inMachine: boolean
  forBuilding: boolean
  ingredients: RawPart[]
  products: RawPart[]
  producedIn: string[]
  isVariablePower: boolean
  minPower: number
  maxPower: number
}

interface RawItem {
  className: string
  name: string
  liquid: boolean
  sinkPoints: number
}

interface RawBuilding {
  className: string
  name: string
  metadata: {
    powerConsumption?: number
    powerConsumptionExponent?: number
  }
}

interface RawMiner {
  className: string
  allowedResources: string[]
  allowLiquids: boolean
  itemsPerCycle: number
  extractCycleTime: number
}

interface RawData {
  items: Record<string, RawItem>
  recipes: Record<string, RawRecipe>
  resources: Record<string, unknown>
  miners: Record<string, RawMiner>
  buildings: Record<string, RawBuilding>
}

const WATER = 'Desc_Water_C'
// Not present in the dataset's miners section; value from
// https://satisfactory.wiki.gg/wiki/Water_Extractor
const WATER_EXTRACTOR_RATE = 120

/** Fluid extractor cycles are expressed in liters; convert to m³. */
function extractorRate(m: RawMiner): number {
  const perMinute = (m.itemsPerCycle / m.extractCycleTime) * 60
  return m.allowLiquids ? perMinute / 1000 : perMinute
}

export function loadGameData(): GameData {
  const raw = rawData as unknown as RawData

  const items = new Map<ItemId, Item>()
  for (const it of Object.values(raw.items)) {
    items.set(it.className, {
      id: it.className,
      name: it.name,
      liquid: it.liquid,
      sinkPoints: it.sinkPoints ?? 0,
    })
  }

  const machines = new Map<string, Machine>()
  for (const b of Object.values(raw.buildings)) {
    machines.set(b.className, {
      id: b.className,
      name: b.name,
      power: b.metadata.powerConsumption ?? 0,
      powerExponent: b.metadata.powerConsumptionExponent ?? 1,
    })
  }

  const recipes = new Map<string, Recipe>()
  const recipesByProduct = new Map<ItemId, Recipe[]>()
  for (const r of Object.values(raw.recipes)) {
    if (!r.inMachine || r.forBuilding) continue
    const machine = r.producedIn.find((m) => machines.has(m))
    if (!machine) continue
    const recipe: Recipe = {
      id: r.className,
      name: r.name,
      alternate: r.alternate,
      time: r.time,
      ingredients: r.ingredients,
      products: r.products,
      machine,
      ...(r.isVariablePower
        ? { variablePower: { min: r.minPower, max: r.maxPower } }
        : {}),
    }
    recipes.set(recipe.id, recipe)
    for (const p of recipe.products) {
      const list = recipesByProduct.get(p.item) ?? []
      list.push(recipe)
      recipesByProduct.set(p.item, list)
    }
  }
  // Default recipes first; Unpackage recipes last among defaults, so they
  // are never auto-picked (Fuel -> Packaged Fuel -> Fuel is circular).
  const rank = (r: Recipe) =>
    r.alternate ? 2 : r.name.startsWith('Unpackage') ? 1 : 0
  for (const list of recipesByProduct.values()) {
    list.sort((a, b) => rank(a) - rank(b))
  }

  const toExtractor = (m: RawMiner): Extractor => {
    const building = machines.get(m.className)
    return {
      id: m.className,
      name: building?.name ?? m.className,
      power: building?.power ?? 0,
      ratePerMin: extractorRate(m),
      allowedResources: m.allowedResources,
      liquid: m.allowLiquids,
    }
  }

  const minersByTier = new Map<number, Extractor>()
  for (const m of Object.values(raw.miners)) {
    const tier = /MinerMk(\d)/.exec(m.className)?.[1]
    if (tier) minersByTier.set(Number(tier), toExtractor(m))
  }

  const rawOilPump = Object.values(raw.miners).find(
    (m) => m.className === 'Desc_OilPump_C',
  )!
  const oilExtractor = toExtractor(rawOilPump)

  const waterBuilding = machines.get('Desc_WaterPump_C')!
  const waterExtractor: Extractor = {
    id: waterBuilding.id,
    name: waterBuilding.name,
    power: waterBuilding.power,
    ratePerMin: WATER_EXTRACTOR_RATE,
    allowedResources: [WATER],
    liquid: true,
  }

  const nodeResources = Object.keys(raw.resources).filter(
    (r) => r !== WATER && r !== 'Desc_NitrogenGas_C',
  )

  const awesomeSink = machines.get('Desc_ResourceSink_C')!

  return {
    items,
    recipes,
    recipesByProduct,
    machines,
    awesomeSink,
    minersByTier,
    oilExtractor,
    waterExtractor,
    nodeResources,
  }
}
