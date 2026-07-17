import type { Plan, Stage } from '../engine/solve'
import type { GameData } from '../engine/types'
import { fmt } from '../ui/format'

interface Props {
  plan: Plan
  data: GameData
}

export default function Breakdown({ plan, data }: Props) {
  const itemName = (id: string) => data.items.get(id)?.name ?? id
  const buildStages = plan.stages.filter((s) => s.kind !== 'storage')
  const totalMachines = buildStages.reduce((n, s) => n + s.machinesBuilt, 0)

  const recipeOrResource = (s: Stage): string => {
    if (s.kind === 'machine') return s.recipeName ?? ''
    if (s.kind === 'sink') return itemName(s.inputs[0]?.item ?? '')
    return itemName(s.outputs[0]?.item ?? '')
  }
  const stageOutput = (s: Stage): string => {
    if (s.kind === 'sink') return `sinks ${fmt(s.inputs[0]?.rate ?? 0)}/min`
    return s.outputs
      .map((o) => `${fmt(o.rate)}/min ${itemName(o.item)}`)
      .join(', ')
  }

  return (
    <div className="breakdown">
      <h2>System breakdown</h2>
      <div className="tiles">
        {plan.targets.map((t) => (
          <div className="tile" key={t.item}>
            <div className="value">{fmt(t.rate)}/min</div>
            <div className="label">{itemName(t.item)} output</div>
          </div>
        ))}
        <div className="tile">
          <div className="value">{fmt(plan.totalPowerMW)} MW</div>
          <div className="label">Total power draw</div>
        </div>
        <div className="tile">
          <div className="value">{totalMachines}</div>
          <div className="label">Machines to build</div>
        </div>
        {plan.sinkPointsPerMin > 0 && (
          <div className="tile">
            <div className="value">{fmt(plan.sinkPointsPerMin)}/min</div>
            <div className="label">AWESOME Sink points</div>
          </div>
        )}
        {plan.limitingResource && (
          <div className="tile">
            <div className="value">{itemName(plan.limitingResource)}</div>
            <div className="label">Tightest resource</div>
          </div>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Recipe / resource</th>
            <th style={{ textAlign: 'right' }}>Machines</th>
            <th style={{ textAlign: 'right' }}>Last clock</th>
            <th style={{ textAlign: 'right' }}>Output</th>
            <th style={{ textAlign: 'right' }}>Power</th>
          </tr>
        </thead>
        <tbody>
          {buildStages.map((s) => (
            <tr key={s.id}>
              <td>{s.machineName}</td>
              <td>{recipeOrResource(s)}</td>
              <td className="num">{s.machinesBuilt}</td>
              <td className="num">{fmt(s.lastClockPercent)}%</td>
              <td className="num">{stageOutput(s)}</td>
              <td className="num">{fmt(s.powerMW)} MW</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan.surplus.length > 0 && (
        <p className="surplus">
          Byproduct surplus (sink or store it):{' '}
          {plan.surplus.map((s, i) => (
            <span key={s.item}>
              {i > 0 && ', '}
              <strong>
                {fmt(s.rate)}/min {itemName(s.item)}
              </strong>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}
