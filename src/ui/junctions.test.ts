import { describe, it, expect } from 'vitest'
import {
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
    // Both divide 6 evenly, but 2-then-3 costs three squares against four.
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
    // is 1/(2^a·3^b), and those never sum to five equal parts. The tree is
    // still what gets drawn; evening the machines out is the clock's job.
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
