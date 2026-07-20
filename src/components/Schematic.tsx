import { useRef } from 'react'
import type { Plan, Stage } from '../engine/solve'
import type { GameData } from '../engine/types'
import { fmt } from '../ui/format'
import type { ManualLayout, Point } from '../ui/manualLayout'

export type ViewMode = 'standard' | 'complex'

interface Props {
  plan: Plan
  data: GameData
  beltMk: number
  pipeMk: number
  viewMode: ViewMode
  /** Pan/zoom window supplied by the viewport. Absent means draw at intrinsic
   * size, which is what the render tests and a plain static export want. */
  viewBox?: string
  /** Boxes the user dragged somewhere else. */
  layout?: ManualLayout
  /** Drag report, in SVG units. Absent makes the schematic read-only. */
  onMoveBox?: (key: string, auto: Point, dx: number, dy: number) => void
  /** CSS pixels per SVG unit, to convert pointer deltas while dragging. */
  scale?: number
}

/** Fill the container when the viewport drives the window, otherwise keep the
 * drawing's natural pixel size. */
function svgSize(props: Props, width: number, height: number) {
  return props.viewBox
    ? { width: '100%', height: '100%', viewBox: props.viewBox }
    : { width, height, viewBox: `0 0 ${width} ${height}` }
}

export default function Schematic(props: Props) {
  return props.viewMode === 'complex' ? (
    <ComplexSchematic {...props} />
  ) : (
    <StandardSchematic {...props} />
  )
}

// ---------------------------------------------------------------------------
// Shared grid geometry. Both views lay stages out in columns by depth, each
// column centred vertically; they differ only in box metrics and in how many
// units a stage expands into.
// ---------------------------------------------------------------------------

interface Metrics {
  w: number
  h: number
  xgap: number
  ygap: number
  pad: number
}

interface Grid {
  width: number
  height: number
  /** Unit slots per stage id, in column order */
  unitsOf: Map<string, Unit[]>
  stages: { stage: Stage; units: Unit[] }[]
}

/** Stable identity for a drawn box, so a dragged position survives replanning
 * as long as the box itself survives. The standard view draws one box per
 * stage; the complex one draws a box per machine. */
export const boxKey = (stageId: string, unit: number, multi: boolean) =>
  multi ? `${stageId}#${unit}` : stageId

function grid(
  plan: Plan,
  m: Metrics,
  unitCount: (s: Stage) => number,
  multi: boolean,
  layout: ManualLayout = {},
): Grid {
  const columns = new Map<number, Stage[]>()
  for (const stage of plan.stages) {
    const col = columns.get(stage.depth) ?? []
    col.push(stage)
    columns.set(stage.depth, col)
  }
  const depths = [...columns.keys()].sort((a, b) => a - b)
  const xOf = new Map(depths.map((d, i) => [d, m.pad + i * (m.w + m.xgap)]))

  const colUnits = (d: number) =>
    (columns.get(d) ?? []).reduce((n, s) => n + unitCount(s), 0)
  const maxUnits = Math.max(1, ...depths.map(colUnits))
  const height = maxUnits * m.h + (maxUnits - 1) * m.ygap + m.pad * 2
  const width =
    m.pad * 2 + depths.length * m.w + Math.max(0, depths.length - 1) * m.xgap

  const unitsOf = new Map<string, Unit[]>()
  const stages: { stage: Stage; units: Unit[] }[] = []
  for (const d of depths) {
    const total = colUnits(d)
    const colH = total * m.h + (total - 1) * m.ygap
    let y = (height - colH) / 2
    const x = xOf.get(d)!
    for (const stage of columns.get(d)!) {
      const units: Unit[] = []
      for (let i = 0; i < unitCount(stage); i++) {
        const key = boxKey(stage.id, i, multi)
        const auto = { x, y }
        // A dragged box keeps its own spot; the automatic slot is still what a
        // later drag measures from, so deltas stay absolute.
        units.push({ key, auto, ...(layout[key] ?? auto) })
        y += m.h + m.ygap
      }
      unitsOf.set(stage.id, units)
      stages.push({ stage, units })
    }
  }
  return { width, height, unitsOf, stages }
}

/**
 * A stage box the user can drag. Children draw relative to the box origin; the
 * translate does the placing. Pointer capture keeps the drag alive past the box
 * edge, and stopping propagation is what keeps a box drag from also panning the
 * viewport underneath.
 */
function Draggable({
  unit,
  className,
  scale = 1,
  onMoveBox,
  children,
}: {
  unit: Unit
  className: string
  scale?: number
  onMoveBox?: Props['onMoveBox']
  children: React.ReactNode
}) {
  const last = useRef<Point | null>(null)
  const draggable = Boolean(onMoveBox)

  return (
    <g
      className={`${className}${draggable ? ' stage--draggable' : ''}`}
      transform={`translate(${unit.x} ${unit.y})`}
      onPointerDown={
        draggable
          ? (e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              last.current = { x: e.clientX, y: e.clientY }
              e.currentTarget.setPointerCapture(e.pointerId)
            }
          : undefined
      }
      onPointerMove={
        draggable
          ? (e) => {
              const from = last.current
              if (!from) return
              e.stopPropagation()
              onMoveBox!(
                unit.key,
                unit.auto,
                (e.clientX - from.x) / scale,
                (e.clientY - from.y) / scale,
              )
              last.current = { x: e.clientX, y: e.clientY }
            }
          : undefined
      }
      onPointerUp={
        draggable
          ? (e) => {
              last.current = null
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          : undefined
      }
      onPointerCancel={draggable ? () => void (last.current = null) : undefined}
    >
      {children}
    </g>
  )
}

/** Intrinsic size of the drawing, so the viewport can fit it before render. */
export function layoutSize(
  plan: Plan,
  viewMode: ViewMode,
): { width: number; height: number } {
  const { width, height } =
    viewMode === 'complex'
      ? grid(plan, COMPLEX, complexUnitCount, true)
      : grid(plan, STANDARD, () => 1, false)
  return { width, height }
}

/** Every box key the current plan draws, so stale overrides can be pruned. */
export function boxKeys(plan: Plan, viewMode: ViewMode): Set<string> {
  const multi = viewMode === 'complex'
  const { unitsOf } = multi
    ? grid(plan, COMPLEX, complexUnitCount, true)
    : grid(plan, STANDARD, () => 1, false)
  const keys = new Set<string>()
  for (const units of unitsOf.values()) for (const u of units) keys.add(u.key)
  return keys
}

// ---------------------------------------------------------------------------
// Standard: one box per stage, machines grouped with counts.
// ---------------------------------------------------------------------------

const W = 216
const H = 88
const STANDARD: Metrics = { w: W, h: H, xgap: 130, ygap: 42, pad: 34 }

function StandardSchematic(props: Props) {
  const { plan, data, beltMk, pipeMk } = props
  const itemName = (id: string) => data.items.get(id)?.name ?? id

  const { width, height, unitsOf } = grid(
    plan,
    STANDARD,
    () => 1,
    false,
    props.layout,
  )
  const pos = new Map([...unitsOf].map(([id, units]) => [id, units[0]] as const))

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
      s.lastClockPercent === 100 ? '' : ` · last @ ${fmt(s.lastClockPercent)}%`
    const shards = s.powerShards > 0 ? ` · ${s.powerShards} shard${s.powerShards > 1 ? 's' : ''}` : ''
    return `${fmt(s.powerMW)} MW${clock}${shards}`
  }

  return (
    <svg
      {...svgSize(props, width, height)}
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
      {plan.stages.map((s) => (
        <Draggable
          key={s.id}
          unit={pos.get(s.id)!}
          className={`stage stage--${s.kind}`}
          scale={props.scale}
          onMoveBox={props.onMoveBox}
        >
          <rect className="stage-box" width={W} height={H} rx={5} />
          <text className="stage-count" x={12} y={26}>
            {s.machinesBuilt}× {s.machineName}
          </text>
          <text className="stage-sub" x={12} y={47}>
            {subLabel(s)}
          </text>
          <text className="stage-meta" x={12} y={70}>
            {metaLabel(s)}
          </text>
        </Draggable>
      ))}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Complex: every machine individually, wired through Splitters and Mergers.
// ---------------------------------------------------------------------------

const CW = 158
const CH = 46
const COMPLEX: Metrics = { w: CW, h: CH, xgap: 180, ygap: 18, pad: 34 }
const NODE = 30 // splitter / merger square

/** How many individual machines a stage expands into. */
const complexUnitCount = (s: Stage) =>
  s.kind === 'storage' ? 1 : Math.max(1, s.machinesBuilt)

interface Unit extends Point {
  key: string
  /** Where the automatic layout put it, before any drag */
  auto: Point
}

interface CLink {
  x1: number
  y1: number
  x2: number
  y2: number
  transport: 'belt' | 'pipe'
}

function ComplexSchematic(props: Props) {
  const { plan, data, beltMk, pipeMk } = props
  const itemName = (id: string) => data.items.get(id)?.name ?? id

  const {
    width,
    height,
    unitsOf,
    stages: stageMeta,
  } = grid(plan, COMPLEX, complexUnitCount, true, props.layout)

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

  // Every machine but the last runs at the stage's max clock; the last one
  // takes the remainder. Recovered from the stage totals.
  const unitClock = (s: Stage, i: number, n: number) =>
    i === n - 1
      ? s.lastClockPercent
      : (s.count * 100 - s.lastClockPercent) / (n - 1)

  return (
    <svg
      {...svgSize(props, width, height)}
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
          <Draggable
            key={u.key}
            unit={u}
            className={`stage stage--${stage.kind}`}
            scale={props.scale}
            onMoveBox={props.onMoveBox}
          >
            <rect className="stage-box" width={CW} height={CH} rx={4} />
            <text className="stage-count cx-title" x={10} y={19}>
              {stage.machineName}
            </text>
            <text className="stage-meta cx-meta" x={10} y={36}>
              {stage.kind === 'storage'
                ? itemName(stage.inputs[0].item)
                : stage.kind === 'sink'
                  ? `${itemName(stage.inputs[0].item)} · sink`
                  : `${fmt(unitClock(stage, i, units.length))}%`}
            </text>
          </Draggable>
        )),
      )}
    </svg>
  )
}
