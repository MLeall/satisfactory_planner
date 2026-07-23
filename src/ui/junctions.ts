// Splitters and Mergers as the game actually builds them.
//
// A Splitter is a square: one belt in, up to three out, and whatever arrives is
// divided equally among the outputs that are connected. A Merger is the same
// square mirrored: up to three belts in, one out. Neither has an N-way variant,
// so feeding N machines from one run means a *tree* of them.
//
// Every leaf of such a tree receives 1/(2^a·3^b) of the run, so a tree alone
// only divides evenly when N factors into 2s and 3s. For N = 5, 7, 10, 11 … the
// legs come out uneven and stay that way: the machine clocks are what settle
// the rates, so the wiring stays the plain tree the game builds.

/** A node of the wiring tree. Leaves are machines; anything with children is a
 * Splitter (fanning out) or a Merger (the same tree read backwards). */
export interface JunctionNode {
  /** Consumer/producer indices under this node, in drawing order */
  leaves: number[]
  /** Fraction of the run flowing through this node */
  share: number
  /** 2 or 3 branches, or none for a leaf */
  children: JunctionNode[]
}

/** Split `n` into `parts` groups as evenly as possible, largest first. */
function partition(n: number, parts: number): number[] {
  const base = Math.floor(n / parts)
  const extra = n % parts
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0))
}

const shapes = new Map<number, number[]>()

/** Squares a tree over `n` leaves costs to build. */
function junctionCount(n: number): number {
  if (n <= 1) return 0
  return 1 + shapeOf(n).reduce((sum, g) => sum + junctionCount(g), 0)
}

/** The branch sizes of the junction at the root, memoised. Between a 2-way and
 * a 3-way split we take whichever leaves the consumers least unevenly fed, and
 * on a tie the one costing fewer squares: 6 as [3,3] is three of them where
 * [2,2,2] is four, and the cheap shape is the one factories are built in.
 * Every branch is scaled by the same 1/parts, so the resulting spread is just
 * the widest share across the branches over the narrowest. */
function shapeOf(n: number): number[] {
  const cached = shapes.get(n)
  if (cached) return cached
  let best: number[] = []
  let bestSpread = Infinity
  let bestCost = Infinity
  for (const parts of [3, 2]) {
    if (parts > n) continue
    const groups = partition(n, parts)
    const shares = groups.map(leafShares)
    const spread =
      Math.max(...shares.map((s) => Math.max(...s))) /
      Math.min(...shares.map((s) => Math.min(...s)))
    const cost = 1 + groups.reduce((sum, g) => sum + junctionCount(g), 0)
    const better =
      spread < bestSpread - 1e-12 ||
      (spread < bestSpread + 1e-12 && cost < bestCost)
    if (better) {
      bestSpread = spread
      bestCost = cost
      best = groups
    }
  }
  shapes.set(n, best)
  return best
}

const sharesCache = new Map<number, number[]>()

/** What fraction of the run each of `n` consumers ends up receiving, in order.
 * Sums to 1; all entries equal 1/n exactly when n = 2^a·3^b. */
export function leafShares(n: number): number[] {
  if (n <= 1) return [1]
  const cached = sharesCache.get(n)
  if (cached) return cached
  const groups = shapeOf(n)
  const shares = groups.flatMap((g) => leafShares(g).map((s) => s / groups.length))
  sharesCache.set(n, shares)
  return shares
}

/** The Splitter tree feeding `n` consumers (read backwards: the Merger tree
 * collecting `n` producers). */
export function junctionTree(n: number, share = 1, offset = 0): JunctionNode {
  if (n <= 1) return { leaves: [offset], share, children: [] }
  const groups = shapeOf(n)
  const children: JunctionNode[] = []
  let at = offset
  for (const g of groups) {
    children.push(junctionTree(g, share / groups.length, at))
    at += g
  }
  return { leaves: children.flatMap((c) => c.leaves), share, children }
}

/** Levels of junctions between the trunk and the consumers; 0 when the run goes
 * straight to a single machine. */
export function treeLevels(node: JunctionNode): number {
  if (node.children.length === 0) return 0
  return 1 + Math.max(...node.children.map(treeLevels))
}
