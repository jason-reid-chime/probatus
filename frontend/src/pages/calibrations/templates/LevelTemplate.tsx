import { CheckCircle, XCircle } from 'lucide-react'
import { calc4_20mAErrorPct, isPass } from '../../../utils/calibrationMath'

export interface LevelRow {
  pct: number
  outputMA: string
}

interface LevelTemplateProps {
  rows: LevelRow[]
  onChange: (rows: LevelRow[]) => void
}

const POINTS = [0, 25, 50, 75, 100]

export function buildDefaultLevelRows(): LevelRow[] {
  return POINTS.map((pct) => ({ pct, outputMA: '' }))
}

function expectedMA(pct: number): number {
  return 4 + (pct / 100) * 16
}

export default function LevelTemplate({ rows, onChange }: LevelTemplateProps) {
  function handleChange(index: number, value: string) {
    const updated = rows.map((row, i) =>
      i === index ? { ...row, outputMA: value } : row,
    )
    onChange(updated)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
              % of Range
            </th>
            <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
              Expected mA
            </th>
            <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
              Output mA
            </th>
            <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap text-center">
              Error %
            </th>
            <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap text-center">
              Pass/Fail
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const exp = expectedMA(row.pct)
            const outNum = parseFloat(row.outputMA)
            const hasValue = row.outputMA !== '' && !isNaN(outNum)
            const errorPct = hasValue
              ? calc4_20mAErrorPct(row.pct, outNum)
              : NaN
            const pass = hasValue ? isPass(errorPct) : null

            return (
              <tr key={row.pct} className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">
                  {row.pct}%
                </td>
                <td className="px-3 py-2 text-gray-600 font-mono">
                  {exp.toFixed(3)} mA
                </td>
                <td className="px-3 py-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    value={row.outputMA}
                    onChange={(e) => handleChange(i, e.target.value)}
                    placeholder="—"
                    className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                </td>
                <td className="px-3 py-2 text-center font-mono font-semibold">
                  {hasValue && isFinite(errorPct) ? (
                    <span className={pass ? 'text-green-600' : 'text-red-600'}>
                      {errorPct.toFixed(3)}%
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {pass === true && (
                    <CheckCircle
                      className="inline-block text-green-600"
                      size={22}
                    />
                  )}
                  {pass === false && (
                    <XCircle className="inline-block text-red-600" size={22} />
                  )}
                  {pass === null && <span className="text-gray-400">—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
