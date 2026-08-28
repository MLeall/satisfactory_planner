import type { Objective, Optimization } from '../engine/optimize'
import { BELT_TIERS, PIPE_TIERS, type Purity } from '../engine/types'
import { fmt } from '../ui/format'
import type {
  BuildMode,
  ImportRow,
  NodeRow,
  OutputRow,
  PowerShards,
} from '../ui/plannerState'
import {
  data,
  IMPORT_OPTIONS,
  RESOURCE_OPTIONS,
  type Planner,
} from '../ui/usePlanner'
import type { ViewMode, WiringMode } from './Schematic'

const PURITIES: Purity[] = ['impure', 'normal', 'pure']

// What the recipe search was pushing on, in the words the result is read in.
const OBJECTIVE_LABEL: Record<Objective, string> = {
  output: 'more output',
  raw: 'fewer miners',
  power: 'less power',
}

function optimizeSummary(r: Optimization): string {
  const pct = Math.round((r.improvement - 1) * 100)
  const n = r.changes.length
  return (
    `${n} recipe${n > 1 ? 's' : ''} swapped for ${pct}% ${OBJECTIVE_LABEL[r.objective]}, ` +
    `out of ${r.solves} chains tried.`
  )
}

// Max clock unlocked by the shards slotted into each machine.
const SHARD_OPTIONS: { shards: PowerShards; label: string }[] = [
  { shards: 0, label: '100%' },
  { shards: 1, label: '150%' },
  { shards: 2, label: '200%' },
  { shards: 3, label: '250%' },
]

/** A two- or three-way segmented control bound to one state field. */
function Segmented<T extends string | number | boolean>({
  value,
  options,
  onPick,
}: {
  value: T
  options: { value: T; label: string }[]
  onPick: (value: T) => void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={value === o.value ? 'active' : ''}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function Console({ planner }: { planner: Planner }) {
  const { state, patch, outputs, targetOptions, recipeChoices, maxRates } =
    planner
  const { nodes, buildMode, powerShards, viewMode, wiringMode, showRates } =
    state

  const updateNode = (key: number, change: Partial<NodeRow>) =>
    patch({ nodes: nodes.map((n) => (n.key === key ? { ...n, ...change } : n)) })
  const updateImport = (key: number, change: Partial<ImportRow>) =>
    patch({
      imports: state.imports.map((i) =>
        i.key === key ? { ...i, ...change } : i,
      ),
    })
  const updateOutput = (key: number, change: Partial<OutputRow>) =>
    patch({
      outputs: state.outputs.map((o) =>
        o.key === key ? { ...o, ...change } : o,
      ),
    })

  return (
    <aside className="console">
      <section>
        <h2 className="eyebrow">Factories</h2>
        <div className="factory-row">
          <select
            aria-label="Factory"
            value={planner.activeId}
            onChange={(e) => planner.selectFactory(e.target.value)}
          >
            {planner.factories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button title="New factory" onClick={planner.newFactory}>
            +
          </button>
          <button
            className="remove"
            title="Delete this factory"
            disabled={planner.factories.length === 1}
            onClick={() => planner.deleteFactory(planner.activeId)}
          >
            &#10005;
          </button>
        </div>
        <input
          aria-label="Factory name"
          value={planner.activeName}
          onChange={(e) => planner.renameActive(e.target.value)}
        />
        <p className="recipe-note">
          Each factory is its own plan, all of them saved and shared together.
          One factory can import what another produces, so a change upstream
          reaches everything buying from it straight away.
        </p>
        {planner.oversubscribed.map((o) => (
          <p className="warn" key={`${o.from} ${o.item}`}>
            {o.consumers.join(' and ')} both draw on the same{' '}
            {data.items.get(o.item)?.name ?? o.item}, and each is planned as if
            it had all of it. Split the rate by hand, or build more.
          </p>
        ))}
      </section>

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
                patch({ nodes: nodes.filter((x) => x.key !== n.key) })
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="add-node"
          onClick={() =>
            patch({
              nodes: [
                ...nodes,
                {
                  key: planner.nextKey,
                  resource: 'Desc_OreIron_C',
                  purity: 'normal',
                  count: 1,
                },
              ],
            })
          }
        >
          + Add node
        </button>
      </section>

      <section>
        <h2 className="eyebrow">Imported inputs</h2>
        <p className="recipe-note">
          Parts belted in from elsewhere. Point a row at one of your other
          factories to take whatever it produces, and it follows along when that
          factory changes; leave it on the first option to type a rate in by
          hand. Either way the rate is a
          ceiling, not a promise: the plan takes what it needs up to it and
          builds only the difference, so the machines that would have made the
          item shrink as the import grows and vanish once it covers everything.
          Leave the rate blank to pull as much as the plan needs, which removes
          them outright. An import you also have a node for adds to the node
          rather than replacing it, and is used first — the miner covers the
          rest.
        </p>
        {state.imports.map((im) => {
          const from = im.from
            ? planner.sources.get(im.from)
            : undefined
          // A row drawing on one of your factories may only pick from what that
          // factory actually makes, and its rate is that factory's output.
          const options = from
            ? [...from.keys()].map((id) => ({
                id,
                name: data.items.get(id)?.name ?? id,
              }))
            : IMPORT_OPTIONS
          return (
            <div className="import-row" key={im.key}>
              <select
                className="import-source"
                aria-label="Imported from"
                value={im.from ?? ''}
                onChange={(e) => {
                  const next = e.target.value
                  if (!next) {
                    updateImport(im.key, { from: undefined })
                    return
                  }
                  // Point it at a factory, and at something that factory makes.
                  const made = [...(planner.sources.get(next)?.keys() ?? [])]
                  updateImport(im.key, {
                    from: next,
                    item: made.includes(im.item) ? im.item : (made[0] ?? im.item),
                  })
                }}
              >
                <option value="">Belted in, rate typed below</option>
                {planner.factories
                  .filter((f) => f.id !== planner.activeId)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      From {f.name}
                    </option>
                  ))}
              </select>
              <select
                aria-label="Imported item"
                value={im.item}
                onChange={(e) => updateImport(im.key, { item: e.target.value })}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
                {options.length === 0 && (
                  <option value={im.item}>(that factory makes nothing)</option>
                )}
              </select>
              <input
                aria-label="Imported rate per minute"
                type="number"
                min={0}
                step="any"
                placeholder="max"
                disabled={Boolean(im.from)}
                value={
                  im.from ? fmt(from?.get(im.item) ?? 0) : im.rate
                }
                onChange={(e) => updateImport(im.key, { rate: e.target.value })}
              />
              <button
                className="remove"
                title="Remove import"
                onClick={() =>
                  patch({
                    imports: state.imports.filter((x) => x.key !== im.key),
                  })
                }
              >
                &#10005;
              </button>
            </div>
          )
        })}
        <button
          className="add-node"
          onClick={() =>
            patch({
              imports: [
                ...state.imports,
                {
                  key: planner.nextKey,
                  item:
                    planner.chainItems[0]?.id ?? IMPORT_OPTIONS[0]?.id ?? '',
                  rate: '',
                },
              ],
            })
          }
        >
          + Add import
        </button>
      </section>

      <section>
        <h2 className="eyebrow">Logistics tier</h2>
        <div className="tier-grid">
          <div className="field">
            <label htmlFor="miner">Miner</label>
            <select
              id="miner"
              value={state.minerTier}
              onChange={(e) =>
                patch({ minerTier: Number(e.target.value) as 1 | 2 | 3 })
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
              value={state.beltMk}
              onChange={(e) => patch({ beltMk: Number(e.target.value) })}
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
              value={state.pipeMk}
              onChange={(e) => patch({ pipeMk: Number(e.target.value) })}
            >
              {PIPE_TIERS.map((p) => (
                <option key={p.mk} value={p.mk}>
                  Mk.{p.mk} · {p.speed}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="recipe-note">
          The best belt and pipe you have unlocked. Each run is then labelled
          with the cheapest tier that actually carries it, so a 30/min trickle
          is not built out of Mk.6.
        </p>
      </section>

      <section>
        <h2 className="eyebrow">Production targets</h2>
        <p className="recipe-note">
          Add one or more outputs. Shared intermediates are produced once and
          split. Leave every rate blank to let the planner balance the outputs
          against each other and push them to the max your nodes sustain.
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
            <span className="rate-hint">
              {maxRates.has(o.item) ? `MAX ${fmt(maxRates.get(o.item)!)}/min` : ' '}
            </span>
            <input
              aria-label="Output rate per minute"
              type="number"
              min={0}
              step="any"
              value={o.rate}
              onChange={(e) => updateOutput(o.key, { rate: e.target.value })}
            />
            <button
              className="remove"
              title="Remove output"
              disabled={outputs.length === 1}
              onClick={() =>
                patch({ outputs: state.outputs.filter((x) => x.key !== o.key) })
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="add-node"
          onClick={() =>
            patch({
              outputs: [
                ...state.outputs,
                {
                  key: planner.nextKey,
                  item: targetOptions[0]?.id ?? '',
                  rate: '',
                },
              ],
            })
          }
        >
          + Add output
        </button>
      </section>

      <section>
        <h2 className="eyebrow">Overflow</h2>
        <Segmented<BuildMode>
          value={buildMode}
          options={[
            { value: 'exact', label: 'Exact' },
            { value: 'whole', label: 'Whole machines' },
          ]}
          onPick={(v) => patch({ buildMode: v })}
        />
        <p className="recipe-note">
          {buildMode === 'exact'
            ? 'Every stage underclocks its last machine, so the chain produces exactly the demand. Only byproducts are left over, reported as surplus.'
            : 'No underclocking anywhere: machines and miners are rounded up and all run at 100%, the way factories are usually built. Every stage overproduces, and that overflow goes into an AWESOME Sink placed right beside the stage that spills it. Fluids are never sinkable and stay as surplus.'}
        </p>
      </section>

      <section>
        <h2 className="eyebrow">Overclocking</h2>
        <Segmented<PowerShards>
          value={powerShards}
          options={SHARD_OPTIONS.map((o) => ({
            value: o.shards,
            label: o.label,
          }))}
          onPick={(v) => patch({ powerShards: v })}
        />
        <p className="recipe-note">
          {powerShards === 0
            ? 'No Power Shards: every machine and miner stays at 100% clock.'
            : `${powerShards} Power Shard${powerShards > 1 ? 's' : ''} per machine unlocks up to ` +
              `${100 + 50 * powerShards}% clock, so each stage packs into fewer machines and ` +
              'miners pull more from a node (never past what the belt carries). ' +
              'Power draw rises with clock^1.32.'}
        </p>
      </section>

      <section>
        <h2 className="eyebrow">Floor plan view</h2>
        <Segmented<ViewMode>
          value={viewMode}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'complex', label: 'Complex' },
          ]}
          onPick={(v) => patch({ viewMode: v })}
        />
        <p className="recipe-note">
          {viewMode === 'standard'
            ? 'Compact: machines grouped per stage with counts.'
            : 'Every machine drawn individually, wired through real Splitters and Mergers: one belt in and up to three out, or three in and one out.'}
        </p>
        {viewMode === 'complex' && (
          <>
            <Segmented<WiringMode>
              value={wiringMode}
              options={[
                { value: 'tree', label: 'Tree' },
                { value: 'manifold', label: 'Manifold' },
              ]}
              onPick={(v) => patch({ wiringMode: v })}
            />
            <p className="recipe-note">
              {wiringMode === 'tree'
                ? 'A balanced tree of 2- and 3-way junctions: every belt is divided equally, so a machine count that factors into 2s and 3s comes out perfectly even.'
                : 'The plain manifold everyone builds: a single bus taps one machine per junction and passes the rest along. Fewer junctions, and belt backpressure evens the machines out.'}
            </p>
            <Segmented<boolean>
              value={showRates}
              options={[
                { value: true, label: 'Show rates' },
                { value: false, label: 'Hide rates' },
              ]}
              onPick={(v) => patch({ showRates: v })}
            />
            <p className="recipe-note">
              {showRates
                ? 'Every belt segment is labelled with what it carries, per minute.'
                : 'Belt segments are drawn without their throughput labels.'}
            </p>
          </>
        )}
      </section>

      {recipeChoices.length > 0 && (
        <section>
          <h2 className="eyebrow">Recipes</h2>
          <p className="recipe-note">
            Swap in alternate recipes; the chain rebalances instantly.
          </p>
          <button className="optimize" onClick={planner.optimize}>
            Find the best alternates
          </button>
          <p className="recipe-note">
            Tries the alternates against each other and keeps the combination
            that wins: more output while the rates are blank, fewer miners once
            you pin them. It assumes you have every alternate unlocked, so check
            the picks against your MAM before building.
          </p>
          {planner.optimization && (
            <p className="optimize-result">
              {planner.optimization.kind === 'none'
                ? 'This chain offers no choice of recipe.'
                : planner.optimization.kind === 'unchanged'
                  ? 'Nothing beat the recipes you already have.'
                  : optimizeSummary(planner.optimization.result)}
            </p>
          )}
          {recipeChoices.map((c) => (
            <div className="field" key={c.id}>
              <label htmlFor={`recipe-${c.id}`}>{c.name}</label>
              <select
                id={`recipe-${c.id}`}
                value={planner.selection[c.id] ?? c.recipes[0].id}
                onChange={(e) =>
                  patch({
                    selection: { ...state.selection, [c.id]: e.target.value },
                  })
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
  )
}
