/* eslint-disable react-refresh/only-export-components */
import { Plus, Trash2, CheckCircle, XCircle } from 'lucide-react'
import { calcErrorPct, isPass } from '../../../utils/calibrationMath'

export interface TemperatureRow {
  id: string
  label: string
  reference: string
  measured: string
}

interface TemperatureTemplateProps {
  rows: TemperatureRow[]
  onChange: (rows: TemperatureRow[]) => void
}

function makeRow(index: number): TemperatureRow {
  return {
    id: crypto.randomUUID(),
    label: `Point ${index + 1}`,
    reference: '',
    measured: '',
  }
}

export function buildDefaultTemperatureRows(): TemperatureRow[] {
  return [makeRow(0), makeRow(1), makeRow(2)]
}

export default function TemperatureTemplate({
  rows,
  onChange,
}: TemperatureTemplateProps) {
  function handleChange(
    id: string,
    field: keyof TemperatureRow,
    value: string,
  ) {
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  function addRow() {
    onChange([...rows, makeRow(rows.length)])
  }

  function removeRow(id: string) {
    if (rows.length <= 1) return
    onChange(rows.filter((r) => r.id !== id))
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
                Point Label
              </th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
                Reference °C
              </th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
                Measured °C
              </th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap text-center">
                Error %
              </th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap text-center">
                Pass/Fail
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const refNum = parseFloat(row.reference)
              const measNum = parseFloat(row.measured)
              const hasValue =
                row.reference !== '' &&
                row.measured !== '' &&
                !isNaN(refNum) &&
                !isNaN(measNum)
              const errorPct = hasValue ? calcErrorPct(refNum, measNum) : NaN
              const pass = hasValue && isFinite(errorPct) ? isPass(errorPct) : null

              return (
                <tr key={row.id} className="border-t border-gray-200">
                  <td className="px-3 py-1">
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) =>
                        handleChange(row.id, 'label', e.target.value)
                      }
                      placeholder="Point label"
                      className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                  </td>
                  <td className="px-3 py-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={row.reference}
                      onChange={(e) =>
                        handleChange(row.id, 'reference', e.target.value)
                      }
                      placeholder="—"
                      className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                  </td>
                  <td className="px-3 py-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={row.measured}
                      onChange={(e) =>
                        handleChange(row.id, 'measured', e.target.value)
                      }
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
                      <XCircle
                        className="inline-block text-red-600"
                        size={22}
                      />
                    )}
                    {pass === null && (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length <= 1}
                      className="text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="Remove row"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-2 text-sm text-brand-500 hover:text-brand-600 font-medium transition-colors"
      >
        <Plus size={16} />
        Add point
      </button>
    </div>
  )
}
