import { useMemo, useState } from 'react'
import { loadGameData } from './data/loader'
import { getChainItems, reachableTargets } from './engine/helpers'
import { solve } from './engine/solve'
import { BELT_TIERS, PIPE_TIERS, type Purity } from './engine/types'
import Breakdown from './components/Breakdown'
import Schematic from './components/Schematic'
import { fmt } from './ui/format'

const data = loadGameData()

interface NodeRow {
  key: number
  resource: string
  purity: Purity
  count: number
}

const PURITIES: Purity[] = ['impure', 'normal', 'pure']

const RESOURCE_OPTIONS = data.nodeResources
  .map((id) => ({ id, name: data.items.get(id)?.name ?? id }))
  .sort((a, b) => a.name.localeCompare(b.name))

let nextKey = 1

export default function App() {
  const [nodes, setNodes] = useState<NodeRow[]>([
    { key: nextKey++, resource: 'Desc_OreIron_C', purity: 'normal', count: 1 },
  ])
  const [minerTier, setMinerTier] = useState<1 | 2 | 3>(1)
  const [beltMk, setBeltMk] = useState(1)
  const [pipeMk, setPipeMk] = useState(1)
  const [targetItem, setTargetItem] = useState('Desc_IronPlate_C')
  const [targetRate, setTargetRate] = useState('')
  const [selection, setSelection] = useState<Record<string, string>>({})

  const rateValue = Number(targetRate)
  const parsedTarget =
    targetRate.trim() !== '' && rateValue > 0 ? rateValue : undefined

  const targetOptions = useMemo(() => {
    const ids = reachableTargets(data, nodes.map((n) => n.resource))
    return ids
      .map((id) => ({ id, name: data.items.get(id)?.name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [nodes])

  const recipeChoices = useMemo(
    () =>
      getChainItems(data, targetItem, selection)
        .map((id) => ({
          id,
          name: data.items.get(id)?.name ?? id,
          recipes: data.recipesByProduct.get(id) ?? [],
        }))
        .filter((c) => c.recipes.length > 1),
    [targetItem, selection],
  )

  const maxRate = useMemo(() => {
    const r = solve(data, {
      nodes,
      minerTier,
      beltMk,
      pipeMk,
      targetItem,
      recipeSelection: selection,
    })
    return r.ok ? r.plan.targetRate : null
  }, [nodes, minerTier, beltMk, pipeMk, targetItem, selection])

  const result = useMemo(
    () =>
      solve(data, {
        nodes,
        minerTier,
        beltMk,
        pipeMk,
        targetItem,
        recipeSelection: selection,
        targetRate: parsedTarget,
      }),
    [nodes, minerTier, beltMk, pipeMk, targetItem, selection, parsedTarget],
  )

  const updateNode = (key: number, patch: Partial<NodeRow>) =>
    setNodes((ns) => ns.map((n) => (n.key === key ? { ...n, ...patch } : n)))

  return (
    <>
      <header className="header">
        <h1>
          FICSIT<span> Factory Planner</span>
        </h1>
        <span className="tagline">
          From resource node to storage, fully balanced
        </span>
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
                  key: nextKey++,
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
          <h2 className="eyebrow">Production target</h2>
          <p className="recipe-note">
            Only items producible from your resource nodes are listed. Add
            more nodes to unlock more outputs.
          </p>
          <div className="field">
            <label htmlFor="target">Output item</label>
            <select
              id="target"
              value={targetItem}
              onChange={(e) => setTargetItem(e.target.value)}
            >
              {targetOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rate">Output rate (/min)</label>
            <input
              id="rate"
              type="number"
              min={0}
              step="any"
              value={targetRate}
              placeholder={maxRate != null ? `max ${fmt(maxRate)}` : 'auto'}
              onChange={(e) => setTargetRate(e.target.value)}
            />
          </div>
          <p className="recipe-note">
            Leave blank to plan the maximum your nodes sustain
            {maxRate != null ? ` (${fmt(maxRate)}/min)` : ''}.
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
              />
            </div>
            <Breakdown plan={result.plan} data={data} targetItem={targetItem} />
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
