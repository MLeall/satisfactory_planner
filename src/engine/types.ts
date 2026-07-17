// Domain model for the planner engine. All rates are per minute.
// Fluid amounts are in cubic meters (m³).

export type ItemId = string
export type RecipeId = string
export type MachineId = string

export interface Item {
  id: ItemId
  name: string
  liquid: boolean
  /** AWESOME Sink points per item (0 when not sinkable) */
  sinkPoints: number
}

export interface RecipePart {
  item: ItemId
  amount: number
}

export interface Recipe {
  id: RecipeId
  name: string
  alternate: boolean
  /** Craft time in seconds */
  time: number
  ingredients: RecipePart[]
  products: RecipePart[]
  machine: MachineId
  /** For variable-power machines (min/max MW); overrides machine power */
  variablePower?: { min: number; max: number }
}

export interface Machine {
  id: MachineId
  name: string
  /** MW at 100% clock */
  power: number
  /** Underclock power exponent (power * clock^exponent) */
  powerExponent: number
}

export interface Extractor {
  id: MachineId
  name: string
  /** MW */
  power: number
  /** Items (or m³) per minute at 100% clock, normal purity */
  ratePerMin: number
  allowedResources: ItemId[]
  liquid: boolean
}

export type Purity = 'impure' | 'normal' | 'pure'

export const PURITY_MULTIPLIER: Record<Purity, number> = {
  impure: 0.5,
  normal: 1,
  pure: 2,
}

export interface BeltTier {
  mk: number
  name: string
  /** Items per minute */
  speed: number
}

export interface PipeTier {
  mk: number
  name: string
  /** m³ per minute */
  speed: number
}

// Verified against https://satisfactory.wiki.gg/wiki/Conveyor_Belts
export const BELT_TIERS: BeltTier[] = [
  { mk: 1, name: 'Conveyor Belt Mk.1', speed: 60 },
  { mk: 2, name: 'Conveyor Belt Mk.2', speed: 120 },
  { mk: 3, name: 'Conveyor Belt Mk.3', speed: 270 },
  { mk: 4, name: 'Conveyor Belt Mk.4', speed: 480 },
  { mk: 5, name: 'Conveyor Belt Mk.5', speed: 780 },
  { mk: 6, name: 'Conveyor Belt Mk.6', speed: 1200 },
]

// Verified against https://satisfactory.wiki.gg/wiki/Pipelines
export const PIPE_TIERS: PipeTier[] = [
  { mk: 1, name: 'Pipeline Mk.1', speed: 300 },
  { mk: 2, name: 'Pipeline Mk.2', speed: 600 },
]

export interface GameData {
  items: Map<ItemId, Item>
  recipes: Map<RecipeId, Recipe>
  /** Recipes that produce a given item, default recipes first */
  recipesByProduct: Map<ItemId, Recipe[]>
  machines: Map<MachineId, Machine>
  /** AWESOME Sink building (consumes surplus for coupon points) */
  awesomeSink: Machine
  /** Solid miners indexed by tier (1-3) */
  minersByTier: Map<number, Extractor>
  oilExtractor: Extractor
  waterExtractor: Extractor
  /** Raw resources extractable from nodes (solids + crude oil) */
  nodeResources: ItemId[]
}
