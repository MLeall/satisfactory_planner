import { describe, it, expect } from 'vitest'
import { loadGameData } from '../data/loader'
import { solve } from '../engine/solve'
import {
  activePlan,
  addFactory,
  defaultLibrary,
  hydrateLibrary,
  importRate,
  lookupIn,
  oversubscriptions,
  patchActive,
  planInputOf,
  removeFactory,
  renameFactory,
  resolveOutputs,
  type Factory,
  type Library,
} from './library'
import { defaults, type PlannerState } from './plannerState'
import { encodeShare } from './share'

const data = loadGameData()
const none = lookupIn(new Map())

const plan = (over: Partial<PlannerState>): PlannerState => ({
  ...defaults(),
  ...over,
})

const factory = (id: string, name: string, over: Partial<PlannerState>) =>
  ({ id, name, plan: plan(over) }) satisfies Factory

const library = (factories: Factory[], activeId = factories[0].id): Library => ({
  factories,
  activeId,
})

describe('hydrateLibrary', () => {
  it('falls back to one empty factory with nothing saved or shared', () => {
    expect(hydrateLibrary(null, '')).toEqual(defaultLibrary())
  })

  it('restores what was saved', () => {
    const saved = library([factory('f1', 'Smelting', { beltMk: 4 })])
    expect(hydrateLibrary(JSON.stringify(saved), '')).toEqual(saved)
  })

  it('fills gaps in a saved plan from the defaults', () => {
    // A library written by an older build is missing the newer plan fields.
    const saved = { factories: [{ id: 'f1', name: 'A', plan: { beltMk: 3 } }] }
    const lib = hydrateLibrary(JSON.stringify(saved), '')
    expect(activePlan(lib).beltMk).toBe(3)
    expect(activePlan(lib).powerShards).toBe(defaults().powerShards)
  })

  it('adopts a plan saved before there were several factories', () => {
    // The old shape was a bare plan. It becomes the one factory of a library
    // rather than being thrown away on the next visit.
    const legacy = JSON.stringify({ ...defaults(), beltMk: 5 })
    const lib = hydrateLibrary(legacy, '')
    expect(lib.factories).toHaveLength(1)
    expect(activePlan(lib).beltMk).toBe(5)
  })

  it('lets a shared link win over what was saved', () => {
    const saved = JSON.stringify(library([factory('f1', 'Saved', { beltMk: 6 })]))
    const shared = encodeShare(library([factory('f1', 'Shared', { beltMk: 2 })]))
    const lib = hydrateLibrary(saved, shared)
    expect(lib.factories[0].name).toBe('Shared')
    expect(activePlan(lib).beltMk).toBe(2)
  })

  it('shares a whole library, not just the plan on screen', () => {
    const lib = library(
      [factory('f1', 'Ore', {}), factory('f2', 'Plates', {})],
      'f2',
    )
    expect(hydrateLibrary(null, encodeShare(lib))).toEqual(lib)
  })

  it('ignores a corrupt save instead of blanking the console', () => {
    expect(hydrateLibrary('{not json', '')).toEqual(defaultLibrary())
  })

  it('ignores a tampered fragment and keeps what was saved', () => {
    const saved = JSON.stringify(library([factory('f1', 'Kept', { beltMk: 6 })]))
    expect(hydrateLibrary(saved, 'not-a-real-token').factories[0].name).toBe(
      'Kept',
    )
  })

  it('falls back when the active id points at nothing', () => {
    const saved = JSON.stringify({
      factories: [{ id: 'f1', name: 'A', plan: defaults() }],
      activeId: 'gone',
    })
    expect(hydrateLibrary(saved, '').activeId).toBe('f1')
  })
})

describe('editing the library', () => {
  it('edits only the factory being looked at', () => {
    const lib = library(
      [factory('f1', 'A', { beltMk: 1 }), factory('f2', 'B', { beltMk: 1 })],
      'f2',
    )
    const next = patchActive(lib, { beltMk: 5 })
    expect(next.factories[0].plan.beltMk).toBe(1)
    expect(next.factories[1].plan.beltMk).toBe(5)
  })

  it('gives a new factory an unused id and opens it', () => {
    const lib = addFactory(defaultLibrary())
    expect(lib.factories.map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(lib.activeId).toBe('f2')
  })

  it('renames without touching the plan', () => {
    const lib = renameFactory(defaultLibrary(), 'f1', 'Steel')
    expect(lib.factories[0].name).toBe('Steel')
    expect(lib.factories[0].plan).toEqual(defaults())
  })

  it('never deletes the last factory away to nothing', () => {
    expect(removeFactory(defaultLibrary(), 'f1')).toEqual(defaultLibrary())
  })

  it('moves to another factory when the open one is deleted', () => {
    const lib = library([factory('f1', 'A', {}), factory('f2', 'B', {})], 'f2')
    expect(removeFactory(lib, 'f2').activeId).toBe('f1')
  })

  it('cuts a belt from a deleted factory into a plain typed rate', () => {
    const lib = library([
      factory('f1', 'Ingots', {}),
      factory('f2', 'Plates', {
        imports: [{ key: 1, item: 'Desc_IronIngot_C', rate: '', from: 'f1' }],
      }),
    ])
    const sources = lookupIn(
      new Map([['f1', new Map([['Desc_IronIngot_C', 60]])]]),
    )
    const row = removeFactory(lib, 'f1', sources).factories[0].plan.imports[0]
    // It keeps delivering what it last delivered, now as an ordinary import.
    expect(row.from).toBeUndefined()
    expect(row.rate).toBe('60')
  })
})

describe('importRate', () => {
  const sources = lookupIn(
    new Map([['f1', new Map([['Desc_IronIngot_C', 42]])]]),
  )

  it('reads a typed rate', () => {
    expect(
      importRate({ key: 1, item: 'Desc_IronIngot_C', rate: '30' }, none),
    ).toBe(30)
  })

  it('treats a blank rate as "as much as the plan needs"', () => {
    expect(
      importRate({ key: 1, item: 'Desc_IronIngot_C', rate: '' }, none),
    ).toBeUndefined()
  })

  it('takes what the named factory produces', () => {
    expect(
      importRate(
        { key: 1, item: 'Desc_IronIngot_C', rate: '999', from: 'f1' },
        sources,
      ),
    ).toBe(42)
  })

  it('delivers nothing when the source makes none of it', () => {
    expect(
      importRate(
        { key: 1, item: 'Desc_IronPlate_C', rate: '', from: 'f1' },
        sources,
      ),
    ).toBe(0)
  })
})

describe('planInputOf', () => {
  it('sinks the overflow of a whole-machine plan and nothing else', () => {
    expect(planInputOf(data, plan({ buildMode: 'whole' }), none).sinkOverflow).toBe(
      true,
    )
    expect(planInputOf(data, plan({ buildMode: 'exact' }), none).sinkOverflow).toBe(
      false,
    )
  })

  it('leaves a blank output rate for the planner to size', () => {
    const input = planInputOf(
      data,
      plan({ outputs: [{ key: 1, item: 'Desc_IronPlate_C', rate: '' }] }),
      none,
    )
    expect(input.targets).toEqual([{ item: 'Desc_IronPlate_C' }])
  })
})

describe('resolveOutputs: one factory feeding another', () => {
  const lib = library([
    factory('f1', 'Smelting', {
      nodes: [{ key: 1, resource: 'Desc_OreIron_C', purity: 'normal', count: 1 }],
      outputs: [{ key: 1, item: 'Desc_IronIngot_C', rate: '' }],
    }),
    factory('f2', 'Plates', {
      nodes: [],
      imports: [{ key: 1, item: 'Desc_IronIngot_C', rate: '', from: 'f1' }],
      outputs: [{ key: 2, item: 'Desc_IronPlate_C', rate: '' }],
    }),
  ])
  const sources = resolveOutputs(data, lib)

  it('reports what the upstream factory makes', () => {
    // One normal node on a Mk.1 belt: 60 ore -> 60 ingots.
    expect(sources.get('f1')!.get('Desc_IronIngot_C')).toBeCloseTo(60, 6)
  })

  it('plans the downstream one off that, with no node of its own', () => {
    // 60 ingots belted in -> 40 plates, and not a miner in sight.
    expect(sources.get('f2')!.get('Desc_IronPlate_C')).toBeCloseTo(40, 6)
    const result = solve(
      data,
      planInputOf(data, lib.factories[1].plan, lookupIn(sources)),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.stages.some((s) => s.kind === 'extractor')).toBe(false)
    expect(result.plan.imports[0].rate).toBeCloseTo(60, 6)
  })

  it('follows the upstream factory when it changes', () => {
    const bigger = patchActive(
      { ...lib, activeId: 'f1' },
      {
        nodes: [
          { key: 1, resource: 'Desc_OreIron_C', purity: 'normal', count: 2 },
        ],
      },
    )
    const after = resolveOutputs(data, bigger)
    expect(after.get('f1')!.get('Desc_IronIngot_C')).toBeCloseTo(120, 6)
    expect(after.get('f2')!.get('Desc_IronPlate_C')).toBeCloseTo(80, 6)
  })

  it('cuts a cycle instead of hanging on it', () => {
    const looped = library([
      factory('f1', 'A', {
        nodes: [],
        imports: [{ key: 1, item: 'Desc_IronPlate_C', rate: '', from: 'f2' }],
        outputs: [{ key: 1, item: 'Desc_IronRod_C', rate: '' }],
      }),
      factory('f2', 'B', {
        nodes: [],
        imports: [{ key: 1, item: 'Desc_IronRod_C', rate: '', from: 'f1' }],
        outputs: [{ key: 1, item: 'Desc_IronPlate_C', rate: '' }],
      }),
    ])
    const resolved = resolveOutputs(data, looped)
    expect([...resolved.keys()].sort()).toEqual(['f1', 'f2'])
  })
})

describe('oversubscriptions', () => {
  const shared = (from: string) => ({
    key: 1,
    item: 'Desc_IronIngot_C',
    rate: '',
    from,
  })

  it('says when two factories are both planned as if they had all of it', () => {
    const lib = library([
      factory('f1', 'Ingots', {}),
      factory('f2', 'Plates', { imports: [shared('f1')] }),
      factory('f3', 'Rods', { imports: [shared('f1')] }),
    ])
    const warnings = oversubscriptions(lib)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].consumers).toEqual(['Plates', 'Rods'])
    expect(warnings[0].item).toBe('Desc_IronIngot_C')
  })

  it('stays quiet when only one factory draws on a source', () => {
    const lib = library([
      factory('f1', 'Ingots', {}),
      factory('f2', 'Plates', { imports: [shared('f1')] }),
    ])
    expect(oversubscriptions(lib)).toEqual([])
  })

  it('stays quiet about rates typed in by hand', () => {
    const typed = { key: 1, item: 'Desc_IronIngot_C', rate: '60' }
    const lib = library([
      factory('f1', 'A', { imports: [typed] }),
      factory('f2', 'B', { imports: [typed] }),
    ])
    expect(oversubscriptions(lib)).toEqual([])
  })
})
