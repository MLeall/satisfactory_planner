import type { Plan, Stage } from '../engine/solve'
import type { GameData } from '../engine/types'
import { fmt } from '../ui/format'

export type ViewMode = 'standard' | 'complex'

interface Props {
  plan: Plan
  data: GameData
  beltMk: number
  pipeMk: number
  viewMode: ViewMode
}

export default function Schematic(props: Props) {
  return props.viewMode === 'complex' ? (
    <ComplexSchematic {...props} />
  ) : (
    <StandardSchematic {...props} />
  )
}

// ---------------------------------------------------------------------------
// Standard: one box per stage, machines grouped with counts.
// ---------------------------------------------------------------------------

const W = 216
const H = 88
const XGAP = 130
const YGAP = 42
const PAD = 34

function StandardSchematic({ plan, data, beltMk, pipeMk }: Props) {
  const itemName = (id: string) => data.items.get(id)?.name ?? id

  const columns = new Map<number, Stage[]>()
  for (const stage of plan.stages) {
    const col = columns.get(stage.depth) ?? []
    col.push(stage)
    columns.set(stage.depth, col)
  }
  const depths = [...columns.keys()].sort((a, b) => a - b)
  const xOf = new Map(depths.map((d, i) => [d, PAD + i * (W + XGAP)]))

  const maxRows = Math.max(...[...columns.values()].map((c) => c.length))
  const height = maxRows * H + (maxRows - 1) * YGAP + PAD * 2
  const width = PAD * 2 + depths.length * W + (depths.length - 1) * XGAP

  const pos = new Map<string, { x: number; y: number }>()
  for (const d of depths) {
    const col = columns.get(d)!
    const colH = col.length * H + (col.length - 1) * YGAP
    let y = (height - colH) / 2
    for (const stage of col) {
      pos.set(stage.id, { x: xOf.get(d)!, y })
      y += H + YGAP
    }
  }

  const subLabel = (s: Stage): string => {
    if (s.kind === 'machine') return s.recipeName ?? ''
    if (s.kind === 'extractor') return itemName(s.outputs[0].item)
    if (s.kind === 'sink') return itemName(s.inputs[0].item)
    return itemName(s.inputs[0].item)
  }

  const metaLabel = (s: Stage): string => {
    if (s.kind === 'storage') return `${fmt(s.inputs[0].rate)}/min stored`
    if (s.kind === 'sink') return `${fmt(s.powerMW)} MW · sink`
    const clock =
      s.lastClockPercent < 100 ? ` · last @ ${fmt(s.lastClockPercent)}%` : ''
    return `${fmt(s.powerMW)} MW${clock}`
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Factory schematic (standard)"
    >
      {plan.edges.map((e, i) => {
        const from = pos.get(e.from)
        const to = pos.get(e.to)
        if (!from || !to) return null
        const sx = from.x + W
        const sy = from.y + H / 2
        const tx = to.x
        const ty = to.y + H / 2
        const mx = (sx + tx) / 2
        const my = (sy + ty) / 2
        const transport =
          e.transport === 'belt' ? `Belt Mk.${beltMk}` : `Pipe Mk.${pipeMk}`
        return (
          <g key={i}>
            <path
              className={`edge edge--${e.transport}`}
              d={`M ${sx} ${sy} C ${sx + 55} ${sy}, ${tx - 55} ${ty}, ${tx} ${ty}`}
            />
            <text className="edge-label" x={mx} y={my - 22}>
              {itemName(e.item)} · {fmt(e.rate)}/min
            </text>
            <text className="edge-label edge-label--transport" x={mx} y={my - 8}>
              {e.lanes}× {transport}
            </text>
          </g>
        )
      })}
      {plan.stages.map((s) => {
        const p = pos.get(s.id)!
        return (
          <g key={s.id} className={`stage stage--${s.kind}`}>
            <rect className="stage-box" x={p.x} y={p.y} width={W} height={H} rx={5} />
            <text className="stage-count" x={p.x + 12} y={p.y + 26}>
              {s.machinesBuilt}× {s.machineName}
            </text>
            <text className="stage-sub" x={p.x + 12} y={p.y + 47}>
              {subLabel(s)}
            </text>
            <text className="stage-meta" x={p.x + 12} y={p.y + 70}>
              {metaLabel(s)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Complex: every machine individually, wired through Splitters and Mergers.
// ---------------------------------------------------------------------------

const CW = 158
const CH = 46
const CYGAP = 18
const CXGAP = 180
const CPAD = 34
const NODE = 30 // splitter / merger square

interface Unit {
  x: number
  y: number
}

interface CLink {
  x1: number
  y1: number
  x2: number
  y2: number
  transport: 'belt' | 'pipe'
}

function ComplexSchematic({ plan, data, beltMk, pipeMk }: Props) {
  const itemName = (id: string) => data.items.get(id)?.name ?? id

  // How many individual units a stage expands into.
  const unitCount = (s: Stage) =>
    s.kind === 'storage' ? 1 : Math.max(1, s.machinesBuilt)

  // Group stages by depth column, then flatten to individual units per column.
  const columns = new Map<number, Stage[]>()
  for (const stage of plan.stages) {
    const col = columns.get(stage.depth) ?? []
    col.push(stage)
    columns.set(stage.depth, col)
  }
  const depths = [...columns.keys()].sort((a, b) => a - b)
  const xOf = new Map(depths.map((d, i) => [d, CPAD + i * (CW + CXGAP)]))

  const colUnitCount = (d: number) =>
    (columns.get(d) ?? []).reduce((n, s) => n + unitCount(s), 0)
  const maxUnits = Math.max(1, ...depths.map(colUnitCount))
  const height = maxUnits * CH + (maxUnits - 1) * CYGAP + CPAD * 2
  const width = CPAD * 2 + depths.length * CW + (depths.length - 1) * CXGAP

  // Position units, keyed by stage id.
  const unitsOf = new Map<string, Unit[]>()
  const stageMeta: {
    stage: Stage
    units: Unit[]
  }[] = []
  for (const d of depths) {
    const col = columns.get(d)!
    const total = colUnitCount(d)
    const colH = total * CH + (total - 1) * CYGAP
    let y = (height - colH) / 2
    const x = xOf.get(d)!
    for (const stage of col) {
      const units: Unit[] = []
      for (let i = 0; i < unitCount(stage); i++) {
        units.push({ x, y })
        y += CH + CYGAP
      }
      unitsOf.set(stage.id, units)
      stageMeta.push({ stage, units })
    }
  }

  const centroidY = (units: Unit[]) =>
    units.reduce((sum, u) => sum + u.y + CH / 2, 0) / units.length

  // Build wiring: producers -> [merger] -> [splitter] -> consumers.
  const links: CLink[] = []
  const junctions: { x: number; y: number; kind: 'splitter' | 'merger' }[] = []
  const labels: { x: number; y: number; text: string; sub: string }[] = []

  for (const e of plan.edges) {
    const producers = unitsOf.get(e.from)
    const consumers = unitsOf.get(e.to)
    if (!producers || !consumers) continue
    const transport = e.transport
    const toCol = consumers[0].x
    const splitterX = toCol - 44
    const mergerX = toCol - 44 - NODE - 24
    const cy = centroidY(consumers)

    const right = (u: Unit) => ({ x: u.x + CW, y: u.y + CH / 2 })
    const left = (u: Unit) => ({ x: u.x, y: u.y + CH / 2 })

    const needMerger = producers.length > 1
    const needSplitter = consumers.length > 1

    let handoffX: number
    let handoffY: number

    if (needMerger) {
      const mx = mergerX
      const my = cy
      junctions.push({ x: mx, y: my - NODE / 2, kind: 'merger' })
      for (const p of producers) {
        const s = right(p)
        links.push({ x1: s.x, y1: s.y, x2: mx, y2: my, transport })
      }
      handoffX = mx + NODE
      handoffY = my
    } else {
      const s = right(producers[0])
      handoffX = s.x
      handoffY = s.y
    }

    if (needSplitter) {
      const sx = splitterX
      const sy = cy
      junctions.push({ x: sx, y: sy - NODE / 2, kind: 'splitter' })
      links.push({ x1: handoffX, y1: handoffY, x2: sx, y2: sy, transport })
      for (const c of consumers) {
        const t = left(c)
        links.push({ x1: sx + NODE, y1: sy, x2: t.x, y2: t.y, transport })
      }
      labels.push({
        x: sx,
        y: sy - NODE / 2 - 6,
        text: `${itemName(e.item)} · ${fmt(e.rate)}/min`,
        sub: `${e.lanes}× ${transport === 'belt' ? `Belt Mk.${beltMk}` : `Pipe Mk.${pipeMk}`}`,
      })
    } else {
      const t = left(consumers[0])
      links.push({ x1: handoffX, y1: handoffY, x2: t.x, y2: t.y, transport })
      labels.push({
        x: (handoffX + t.x) / 2,
        y: (handoffY + t.y) / 2 - 8,
        text: `${itemName(e.item)} · ${fmt(e.rate)}/min`,
        sub: `${e.lanes}× ${transport === 'belt' ? `Belt Mk.${beltMk}` : `Pipe Mk.${pipeMk}`}`,
      })
    }
  }

  const unitClock = (s: Stage, i: number, n: number) =>
    i === n - 1 ? s.lastClockPercent : 100

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Factory schematic (complex)"
    >
      {links.map((l, i) => (
        <path
          key={`l${i}`}
          className={`edge edge--${l.transport}`}
          d={`M ${l.x1} ${l.y1} C ${l.x1 + 40} ${l.y1}, ${l.x2 - 40} ${l.y2}, ${l.x2} ${l.y2}`}
        />
      ))}
      {labels.map((lb, i) => (
        <g key={`t${i}`}>
          <text className="edge-label" x={lb.x} y={lb.y}>
            {lb.text}
          </text>
          <text className="edge-label edge-label--transport" x={lb.x} y={lb.y + 12}>
            {lb.sub}
          </text>
        </g>
      ))}
      {junctions.map((j, i) => (
        <g key={`j${i}`} className={`junction junction--${j.kind}`}>
          <rect x={j.x} y={j.y} width={NODE} height={NODE} rx={4} />
          <text x={j.x + NODE / 2} y={j.y + NODE / 2 + 4} textAnchor="middle">
            {j.kind === 'splitter' ? 'S' : 'M'}
          </text>
        </g>
      ))}
      {stageMeta.map(({ stage, units }) =>
        units.map((u, i) => (
          <g key={`${stage.id}-${i}`} className={`stage stage--${stage.kind}`}>
            <rect className="stage-box" x={u.x} y={u.y} width={CW} height={CH} rx={4} />
            <text className="stage-count cx-title" x={u.x + 10} y={u.y + 19}>
              {stage.machineName}
            </text>
            <text className="stage-meta cx-meta" x={u.x + 10} y={u.y + 36}>
              {stage.kind === 'storage'
                ? itemName(stage.inputs[0].item)
                : stage.kind === 'sink'
                  ? `${itemName(stage.inputs[0].item)} · sink`
                  : `${fmt(unitClock(stage, i, units.length))}%`}
            </text>
          </g>
        )),
      )}
    </svg>
  )
}
