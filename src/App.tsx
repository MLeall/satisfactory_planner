import { useEffect, useMemo, useState } from 'react'
import { loadGameData } from './data/loader'
import { getChainItems, reachableTargets } from './engine/helpers'
import { solve, type TargetOutput } from './engine/solve'
import { BELT_TIERS, PIPE_TIERS, type Purity } from './engine/types'
import Breakdown from './components/Breakdown'
import Schematic, { type ViewMode } from './components/Schematic'
import { fmt } from './ui/format'

const data = loadGameData()

interface NodeRow {
  key: number
  resource: string
  purity: Purity
  count: number
}

interface OutputRow {
  key: number
  item: string
  rate: string
}

interface PersistedState {
  nodes: NodeRow[]
  minerTier: 1 | 2 | 3
  beltMk: number
  pipeMk: number
  outputs: OutputRow[]
  selection: Record<string, string>
  sinkOverflow: boolean
  viewMode: ViewMode
}

const PURITIES: Purity[] = ['impure', 'normal', 'pure']
const STORAGE_KEY = 'ficsit-planner-v2'

const RESOURCE_OPTIONS = data.nodeResources
  .map((id) => ({ id, name: data.items.get(id)?.name ?? id }))
  .sort((a, b) => a.name.localeCompare(b.name))

function defaults(): PersistedState {
  return {
    nodes: [
      { key: 1, resource: 'Desc_OreIron_C', purity: 'normal', count: 1 },
    ],
    minerTier: 1,
    beltMk: 1,
    pipeMk: 1,
    outputs: [{ key: 1, item: 'Desc_IronPlate_C', rate: '' }],
    selection: {},
    sinkOverflow: false,
    viewMode: 'standard',
  }
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults()
    return { ...defaults(), ...(JSON.parse(raw) as Partial<PersistedState>) }
  } catch {
    return defaults()
  }
}

export default function App() {
  const initial = useMemo(loadState, [])
  const [nodes, setNodes] = useState<NodeRow[]>(initial.nodes)
  const [minerTier, setMinerTier] = useState<1 | 2 | 3>(initial.minerTier)
  const [beltMk, setBeltMk] = useState(initial.beltMk)
  const [pipeMk, setPipeMk] = useState(initial.pipeMk)
  const [outputs, setOutputs] = useState<OutputRow[]>(initial.outputs)
  const [selection, setSelection] = useState<Record<string, string>>(
    initial.selection,
  )
  const [sinkOverflow, setSinkOverflow] = useState(initial.sinkOverflow)
  const [viewMode, setViewMode] = useState<ViewMode>(initial.viewMode)

  // Keys unique across nodes and outputs, seeded past whatever we loaded.
  const [nextKey, setNextKey] = useState(
    () =>
      Math.max(
        0,
        ...initial.nodes.map((n) => n.key),
        ...initial.outputs.map((o) => o.key),
      ) + 1,
  )
  const takeKey = () => {
    const k = nextKey
    setNextKey((v) => v + 1)
    return k
  }

  useEffect(() => {
    const state: PersistedState = {
      nodes,
      minerTier,
      beltMk,
      pipeMk,
      outputs,
      selection,
      sinkOverflow,
      viewMode,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable — planning still works in-memory */
    }
  }, [nodes, minerTier, beltMk, pipeMk, outputs, selection, sinkOverflow, viewMode])

  const targetOptions = useMemo(() => {
    const ids = reachableTargets(
      data,
      nodes.map((n) => n.resource),
    )
    return ids
      .map((id) => ({ id, name: data.items.get(id)?.name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [nodes])

  const recipeChoices = useMemo(() => {
    const ids = new Set<string>()
    for (const o of outputs) {
      for (const id of getChainItems(data, o.item, selection)) ids.add(id)
    }
    return [...ids]
      .map((id) => ({
        id,
        name: data.items.get(id)?.name ?? id,
        recipes: data.recipesByProduct.get(id) ?? [],
      }))
      .filter((c) => c.recipes.length > 1)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [outputs, selection])

  const targets: TargetOutput[] = useMemo(
    () =>
      outputs.map((o) => {
        const rate = Number(o.rate)
        return o.rate.trim() !== '' && rate > 0
          ? { item: o.item, rate }
          : { item: o.item }
      }),
    [outputs],
  )

  const result = useMemo(
    () =>
      solve(data, {
        nodes,
        minerTier,
        beltMk,
        pipeMk,
        targets,
        recipeSelection: selection,
        sinkOverflow,
      }),
    [nodes, minerTier, beltMk, pipeMk, targets, selection, sinkOverflow],
  )

  // Max sustainable rate hint (only meaningful for a single output).
  const maxRate = useMemo(() => {
    if (outputs.length !== 1) return null
    const r = solve(data, {
      nodes,
      minerTier,
      beltMk,
      pipeMk,
      targets: [{ item: outputs[0].item }],
      recipeSelection: selection,
    })
    return r.ok ? r.plan.targets[0].rate : null
  }, [nodes, minerTier, beltMk, pipeMk, outputs, selection])

  const updateNode = (key: number, patch: Partial<NodeRow>) =>
    setNodes((ns) => ns.map((n) => (n.key === key ? { ...n, ...patch } : n)))
  const updateOutput = (key: number, patch: Partial<OutputRow>) =>
    setOutputs((os) => os.map((o) => (o.key === key ? { ...o, ...patch } : o)))

  const clearAll = () => {
    const d = defaults()
    setNodes(d.nodes)
    setMinerTier(d.minerTier)
    setBeltMk(d.beltMk)
    setPipeMk(d.pipeMk)
    setOutputs(d.outputs)
    setSelection(d.selection)
    setSinkOverflow(d.sinkOverflow)
    setViewMode(d.viewMode)
    setNextKey(2)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <header className="header">
        <h1>
          FICSIT<span> Factory Planner</span>
        </h1>
        <span className="tagline">
          From resource node to storage, fully balanced
        </span>
        <button className="clear-all" onClick={clearAll} title="Reset every field">
          Clear all
        </button>
      </header>

      <aside className="console">
        <section>
          <h2 className="eyebrow">Resource nodes</h2>
          {nodes.map((n) => (
            <div className="node-row" key={n.key}>
              <select
                aria-label="Resource"
                value={n.resource}
                onChange={(e) => updateNode(n.key, { resource: e.target.value })}
              >
                {RESOURCE_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Purity"
                value={n.purity}
                onChange={(e) =>
                  updateNode(n.key, { purity: e.target.value as Purity })
                }
              >
                {PURITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                aria-label="Node count"
                type="number"
                min={1}
                value={n.count}
                onChange={(e) =>
                  updateNode(n.key, {
                    count: Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
              <button
                className="remove"
                title="Remove node"
                onClick={() =>
                  setNodes((ns) => ns.filter((x) => x.key !== n.key))
                }
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="add-node"
            onClick={() =>
              setNodes((ns) => [
                ...ns,
                {
                  key: takeKey(),
                  resource: 'Desc_OreIron_C',
                  purity: 'normal',
                  count: 1,
                },
              ])
            }
          >
            + Add node
          </button>
        </section>

        <section>
          <h2 className="eyebrow">Logistics tier</h2>
          <div className="tier-grid">
            <div className="field">
              <label htmlFor="miner">Miner</label>
              <select
                id="miner"
                value={minerTier}
                onChange={(e) =>
                  setMinerTier(Number(e.target.value) as 1 | 2 | 3)
                }
              >
                {[1, 2, 3].map((t) => (
                  <option key={t} value={t}>
                    Mk.{t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="belt">Belt</label>
              <select
                id="belt"
                value={beltMk}
                onChange={(e) => setBeltMk(Number(e.target.value))}
              >
                {BELT_TIERS.map((b) => (
                  <option key={b.mk} value={b.mk}>
                    Mk.{b.mk} · {b.speed}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pipe">Pipe</label>
              <select
                id="pipe"
                value={pipeMk}
                onChange={(e) => setPipeMk(Number(e.target.value))}
              >
                {PIPE_TIERS.map((p) => (
                  <option key={p.mk} value={p.mk}>
                    Mk.{p.mk} · {p.speed}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section>
          <h2 className="eyebrow">Production targets</h2>
          <p className="recipe-note">
            Add one or more outputs. Shared intermediates are produced once and
            split. Leave the rate blank (single output only) to plan the max.
          </p>
          {outputs.map((o) => (
            <div className="output-row" key={o.key}>
              <select
                aria-label="Output item"
                value={o.item}
                onChange={(e) => updateOutput(o.key, { item: e.target.value })}
              >
                {targetOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Output rate per minute"
                type="number"
                min={0}
                step="any"
                value={o.rate}
                placeholder={
                  outputs.length === 1 && maxRate != null
                    ? `max ${fmt(maxRate)}`
                    : '/min'
                }
                onChange={(e) => updateOutput(o.key, { rate: e.target.value })}
              />
              <button
                className="remove"
                title="Remove output"
                disabled={outputs.length === 1}
                onClick={() =>
                  setOutputs((os) => os.filter((x) => x.key !== o.key))
                }
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="add-node"
            onClick={() =>
              setOutputs((os) => [
                ...os,
                { key: takeKey(), item: targetOptions[0]?.id ?? '', rate: '10' },
              ])
            }
          >
            + Add output
          </button>
        </section>

        <section>
          <h2 className="eyebrow">Overflow</h2>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={sinkOverflow}
              onChange={(e) => setSinkOverflow(e.target.checked)}
            />
            <span>
              Smart Splitter + AWESOME Sink combo
              <small>
                Route solid byproduct overflow into AWESOME Sinks for coupon
                points instead of leaving it as surplus.
              </small>
            </span>
          </label>
        </section>

        <section>
          <h2 className="eyebrow">Floor plan view</h2>
          <div className="segmented">
            <button
              className={viewMode === 'standard' ? 'active' : ''}
              onClick={() => setViewMode('standard')}
            >
              Standard
            </button>
            <button
              className={viewMode === 'complex' ? 'active' : ''}
              onClick={() => setViewMode('complex')}
            >
              Complex
            </button>
          </div>
          <p className="recipe-note">
            {viewMode === 'standard'
              ? 'Compact: machines grouped per stage with counts.'
              : 'Every machine drawn individually, wired through Splitters and Mergers.'}
          </p>
        </section>

        {recipeChoices.length > 0 && (
          <section>
            <h2 className="eyebrow">Recipes</h2>
            <p className="recipe-note">
              Swap in alternate recipes; the chain rebalances instantly.
            </p>
            {recipeChoices.map((c) => (
              <div className="field" key={c.id}>
                <label htmlFor={`recipe-${c.id}`}>{c.name}</label>
                <select
                  id={`recipe-${c.id}`}
                  value={selection[c.id] ?? c.recipes[0].id}
                  onChange={(e) =>
                    setSelection((s) => ({ ...s, [c.id]: e.target.value }))
                  }
                >
                  {c.recipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </section>
        )}
      </aside>

      <main className="main">
        {result.ok ? (
          <>
            <div className="canvas">
              <Schematic
                plan={result.plan}
                data={data}
                beltMk={beltMk}
                pipeMk={pipeMk}
                viewMode={viewMode}
              />
            </div>
            <Breakdown plan={result.plan} data={data} />
          </>
        ) : (
          <div className="errors">
            <h2>Cannot plan this chain</h2>
            <ul>
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </>
  )
}
