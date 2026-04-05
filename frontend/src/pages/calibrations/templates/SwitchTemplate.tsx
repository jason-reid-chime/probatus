import { CheckCircle, XCircle } from 'lucide-react'
import type { LocalAsset } from '../../../lib/db'

export interface SwitchData {
  setpoint: string      // target trip point
  tolerancePct: string  // acceptable % of span (default 2)
  asFoundTrip: string   // measured trip on rising signal
  asFoundReset: string  // measured reset on falling signal
  asLeftTrip: string    // after adjustment (rising)
  asLeftReset: string   // after adjustment (falling)
}

interface SwitchTemplateProps {
  asset: LocalAsset
  data: SwitchData
  onChange: (data: SwitchData) => void
}

export function buildDefaultSwitchData(): SwitchData {
  return {
    setpoint: '',
    tolerancePct: '2',
    asFoundTrip: '',
    asFoundReset: '',
    asLeftTrip: '',
    asLeftReset: '',
  }
}

export default function SwitchTemplate({ asset, data, onChange }: SwitchTemplateProps) {
  const unit = asset.range_unit ?? ''
  const span = (asset.range_max ?? 100) - (asset.range_min ?? 0)
  const setpointNum = parseFloat(data.setpoint)
  const tolerancePct = parseFloat(data.tolerancePct) || 2

  function field(key: keyof SwitchData, value: string) {
    onChange({ ...data, [key]: value })
  }

  function evalRow(asLeftStr: string) {
    if (asLeftStr === '' || isNaN(setpointNum) || span <= 0) return null
    const val = parseFloat(asLeftStr)
    if (isNaN(val)) return null
    const errPct = Math.abs(val - setpointNum) / span * 100
    return { errPct, pass: errPct <= tolerancePct }
  }

  // Deadband: difference between trip and reset
  const tripNum = parseFloat(data.asLeftTrip)
  const resetNum = parseFloat(data.asLeftReset)
  const deadband = !isNaN(tripNum) && !isNaN(resetNum) && data.asLeftTrip !== '' && data.asLeftReset !== ''
    ? Math.abs(tripNum - resetNum)
    : null

  const tripResult = evalRow(data.asLeftTrip)
  const resetResult = evalRow(data.asLeftReset)

  const inputClass = 'w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent'

  return (
    <div className="space-y-5">
      {/* Setpoint + Tolerance */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Setpoint{unit ? ` (${unit})` : ''}
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={data.setpoint}
            onChange={(e) => field('setpoint', e.target.value)}
            placeholder="e.g. 50"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tolerance (% of span)
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={data.tolerancePct}
            onChange={(e) => field('tolerancePct', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Measurement table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">Action</th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">As Found{unit ? ` (${unit})` : ''}</th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">As Left{unit ? ` (${unit})` : ''}</th>
              <th className="px-3 py-2 font-semibold text-gray-700 text-center whitespace-nowrap">Error %</th>
              <th className="px-3 py-2 font-semibold text-gray-700 text-center whitespace-nowrap">Pass/Fail</th>
            </tr>
          </thead>
          <tbody>
            {/* Trip — rising signal */}
            <tr className="border-t border-gray-200">
              <td className="px-3 py-2 font-medium text-gray-700 whitespace-nowrap">
                <div>Trip</div>
                <div className="text-xs text-gray-400 font-normal">Rising ↑</div>
              </td>
              <td className="px-3 py-1">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={data.asFoundTrip}
                  onChange={(e) => field('asFoundTrip', e.target.value)}
                  placeholder="—"
                  className={inputClass}
                />
              </td>
              <td className="px-3 py-1">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={data.asLeftTrip}
                  onChange={(e) => field('asLeftTrip', e.target.value)}
                  placeholder="—"
                  className={inputClass}
                />
              </td>
              <td className="px-3 py-2 text-center font-mono font-semibold">
                {tripResult ? (
                  <span className={tripResult.pass ? 'text-green-600' : 'text-red-600'}>
                    {tripResult.errPct.toFixed(3)}%
                  </span>
                ) : <span className="text-gray-400">—</span>}
              </td>
              <td className="px-3 py-2 text-center">
                {tripResult?.pass === true && <CheckCircle className="inline-block text-green-600" size={22} />}
                {tripResult?.pass === false && <XCircle className="inline-block text-red-600" size={22} />}
                {!tripResult && <span className="text-gray-400">—</span>}
              </td>
            </tr>

            {/* Reset — falling signal */}
            <tr className="border-t border-gray-200">
              <td className="px-3 py-2 font-medium text-gray-700 whitespace-nowrap">
                <div>Reset</div>
                <div className="text-xs text-gray-400 font-normal">Falling ↓</div>
              </td>
              <td className="px-3 py-1">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={data.asFoundReset}
                  onChange={(e) => field('asFoundReset', e.target.value)}
                  placeholder="—"
                  className={inputClass}
                />
              </td>
              <td className="px-3 py-1">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={data.asLeftReset}
                  onChange={(e) => field('asLeftReset', e.target.value)}
                  placeholder="—"
                  className={inputClass}
                />
              </td>
              <td className="px-3 py-2 text-center font-mono font-semibold">
                {resetResult ? (
                  <span className={resetResult.pass ? 'text-green-600' : 'text-red-600'}>
                    {resetResult.errPct.toFixed(3)}%
                  </span>
                ) : <span className="text-gray-400">—</span>}
              </td>
              <td className="px-3 py-2 text-center">
                {resetResult?.pass === true && <CheckCircle className="inline-block text-green-600" size={22} />}
                {resetResult?.pass === false && <XCircle className="inline-block text-red-600" size={22} />}
                {!resetResult && <span className="text-gray-400">—</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Deadband display */}
      {deadband !== null && (
        <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-4 py-2.5">
          <span className="font-medium">Deadband:</span>
          <span className="font-mono">{deadband.toFixed(3)}{unit ? ` ${unit}` : ''}</span>
          {span > 0 && (
            <span className="text-gray-400">({(deadband / span * 100).toFixed(2)}% of span)</span>
          )}
        </div>
      )}
    </div>
  )
}
