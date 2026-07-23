import { useRef } from 'react'
import type { Plan, Stage } from '../engine/solve'
import type { GameData } from '../engine/types'
import { fmt } from '../ui/format'
import { junctionTree, treeLevels, type JunctionNode } from '../ui/junctions'
import type { ManualLayout, Point } from '../ui/manualLayout'

export type ViewMode = 'standard' | 'complex'
/** How the Complex view wires a stage's machines together: a balanced tree of
 * Splitters/Mergers, or the plain linear manifold everyone actually builds. */
export type WiringMode = 'tree' | 'manifold'

interface Props {
  plan: Plan
  data: GameData
  viewMode: ViewMode
  /** Only meaningful when viewMode is 'complex'. Defaults to a tree. */
  wiringMode?: WiringMode
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

/**
 * A belt as a curve broken into several cubic pieces. One long curve would do
 * visually, but `marker-mid` only puts an arrow where two pieces meet, and the
 * arrows are what say which way the belt runs when the flow animation is off.
 */
function beltPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bow: number,
): string {
  const n = Math.min(6, Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 100)))
  // Belts are stored the way they flow, so a return run goes right to left; the
  // control points have to lean the same way or the curve doubles back.
  const lean = x2 >= x1 ? bow : -bow
  const lerp = (a: Point, b: Point, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  })
  const r = (v: number) => Math.round(v * 10) / 10
  const at = (p: Point) => `${r(p.x)} ${r(p.y)}`

  let p0 = { x: x1, y: y1 }
  let p1 = { x: x1 + lean, y: y1 }
  let p2 = { x: x2 - lean, y: y2 }
  const p3 = { x: x2, y: y2 }
  let d = `M ${at(p0)}`
  for (let k = 0; k < n - 1; k++) {
    // de Casteljau: cut the remaining curve so the pieces come out even.
    const t = 1 / (n - k)
    const a = lerp(p0, p1, t)
    const b = lerp(p1, p2, t)
    const c = lerp(p2, p3, t)
    const ab = lerp(a, b, t)
    const bc = lerp(b, c, t)
    const mid = lerp(ab, bc, t)
    d += ` C ${at(a)}, ${at(ab)}, ${at(mid)}`
    p0 = mid
    p1 = bc
    p2 = c
  }
  return `${d} C ${at(p1)}, ${at(p2)}, ${at(p3)}`
}

/** The arrowheads `marker-mid` drops along a belt, one set per belt kind. */
function BeltMarkers() {
  return (
    <defs>
      {(['belt', 'pipe'] as const).map((kind) => (
        <marker
          key={kind}
          id={`arrow-${kind}`}
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path className={`arrow-${kind}`} d="M 1 1.5 L 8.5 5 L 1 8.5 Z" />
        </marker>
      ))}
    </defs>
  )
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

  // Who feeds whom, so a column can be ordered against the column before it.
  const feeders = new Map<string, string[]>()
  for (const e of plan.edges) {
    feeders.set(e.to, [...(feeders.get(e.to) ?? []), e.from])
  }
  const centerY = new Map<string, number>()

  const unitsOf = new Map<string, Unit[]>()
  const stages: { stage: Stage; units: Unit[] }[] = []
  for (const d of depths) {
    const total = colUnits(d)
    const colH = total * m.h + (total - 1) * m.ygap
    let y = (height - colH) / 2
    const x = xOf.get(d)!
    // Barycentre ordering: each stage lines up with whatever feeds it, which is
    // what keeps a belt from cutting across the column. It is also what parks an
    // AWESOME Sink right beside the stage it drains instead of leaving it
    // stranded among the storage containers.
    const ordered = [...columns.get(d)!]
      .map((stage, i) => {
        const ys = (feeders.get(stage.id) ?? [])
          .map((id) => centerY.get(id))
          .filter((v): v is number => v !== undefined)
        // No feeder placed yet only happens in the extractor column, where the
        // declared order is as good as any.
        const bary = ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length : 0
        return { stage, i, bary, anchored: ys.length > 0 }
      })
      .sort((a, b) => (a.anchored && b.anchored ? a.bary - b.bary : 0) || a.i - b.i)
      .map((s) => s.stage)
    for (const stage of ordered) {
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
      centerY.set(
        stage.id,
        units.reduce((sum, u) => sum + u.y + m.h / 2, 0) / units.length,
      )
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

/** The wiring a plan draws in the complex view, for tests and for sizing. */
export function complexLayout(
  plan: Plan,
  layout: ManualLayout = {},
  wiringMode: WiringMode = 'tree',
): Wiring {
  const m = complexMetrics(plan, wiringMode)
  const g = grid(plan, m, complexUnitCount, true, layout)
  return complexWiring(plan, g.unitsOf, (id) => id, layout, wiringMode)
}

/** Intrinsic size of the drawing, so the viewport can fit it before render. */
export function layoutSize(
  plan: Plan,
  viewMode: ViewMode,
  wiringMode: WiringMode = 'tree',
): { width: number; height: number } {
  const { width, height } =
    viewMode === 'complex'
      ? grid(plan, complexMetrics(plan, wiringMode), complexUnitCount, true)
      : grid(plan, STANDARD, () => 1, false)
  return { width, height }
}

/** Every box key the current plan draws, so stale overrides can be pruned. */
export function boxKeys(
  plan: Plan,
  viewMode: ViewMode,
  wiringMode: WiringMode = 'tree',
): Set<string> {
  const multi = viewMode === 'complex'
  const { unitsOf } = multi
    ? grid(plan, complexMetrics(plan, wiringMode), complexUnitCount, true)
    : grid(plan, STANDARD, () => 1, false)
  const keys = new Set<string>()
  for (const units of unitsOf.values()) for (const u of units) keys.add(u.key)
  // Splitters and Mergers are draggable too, so their overrides must survive
  // the prune that follows a replan.
  if (multi) for (const j of complexLayout(plan, {}, wiringMode).junctions) keys.add(j.key)
  return keys
}

// ---------------------------------------------------------------------------
// Standard: one box per stage, machines grouped with counts.
// ---------------------------------------------------------------------------

const W = 216
const H = 88
const STANDARD: Metrics = { w: W, h: H, xgap: 130, ygap: 42, pad: 34 }

function StandardSchematic(props: Props) {
  const { plan, data } = props
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
      <BeltMarkers />
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
          e.transport === 'belt' ? `Belt Mk.${e.tierMk}` : `Pipe Mk.${e.tierMk}`
        return (
          <g key={i}>
            <path
              className={`edge edge--${e.transport}`}
              markerMid={`url(#arrow-${e.transport})`}
              d={beltPath(sx, sy, tx, ty, 55)}
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
const COMPLEX: Metrics = { w: CW, h: CH, xgap: 300, ygap: 18, pad: 34 }
const NODE = 30 // splitter / merger square

/** How many individual machines a stage expands into. */
export const complexUnitCount = (s: Stage) =>
  s.kind === 'storage' ? 1 : Math.max(1, s.machinesBuilt)

/**
 * The gap between two columns has to hold a Merger tree, the Splitter that
 * divides the trunk between destinations, and a Splitter tree, all in series.
 * A 16-machine stage needs four Merger levels on its own, so a fixed gap either
 * cramps big plans or stretches small ones; size it from the plan instead. A
 * manifold is a single column of junctions each side, however tall the stage,
 * so its horizontal reach is one level whatever the machine count.
 */
function complexMetrics(plan: Plan, wiringMode: WiringMode): Metrics {
  const units = new Map(plan.stages.map((s) => [s.id, complexUnitCount(s)]))
  const destinations = new Map<string, number>()
  for (const e of plan.edges) {
    destinations.set(e.from, (destinations.get(e.from) ?? 0) + 1)
  }
  const busLevels = (n: number) =>
    wiringMode === 'manifold' ? (n > 1 ? 1 : 0) : treeLevels(junctionTree(n))
  let levels = 1
  for (const e of plan.edges) {
    const fanout = destinations.get(e.from) ?? 1
    levels = Math.max(
      levels,
      busLevels(units.get(e.from) ?? 1) +
        (fanout > 1 ? treeLevels(junctionTree(fanout)) : 0) +
        busLevels(units.get(e.to) ?? 1),
    )
  }
  return { ...COMPLEX, xgap: Math.max(COMPLEX.xgap, (levels + 1) * LEVEL) }
}

interface Unit extends Point {
  key: string
  /** Where the automatic layout put it, before any drag */
  auto: Point
}

export interface CLink {
  x1: number
  y1: number
  x2: number
  y2: number
  transport: 'belt' | 'pipe'
}

export interface CJunction {
  /** Stable across replans, so a dragged square keeps its spot like a machine */
  key: string
  x: number
  y: number
  /** Where the automatic layout put it, before any drag */
  auto: Point
  kind: 'splitter' | 'merger'
  /** Belts wired into (merger) or out of (splitter) the square */
  ways: number
  /** The face belts arrive at, and the single face they leave by. A Splitter
   * has one inbound belt and up to three out; a Merger is the mirror of that. */
  inPort: Point
  outPort: Point
  inSide: FaceSide
  outSide: FaceSide
}

/** Where a belt attaches, and where it would have attached had nobody dragged
 * anything. Neighbours are laid out off `auto`, so moving one square never
 * drags the rest of the tree along with it; the belts use `pos` and follow. */
interface Face {
  pos: Point
  auto: Point
}

/** A junction is a square with four faces, and a belt has to meet the one it
 * actually comes from: run it into the far side and it reads as if it left the
 * square rather than entered it. */
type FaceSide = 'left' | 'right' | 'top' | 'bottom'

function facePoint(rect: Point, side: FaceSide): Point {
  if (side === 'left') return { x: rect.x, y: rect.y + NODE / 2 }
  if (side === 'right') return { x: rect.x + NODE, y: rect.y + NODE / 2 }
  if (side === 'top') return { x: rect.x + NODE / 2, y: rect.y }
  return { x: rect.x + NODE / 2, y: rect.y + NODE }
}

/**
 * Put a junction square down, honouring a drag the user made. `at` is where the
 * automatic layout wants its trunk-side face; `dir` says which side the branches
 * are on (+1 = branches to the left, as a Merger pulling from producers).
 */
function placeJunction(
  key: string,
  kind: 'splitter' | 'merger',
  ways: number,
  rect: Point,
  trunkSide: FaceSide,
  branchSide: FaceSide,
  layout: ManualLayout,
  junctions: CJunction[],
): { trunk: Face; branch: Face } {
  const auto = rect
  const p = layout[key] ?? auto
  const faces = (q: Point) => ({
    trunk: facePoint(q, trunkSide),
    branch: facePoint(q, branchSide),
  })
  const now = faces(p)
  const was = faces(auto)
  junctions.push({
    key,
    x: p.x,
    y: p.y,
    auto,
    kind,
    ways,
    inPort: kind === 'merger' ? now.branch : now.trunk,
    outPort: kind === 'merger' ? now.trunk : now.branch,
    inSide: kind === 'merger' ? branchSide : trunkSide,
    outSide: kind === 'merger' ? trunkSide : branchSide,
  })
  return {
    trunk: { pos: now.trunk, auto: was.trunk },
    branch: { pos: now.branch, auto: was.branch },
  }
}

/** Horizontal room one level of junctions takes. */
const LEVEL = NODE + 26

/**
 * Draw the Splitter (or Merger) tree that wires `ports` to a single trunk, and
 * return where that trunk starts. `edgeX` is the machine side, `dir` the way the
 * tree grows from it: +1 for a Merger fanning in from the producers on the left,
 * -1 for a Splitter fanning out to the consumers on the right.
 *
 * Junctions sit at the vertical centre of the ports they serve, so a branch
 * never has to cross a sibling branch to reach its machine.
 */
function wire(
  ports: Face[],
  tree: JunctionNode,
  kind: 'splitter' | 'merger',
  edgeX: number,
  dir: 1 | -1,
  transport: 'belt' | 'pipe',
  junctions: CJunction[],
  links: CLink[],
  keyBase: string,
  layout: ManualLayout,
): Face {
  const place = (node: JunctionNode, path: string): Face => {
    if (node.children.length === 0) return ports[node.leaves[0]]
    // Centred on where the automatic layout puts the machines under it, and one
    // level per belt hop between here and the deepest of them.
    const ys = node.leaves.map((i) => ports[i].auto.y)
    const x = edgeX + dir * treeLevels(node) * LEVEL
    const { trunk, branch } = placeJunction(
      `${keyBase}/${path}`,
      kind,
      node.children.length,
      {
        x: dir > 0 ? x - NODE : x,
        y: (Math.min(...ys) + Math.max(...ys)) / 2 - NODE / 2,
      },
      dir > 0 ? 'right' : 'left',
      dir > 0 ? 'left' : 'right',
      layout,
      junctions,
    )
    node.children.forEach((child, i) => {
      const c = place(child, `${path}.${i}`).pos
      // Stored the way it flows: into a Merger from its branches, out of a
      // Splitter towards them. The arrowheads read straight off that.
      links.push(
        kind === 'merger'
          ? { x1: c.x, y1: c.y, x2: branch.pos.x, y2: branch.pos.y, transport }
          : { x1: branch.pos.x, y1: branch.pos.y, x2: c.x, y2: c.y, transport },
      )
    })
    return trunk
  }
  return place(tree, '0')
}

/**
 * Draw a manifold: one 2-way junction per machine but the last, each tapping a
 * single machine off a straight bus and passing the rest along to the next. It
 * is the plain build most factories use, and it leans on belt backpressure to
 * even the machines out where the tree divides the belt equally by construction.
 *
 * `ports` are the machine faces top to bottom; `edgeX`/`dir` mean the same as in
 * `wire`. Returns the trunk Face, where the run joins the bus.
 */
function manifoldWire(
  ports: Face[],
  kind: 'splitter' | 'merger',
  edgeX: number,
  dir: 1 | -1,
  transport: 'belt' | 'pipe',
  junctions: CJunction[],
  links: CLink[],
  keyBase: string,
  layout: ManualLayout,
): Face {
  const n = ports.length
  if (n <= 1) return ports[0]

  // The column of squares sits one level off the machines, on the trunk side.
  const busX = dir > 0 ? edgeX + (LEVEL - NODE) : edgeX - LEVEL

  // Square i taps machine i. Placed off its own auto so a drag on one never
  // shifts the rest of the bus; belts read the current face positions.
  const place = (i: number) => {
    const key = `${keyBase}/m${i}`
    const auto = { x: busX, y: ports[i].auto.y - NODE / 2 }
    const pos = layout[key] ?? auto
    return {
      key,
      auto,
      pos,
      face: (side: FaceSide): Face => ({
        pos: facePoint(pos, side),
        auto: facePoint(auto, side),
      }),
    }
  }
  const nodes = Array.from({ length: n - 1 }, (_, i) => place(i))
  const link = (a: Point, b: Point) =>
    links.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, transport })

  if (kind === 'splitter') {
    nodes.forEach((node, i) => {
      // The trunk enters the top square from its side; every square after it
      // takes the run from the one above through its top face.
      const inSide: FaceSide = i === 0 ? 'left' : 'top'
      const branch = node.face('right')
      const cont = node.face('bottom')
      junctions.push({
        key: node.key, x: node.pos.x, y: node.pos.y, auto: node.auto,
        kind: 'splitter', ways: 2,
        inPort: node.face(inSide).pos, outPort: cont.pos,
        inSide, outSide: 'bottom',
      })
      link(branch.pos, ports[i].pos)
      // Pass the rest straight down: to the next square, or to the last machine.
      link(cont.pos, i < n - 2 ? nodes[i + 1].face('top').pos : ports[n - 1].pos)
    })
    return nodes[0].face('left')
  }

  // Merger: the mirror. Every square merges its machine with the run climbing
  // from below and sends it up; the top square hands the trunk out sideways.
  nodes.forEach((node, i) => {
    const outSide: FaceSide = i === 0 ? 'right' : 'top'
    junctions.push({
      key: node.key, x: node.pos.x, y: node.pos.y, auto: node.auto,
      kind: 'merger', ways: 2,
      inPort: node.face('left').pos, outPort: node.face(outSide).pos,
      inSide: 'left', outSide,
    })
    link(ports[i].pos, node.face('left').pos)
    // The belt arriving from below: the next square's output, or the last machine.
    link(i < n - 2 ? nodes[i + 1].face('top').pos : ports[n - 1].pos, node.face('bottom').pos)
  })
  return nodes[0].face('right')
}

interface CLabel {
  x: number
  y: number
  text: string
  sub: string
}

export interface Wiring {
  links: CLink[]
  junctions: CJunction[]
  labels: CLabel[]
}

/** Horizontal stagger between the Splitter lines of two different items. */
const LANE_GAP = 20

/**
 * Wire a whole plan up the way it would be built:
 *
 *   machines -> Merger tree -> one trunk -> Splitter tree -> machines
 *
 * A machine has a single output belt, so a stage is merged exactly once no
 * matter how many stages it feeds, and a Splitter (never the Merger) is what
 * divides that trunk between them. A machine count a tree cannot divide evenly
 * is not the wiring's problem: the clocks settle the rates.
 */
export function complexWiring(
  plan: Plan,
  unitsOf: Map<string, Unit[]>,
  itemName: (id: string) => string,
  layout: ManualLayout = {},
  wiringMode: WiringMode = 'tree',
): Wiring {
  const links: CLink[] = []
  const junctions: CJunction[] = []
  const labels: CLabel[] = []

  // A machine port is wherever the machine is: dragging a machine is meant to
  // take its belts and its Splitters with it.
  const port = (p: Point): Face => ({ pos: p, auto: p })
  const right = (u: Unit) => port({ x: u.x + CW, y: u.y + CH / 2 })
  const left = (u: Unit) => port({ x: u.x, y: u.y + CH / 2 })

  const outgoing = new Map<string, typeof plan.edges>()
  const inbound = new Map<string, string[]>()
  for (const e of plan.edges) {
    if (!unitsOf.has(e.from) || !unitsOf.has(e.to)) continue
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e])
    inbound.set(e.to, [...(inbound.get(e.to) ?? []), e.item])
  }

  for (const [fromId, edges] of outgoing) {
    const producers = unitsOf.get(fromId)!
    const transport = edges[0].transport

    // One trunk out of the stage, whatever it goes on to feed.
    const mergeEdge = Math.max(...producers.map((u) => u.x)) + CW
    const trunk =
      wiringMode === 'manifold'
        ? manifoldWire(
            producers.map(right), 'merger', mergeEdge, 1, transport,
            junctions, links, `merge:${fromId}`, layout,
          )
        : wire(
            producers.map(right), junctionTree(producers.length), 'merger',
            mergeEdge, 1, transport, junctions, links, `merge:${fromId}`, layout,
          )

    const heads: Face[] = []
    for (const e of edges) {
      const consumers = unitsOf.get(e.to)!
      // A stage fed two different items gets a Splitter line per item. They
      // land on the same machines, so stagger them rather than draw one on top
      // of the other.
      const lane = (inbound.get(e.to) ?? []).indexOf(e.item)
      const toCol = consumers[0].x - lane * LANE_GAP
      const run = `${fromId}>${e.to}:${e.item}`

      const head =
        wiringMode === 'manifold'
          ? manifoldWire(
              consumers.map(left), 'splitter', toCol, -1, transport,
              junctions, links, `split:${run}`, layout,
            )
          : wire(
              consumers.map(left), junctionTree(consumers.length), 'splitter',
              toCol, -1, transport, junctions, links, `split:${run}`, layout,
            )

      heads.push(head)

      const tier =
        transport === 'belt' ? `Belt Mk.${e.tierMk}` : `Pipe Mk.${e.tierMk}`
      labels.push({
        x: (trunk.pos.x + head.pos.x) / 2,
        y: (trunk.pos.y + head.pos.y) / 2 - 8,
        text: `${itemName(e.item)} · ${fmt(e.rate)}/min`,
        sub: `${e.lanes}× ${tier}`,
      })
    }

    // A Merger has one output, so several destinations are served by a
    // Splitter on the trunk, never by extra belts off the Merger itself.
    if (heads.length === 1) {
      links.push({
        x1: trunk.pos.x,
        y1: trunk.pos.y,
        x2: heads[0].pos.x,
        y2: heads[0].pos.y,
        transport,
      })
    } else {
      const fan = wire(
        heads,
        junctionTree(heads.length),
        'splitter',
        Math.min(...heads.map((h) => h.auto.x)),
        -1,
        transport,
        junctions,
        links,
        `fan:${fromId}`,
        layout,
      )
      links.push({
        x1: trunk.pos.x, y1: trunk.pos.y,
        x2: fan.pos.x, y2: fan.pos.y,
        transport,
      })
    }
  }

  return { links, junctions, labels }
}

function ComplexSchematic(props: Props) {
  const { plan, data } = props
  const itemName = (id: string) => data.items.get(id)?.name ?? id

  const wiringMode = props.wiringMode ?? 'tree'
  const { width, height, unitsOf, stages: stageMeta } = grid(
    plan,
    complexMetrics(plan, wiringMode),
    complexUnitCount,
    true,
    props.layout,
  )

  const { links, junctions, labels } = complexWiring(
    plan,
    unitsOf,
    itemName,
    props.layout,
    wiringMode,
  )

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
      <BeltMarkers />
      {links.map((l, i) => (
        <path
          key={`l${i}`}
          className={`edge edge--${l.transport}`}
          markerMid={`url(#arrow-${l.transport})`}
          d={beltPath(l.x1, l.y1, l.x2, l.y2, 40)}
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
      {junctions.map((j) => (
        <Draggable
          key={j.key}
          unit={{ key: j.key, auto: j.auto, x: j.x, y: j.y }}
          className={`junction junction--${j.kind}`}
          scale={props.scale}
          onMoveBox={props.onMoveBox}
        >
          {/* A square with 4 faces: the trunk takes one, the branches the rest. */}
          <rect width={NODE} height={NODE} rx={4}>
            <title>{`${j.kind} · ${j.ways}-way`}</title>
          </rect>
          <text x={NODE / 2} y={NODE / 2 + 4} textAnchor="middle">
            {j.kind === 'splitter' ? 'S' : 'M'}
          </text>
        </Draggable>
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
