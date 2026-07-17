import type { Plan } from '../engine/solve'
import type { GameData } from '../engine/types'
import { fmt } from '../ui/format'

interface Props {
  plan: Plan
  data: GameData
  targetItem: string
}

export default function Breakdown({ plan, data, targetItem }: Props) {
  const itemName = (id: string) => data.items.get(id)?.name ?? id
  const machineStages = plan.stages.filter((s) => s.kind !== 'storage')
  const totalMachines = machineStages.reduce((n, s) => n + s.machinesBuilt, 0)

  return (
    <div className="breakdown">
      <h2>System breakdown</h2>
      <div className="tiles">
        <div className="tile">
          <div className="value">{fmt(plan.targetRate)}/min</div>
          <div className="label">{itemName(targetItem)} output</div>
        </div>
        <div className="tile">
          <div className="value">{fmt(plan.totalPowerMW)} MW</div>
          <div className="label">Total power draw</div>
        </div>
        <div className="tile">
          <div className="value">{totalMachines}</div>
          <div className="label">Machines to build</div>
        </div>
        {plan.limitingResource && (
          <div className="tile">
            <div className="value">{itemName(plan.limitingResource)}</div>
            <div className="label">Limiting resource</div>
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
          {machineStages.map((s) => (
            <tr key={s.id}>
              <td>{s.machineName}</td>
              <td>
                {s.kind === 'machine'
                  ? s.recipeName
                  : itemName(s.outputs[0].item)}
              </td>
              <td className="num">{s.machinesBuilt}</td>
              <td className="num">{fmt(s.lastClockPercent)}%</td>
              <td className="num">
                {s.outputs
                  .map((o) => `${fmt(o.rate)}/min ${itemName(o.item)}`)
                  .join(', ')}
              </td>
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
