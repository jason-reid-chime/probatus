/* eslint-disable react-refresh/only-export-components */
import { CheckCircle, XCircle } from 'lucide-react'
import type { LocalAsset } from '../../../lib/db'
import { isPass } from '../../../utils/calibrationMath'

export interface PressureRow {
  pct: number
  standardValue: number
  asFound: string
  asLeft: string
  uncertainty_pct?: string
  confidence_level?: string
}

interface PressureTemplateProps {
  asset: LocalAsset
  rows: PressureRow[]
  onChange: (rows: PressureRow[]) => void
  showUncertainty?: boolean
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

function calcPressureErrorPct(standard: number, measured: number, span: number): number {
  if (span === 0) return NaN
  return Math.abs(measured - standard) / span * 100
}

export default function PressureTemplate({
  asset,
  rows,
  onChange,
  showUncertainty = false,
}: PressureTemplateProps) {
  const span = (asset.range_max ?? 100) - (asset.range_min ?? 0)

  function handleChange(
    index: number,
    field: 'asFound' | 'asLeft' | 'uncertainty_pct' | 'confidence_level',
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
            {showUncertainty && (
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
                Uncertainty %
              </th>
            )}
            {showUncertainty && (
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
                Confidence
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const asLeftNum = parseFloat(row.asLeft)
            const hasValue = row.asLeft !== '' && !isNaN(asLeftNum)
            const errorPct = hasValue
              ? calcPressureErrorPct(row.standardValue, asLeftNum, span)
              : NaN
            const pass = hasValue && isFinite(errorPct) ? isPass(errorPct) : null

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
                {showUncertainty && (
                  <td className="px-3 py-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={row.uncertainty_pct ?? ''}
                      onChange={(e) => handleChange(i, 'uncertainty_pct', e.target.value)}
                      placeholder="—"
                      className="w-24 text-sm px-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                  </td>
                )}
                {showUncertainty && (
                  <td className="px-3 py-1">
                    <select
                      value={row.confidence_level ?? ''}
                      onChange={(e) => handleChange(i, 'confidence_level', e.target.value)}
                      className="text-sm px-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    >
                      <option value="">—</option>
                      <option value="95">95%</option>
                      <option value="99">99%</option>
                    </select>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
