import type { Plan, Stage } from '../engine/solve'
import type { GameData } from '../engine/types'
import { fmt } from '../ui/format'

const W = 216
const H = 88
const XGAP = 130
const YGAP = 42
const PAD = 34

interface Props {
  plan: Plan
  data: GameData
  beltMk: number
  pipeMk: number
}

export default function Schematic({ plan, data, beltMk, pipeMk }: Props) {
  const itemName = (id: string) => data.items.get(id)?.name ?? id

  // Column per depth (compressing unused depth values).
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
    return itemName(s.inputs[0].item)
  }

  const metaLabel = (s: Stage): string => {
    if (s.kind === 'storage') return `${fmt(s.inputs[0].rate)}/min stored`
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
      aria-label="Factory schematic"
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
            <text
              className="edge-label edge-label--transport"
              x={mx}
              y={my - 8}
            >
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
