/* eslint-disable react-refresh/only-export-components */
import { CheckCircle, XCircle } from 'lucide-react'
import type { LocalAsset } from '../../../lib/db'
import { calcErrorPct, isPass } from '../../../utils/calibrationMath'

export interface PressureRow {
  pct: number
  standardValue: number
  asFound: string
  asLeft: string
}

interface PressureTemplateProps {
  asset: LocalAsset
  rows: PressureRow[]
  onChange: (rows: PressureRow[]) => void
}

const POINTS = [0, 25, 50, 75, 100]

function getStandardValue(asset: LocalAsset, pct: number): number {
  const min = asset.range_min ?? 0
  const max = asset.range_max ?? 100
  return min + (pct / 100) * (max - min)
}

export function buildDefaultPressureRows(asset: LocalAsset): PressureRow[] {
  return POINTS.map((pct) => ({
    pct,
    standardValue: getStandardValue(asset, pct),
    asFound: '',
    asLeft: '',
  }))
}

export default function PressureTemplate({
  asset,
  rows,
  onChange,
}: PressureTemplateProps) {
  function handleChange(
    index: number,
    field: 'asFound' | 'asLeft',
    value: string,
  ) {
    const updated = rows.map((row, i) =>
      i === index ? { ...row, [field]: value } : row,
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
              Standard Value{asset.range_unit ? ` (${asset.range_unit})` : ''}
            </th>
            <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
              As Found
            </th>
            <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
              As Left
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
            const asLeftNum = parseFloat(row.asLeft)
            const hasValue = row.asLeft !== '' && !isNaN(asLeftNum)
            const errorPct = hasValue
              ? calcErrorPct(row.standardValue, asLeftNum)
              : NaN
            const pass = hasValue ? isPass(errorPct) : null

            return (
              <tr key={row.pct} className="border-t border-gray-200">
                <td className="px-3 py-2 font-medium text-gray-700">
                  {row.pct}%
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {row.standardValue.toFixed(2)}
                </td>
                <td className="px-3 py-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={row.asFound}
                    onChange={(e) => handleChange(i, 'asFound', e.target.value)}
                    placeholder="—"
                    className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                </td>
                <td className="px-3 py-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={row.asLeft}
                    onChange={(e) => handleChange(i, 'asLeft', e.target.value)}
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
                    <CheckCircle className="inline-block text-green-600" size={22} />
                  )}
                  {pass === false && (
                    <XCircle className="inline-block text-red-600" size={22} />
                  )}
                  {pass === null && (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
