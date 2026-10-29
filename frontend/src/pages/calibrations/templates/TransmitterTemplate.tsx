/* eslint-disable react-refresh/only-export-components */
import { CheckCircle, XCircle } from 'lucide-react'
import type { LocalAsset } from '../../../lib/db'
import { calcErrorPct, calc4_20mAErrorPct, isPass } from '../../../utils/calibrationMath'
import { copyRowAsFound, hasReading } from '../../../utils/copyAsFound'
import { CopyAllAsFoundButton, CopyRowAsFoundButton } from '../../../components/calibrations/CopyAsFound'

export interface TransmitterRow {
  pct: number
  appliedValue: number  // process variable input (from asset range)
  pvAsFound: string     // transmitter display — before adjustment
  pvAsLeft: string      // transmitter display — after adjustment
  maAsFound: string     // loop current — before adjustment
  maAsLeft: string      // loop current — after adjustment
}

interface TransmitterTemplateProps {
  asset: LocalAsset
  rows: TransmitterRow[]
  onChange: (rows: TransmitterRow[]) => void
  /** Locked record: hides the As Found → As Left copy controls. */
  readOnly?: boolean
}

/** Copy As Found → As Left for PV and mA on every row (skips blank As Found). */
export function copyAllTransmitterAsFound(rows: TransmitterRow[]): TransmitterRow[] {
  return rows.map((row) => copyRowAsFound(copyRowAsFound(row, 'pvAsFound', 'pvAsLeft'), 'maAsFound', 'maAsLeft'))
}

const POINTS = [0, 25, 50, 75, 100]

function appliedValue(asset: LocalAsset, pct: number): number {
  const min = asset.range_min ?? 0
  const max = asset.range_max ?? 100
  return min + (pct / 100) * (max - min)
}

export function buildDefaultTransmitterRows(asset: LocalAsset): TransmitterRow[] {
  return POINTS.map(pct => ({
    pct,
    appliedValue: appliedValue(asset, pct),
    pvAsFound: '',
    pvAsLeft: '',
    maAsFound: '',
    maAsLeft: '',
  }))
}

type RowField = 'pvAsFound' | 'pvAsLeft' | 'maAsFound' | 'maAsLeft'

function expectedMA(pct: number): number {
  return 4 + (pct / 100) * 16
}

function rowResult(row: TransmitterRow) {
  const pvNum = parseFloat(row.pvAsLeft)
  const maNum = parseFloat(row.maAsLeft)
  const hasPV = row.pvAsLeft !== '' && !isNaN(pvNum)
  const hasMA = row.maAsLeft !== '' && !isNaN(maNum)

  const pvErr = hasPV ? calcErrorPct(row.appliedValue, pvNum) : null
  const maErr = hasMA ? calc4_20mAErrorPct(row.pct, maNum) : null

  const pvPass = pvErr !== null && isFinite(pvErr) ? isPass(pvErr) : null
  const maPass = maErr !== null && isFinite(maErr) ? isPass(maErr) : null

  const bothPass =
    pvPass === true && maPass === true ? true :
    pvPass === false || maPass === false ? false : null

  return { pvErr, maErr, pvPass, maPass, bothPass, hasPV, hasMA }
}

const inputClass =
  'w-full text-base min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent'

export default function TransmitterTemplate({ asset, rows, onChange, readOnly = false }: TransmitterTemplateProps) {
  const unit = asset.range_unit ?? ''

  function handleChange(index: number, field: RowField, value: string) {
    onChange(rows.map((row, i) => i === index ? { ...row, [field]: value } : row))
  }

  function copyOne(index: number, kind: 'pv' | 'ma') {
    onChange(rows.map((row, i) => {
      if (i !== index) return row
      return kind === 'pv'
        ? copyRowAsFound(row, 'pvAsFound', 'pvAsLeft')
        : copyRowAsFound(row, 'maAsFound', 'maAsLeft')
    }))
  }

  const anyAsFound = rows.some((r) => hasReading(r.pvAsFound) || hasReading(r.maAsFound))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-gray-500">
          Verify both the transmitter PV display and the 4–20 mA loop output at each test point.
        </p>
        {!readOnly && (
          <CopyAllAsFoundButton
            disabled={!anyAsFound}
            onClick={() => onChange(copyAllTransmitterAsFound(rows))}
          />
        )}
      </div>

      {rows.map((row, i) => {
        const exp = expectedMA(row.pct)
        const res = rowResult(row)

        return (
          <div key={row.pct} className="rounded-xl border border-gray-200 overflow-hidden">
            {/* Row header */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 bg-gray-50 border-b border-gray-200">
              <span className="font-semibold text-sm text-gray-700">{row.pct}%</span>
              <span className="text-sm text-gray-500">
                Applied: <span className="font-mono font-medium">{row.appliedValue.toFixed(2)}{unit ? ` ${unit}` : ''}</span>
                {' '}· Expected mA: <span className="font-mono font-medium">{exp.toFixed(3)}</span>
              </span>
              {res.bothPass === true && <CheckCircle size={18} className="text-green-600 shrink-0" />}
              {res.bothPass === false && <XCircle size={18} className="text-red-600 shrink-0" />}
            </div>

            <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              {/* PV column */}
              <div className="space-y-1">
                <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  PV Display{unit ? ` (${unit})` : ''}
                </span>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">As Found</label>
                    <input
                      type="number" inputMode="decimal" step="any"
                      value={row.pvAsFound}
                      onChange={e => handleChange(i, 'pvAsFound', e.target.value)}
                      placeholder="—"
                      aria-label={`PV as found at ${row.pct}%`}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">As Left</label>
                    <div className="flex items-center gap-1">
                      {!readOnly && (
                        <CopyRowAsFoundButton
                          disabled={!hasReading(row.pvAsFound)}
                          onClick={() => copyOne(i, 'pv')}
                        />
                      )}
                      <input
                        type="number" inputMode="decimal" step="any"
                        value={row.pvAsLeft}
                        onChange={e => handleChange(i, 'pvAsLeft', e.target.value)}
                        placeholder="—"
                        aria-label={`PV as left at ${row.pct}%`}
                        className={`${inputClass} min-w-0`}
                      />
                    </div>
                  </div>
                </div>
                {res.hasPV && res.pvErr !== null && (
                  <p className={`text-xs font-mono font-semibold ${res.pvPass ? 'text-green-600' : 'text-red-600'}`}>
                    {isFinite(res.pvErr) ? `${res.pvErr.toFixed(3)}% error` : 'div/0'}
                  </p>
                )}
              </div>

              {/* mA column */}
              <div className="space-y-1">
                <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Loop Output (mA)
                </span>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">As Found</label>
                    <input
                      type="number" inputMode="decimal" step="0.001"
                      value={row.maAsFound}
                      onChange={e => handleChange(i, 'maAsFound', e.target.value)}
                      placeholder="—"
                      aria-label={`mA as found at ${row.pct}%`}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-1">As Left</label>
                    <div className="flex items-center gap-1">
                      {!readOnly && (
                        <CopyRowAsFoundButton
                          disabled={!hasReading(row.maAsFound)}
                          onClick={() => copyOne(i, 'ma')}
                        />
                      )}
                      <input
                        type="number" inputMode="decimal" step="0.001"
                        value={row.maAsLeft}
                        onChange={e => handleChange(i, 'maAsLeft', e.target.value)}
                        placeholder="—"
                        aria-label={`mA as left at ${row.pct}%`}
                        className={`${inputClass} min-w-0`}
                      />
                    </div>
                  </div>
                </div>
                {res.hasMA && res.maErr !== null && (
                  <p className={`text-xs font-mono font-semibold ${res.maPass ? 'text-green-600' : 'text-red-600'}`}>
                    {isFinite(res.maErr) ? `${res.maErr.toFixed(3)}% error` : 'div/0'}
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
