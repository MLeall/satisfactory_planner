// Splitters and Mergers as the game actually builds them.
//
// A Splitter is a square: one belt in, up to three out, and whatever arrives is
// divided equally among the outputs that are connected. A Merger is the same
// square mirrored: up to three belts in, one out. Neither has an N-way variant,
// so feeding N machines from one run means a *tree* of them.
//
// Every leaf of such a tree receives 1/(2^a·3^b) of the run, so a tree alone
// only divides evenly when N factors into 2s and 3s. For N = 5, 7, 10, 11 … the
// way out is the load balancer further down: overbuild the tree and feed the
// spare legs back round.

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

// ---------------------------------------------------------------------------
// Odd counts: the load balancer.
//
// Since every leg of a Splitter tree carries 1/(2^a·3^b) of the run, an even
// split into 5, 7, 10, 11 … machines is impossible on a tree alone. The way it
// is actually built in game is to overbuild the tree to the next width that
// *does* divide evenly and send the spare legs back round into the head of the
// tree, so the loop tops the trunk up to what the wider tree needs.
//
// The 1:5 balancer is the familiar case: a 6-wide tree, five legs to machines
// and the sixth returning. The trunk carries 5, the loop carries 1, and the
// tree divides the resulting 6 into six equal legs.
// ---------------------------------------------------------------------------

/** Smallest 2^a·3^b at least `n`: how wide the tree has to be built for its
 * legs to come out equal. */
export function balancedWidth(n: number): number {
  if (n <= 1) return 1
  for (let w = n; ; w++) {
    let rest = w
    while (rest % 2 === 0) rest /= 2
    while (rest % 3 === 0) rest /= 3
    if (rest === 1) return w
  }
}

export interface Balancer {
  /** The Splitter tree, `width` legs all carrying the same rate */
  tree: JunctionNode
  /** Legs the tree is built with, at least the machine count */
  width: number
  /** Leg indices that go back round instead of reaching a machine */
  loopback: number[]
  /** Merger tree collecting those legs; null for none or a single one, which
   * needs no Merger to join. */
  collector: JunctionNode | null
  /** What the loop carries, as a fraction of the run reaching the machines. */
  feedbackRatio: number
}

/** How to wire a run to `n` identical machines so each gets exactly the same
 * rate: a tree, plus the loop that makes an awkward `n` come out even. */
export function balancer(n: number): Balancer {
  const width = balancedWidth(n)
  const loopback = Array.from({ length: width - n }, (_, i) => n + i)
  return {
    tree: junctionTree(width),
    width,
    loopback,
    collector: loopback.length > 1 ? junctionTree(loopback.length) : null,
    feedbackRatio: loopback.length / n,
  }
}
