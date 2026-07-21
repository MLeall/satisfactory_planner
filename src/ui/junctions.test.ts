import { describe, it, expect } from 'vitest'
import {
  balancedWidth,
  balancer,
  junctionTree,
  leafShares,
  treeLevels,
  type JunctionNode,
} from './junctions'

/** Every junction in the tree, flattened. */
function junctions(node: JunctionNode): JunctionNode[] {
  if (node.children.length === 0) return []
  return [node, ...node.children.flatMap(junctions)]
}

const spread = (n: number) => {
  const s = leafShares(n)
  return Math.max(...s) / Math.min(...s)
}

describe('junctionTree: game-legal shape', () => {
  it('needs no junction for a single consumer', () => {
    const tree = junctionTree(1)
    expect(tree.children).toHaveLength(0)
    expect(tree.leaves).toEqual([0])
    expect(treeLevels(tree)).toBe(0)
  })

  it('never gives a junction more than 3 branches, nor fewer than 2', () => {
    for (let n = 2; n <= 40; n++) {
      for (const j of junctions(junctionTree(n))) {
        expect(j.children.length).toBeGreaterThanOrEqual(2)
        expect(j.children.length).toBeLessThanOrEqual(3)
      }
    }
  })

  it('covers every consumer exactly once, in order', () => {
    for (let n = 1; n <= 40; n++) {
      expect(junctionTree(n).leaves).toEqual(
        Array.from({ length: n }, (_, i) => i),
      )
    }
  })

  it('splits a run of 3 with one 3-way junction', () => {
    const tree = junctionTree(3)
    expect(tree.children).toHaveLength(3)
    expect(tree.children.every((c) => c.children.length === 0)).toBe(true)
    expect(treeLevels(tree)).toBe(1)
  })

  it('splits a run of 6 two ways, then three ways', () => {
    // Both divide 6 evenly, but 2-then-3 costs three squares against four, and
    // it is the shape the 1:5 balancer everyone builds is based on.
    const tree = junctionTree(6)
    expect(tree.children).toHaveLength(2)
    expect(tree.children.map((c) => c.leaves)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ])
    expect(treeLevels(tree)).toBe(2)
  })

  it('breaks a tie on the fewest squares to build', () => {
    // Both shapes of 12 divide evenly; [6,6] is 7 junctions, [4,4,4] is 10.
    const tree = junctionTree(12)
    expect(tree.children.map((c) => c.leaves.length)).toEqual([6, 6])
    expect(junctions(tree)).toHaveLength(7)
  })

  it('uses one junction per 2 extra consumers at most', () => {
    for (let n = 2; n <= 40; n++) {
      // A 3-way junction turns 1 belt into 3, i.e. adds 2. That bounds how few
      // junctions can possibly wire n consumers.
      expect(junctions(junctionTree(n)).length).toBeGreaterThanOrEqual(
        Math.ceil((n - 1) / 2),
      )
    }
  })
})

describe('leafShares: what each consumer actually receives', () => {
  it('always sums to the whole run', () => {
    for (let n = 1; n <= 40; n++) {
      expect(leafShares(n).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
      expect(leafShares(n)).toHaveLength(n)
    }
  })

  it('divides evenly whenever n factors into 2s and 3s', () => {
    for (const n of [1, 2, 3, 4, 6, 8, 9, 12, 16, 18, 24, 27, 36]) {
      expect(spread(n)).toBeCloseTo(1, 9)
      for (const s of leafShares(n)) expect(s).toBeCloseTo(1 / n, 9)
    }
  })

  it('reports an uneven split when n has a prime factor past 3', () => {
    // No tree of 2- and 3-way splitters can divide 5 evenly: every leaf share
    // is 1/(2^a·3^b), and those never sum to five equal parts.
    for (const n of [5, 7, 10, 11]) expect(spread(n)).toBeGreaterThan(1)
  })

  it('picks the least lopsided tree available', () => {
    // 5 as [3,2] gives 1/6,1/6,1/6,1/4,1/4 (spread 1.5); as [2,2,1] it would
    // give a leaf 1/3 against leaves of 1/6 (spread 2).
    expect(spread(5)).toBeCloseTo(1.5, 9)
    expect([...leafShares(5)].sort((a, b) => a - b)).toEqual([
      1 / 6, 1 / 6, 1 / 6, 1 / 4, 1 / 4,
    ])
  })

  it('matches the share the tree structure implies', () => {
    for (let n = 1; n <= 24; n++) {
      const tree = junctionTree(n)
      const byLeaf = new Map<number, number>()
      const walk = (node: JunctionNode) => {
        if (node.children.length === 0) byLeaf.set(node.leaves[0], node.share)
        else node.children.forEach(walk)
      }
      walk(tree)
      leafShares(n).forEach((s, i) => expect(byLeaf.get(i)).toBeCloseTo(s, 9))
    }
  })

  it('gives every branch of a junction the same share', () => {
    for (let n = 2; n <= 40; n++) {
      for (const j of junctions(junctionTree(n))) {
        // A splitter in game divides its input equally among the belts it feeds.
        for (const c of j.children) {
          expect(c.share).toBeCloseTo(j.share / j.children.length, 9)
        }
      }
    }
  })
})

describe('balancedWidth: how wide the tree has to be built', () => {
  it('leaves a run alone when it already factors into 2s and 3s', () => {
    for (const n of [1, 2, 3, 4, 6, 8, 9, 12, 16, 18, 24, 27, 36])
      expect(balancedWidth(n)).toBe(n)
  })

  it('rounds up to the next such number otherwise', () => {
    // The 1:5 balancer everybody builds is a 6-wide tree with one leg looped
    // back; 1:7 is an 8-wide one, and so on.
    expect(balancedWidth(5)).toBe(6)
    expect(balancedWidth(7)).toBe(8)
    expect(balancedWidth(10)).toBe(12)
    expect(balancedWidth(11)).toBe(12)
    expect(balancedWidth(13)).toBe(16)
    expect(balancedWidth(19)).toBe(24)
  })

  it('is always a power-of-2-times-power-of-3 no smaller than n', () => {
    for (let n = 1; n <= 200; n++) {
      let w = balancedWidth(n)
      expect(w).toBeGreaterThanOrEqual(n)
      while (w % 2 === 0) w /= 2
      while (w % 3 === 0) w /= 3
      expect(w).toBe(1)
    }
  })
})

describe('balancer: an even split for any number of machines', () => {
  it('needs no loop when the tree already divides evenly', () => {
    for (const n of [1, 2, 3, 4, 6, 8, 9, 12]) {
      const b = balancer(n)
      expect(b.width).toBe(n)
      expect(b.loopback).toEqual([])
      expect(b.collector).toBeNull()
    }
  })

  it('loops the leftover legs back, as the 1:5 balancer does', () => {
    const b = balancer(5)
    expect(b.width).toBe(6)
    // The reference build: the trunk is split two ways, each half topped up by
    // a Merger and then divided three ways, giving six legs of equal rate.
    expect(b.tree.children).toHaveLength(2)
    expect(b.tree.children.every((c) => c.children.length === 3)).toBe(true)
    // Five legs feed machines, the sixth returns to the head of the tree.
    expect(b.loopback).toEqual([5])
    expect(b.collector).toBeNull() // a single leg needs no Merger to collect
    expect(leafShares(6).every((s) => Math.abs(s - 1 / 6) < 1e-9)).toBe(true)
  })

  it('gives every machine exactly the same rate, for any count', () => {
    for (let n = 1; n <= 60; n++) {
      const b = balancer(n)
      const shares = leafShares(b.width)
      // Every leg of the tree is equal, so the n legs that reach a machine are
      // equal too, whatever the loop returns.
      for (const s of shares) expect(s).toBeCloseTo(1 / b.width, 9)
      expect(b.loopback).toHaveLength(b.width - n)
    }
  })

  it('states what the loop carries relative to the run', () => {
    // A 1:5 balancer pushes 6/5 of the demand through the tree, 1/5 of it
    // being the leg that comes back round.
    expect(balancer(5).feedbackRatio).toBeCloseTo(1 / 5, 9)
    expect(balancer(7).feedbackRatio).toBeCloseTo(1 / 7, 9)
    expect(balancer(10).feedbackRatio).toBeCloseTo(2 / 10, 9)
    expect(balancer(6).feedbackRatio).toBe(0)
  })

  it('feeds the loop back through one Merger per branch of the root', () => {
    // The returning legs are divided by a Splitter into as many parts as the
    // root has branches, one part joining each branch through its own Merger.
    // That is what makes every branch receive an equal share.
    for (const n of [5, 7, 10, 11, 13, 19]) {
      const b = balancer(n)
      const branches = b.tree.children.length
      expect(branches).toBeGreaterThanOrEqual(2)
      expect(branches).toBeLessThanOrEqual(3)
      // Each branch carries the same number of legs, so an equal share is
      // exactly what it needs.
      const per = b.tree.children.map((c) => c.leaves.length)
      expect(new Set(per).size).toBe(1)
      expect(per[0] * branches).toBe(b.width)
    }
  })

  it('collects several returning legs through Mergers', () => {
    const b = balancer(10) // 12-wide tree, 2 legs come back
    expect(b.loopback).toEqual([10, 11])
    expect(b.collector).not.toBeNull()
    expect(b.collector!.leaves).toEqual([0, 1])
    expect(b.collector!.children).toHaveLength(2)
  })

  it('never wires a collecting Merger beyond 3 inbound belts', () => {
    for (let n = 1; n <= 200; n++) {
      const walk = (node: JunctionNode | null): void => {
        if (!node || node.children.length === 0) return
        expect(node.children.length).toBeLessThanOrEqual(3)
        node.children.forEach(walk)
      }
      walk(balancer(n).collector)
    }
  })
})
