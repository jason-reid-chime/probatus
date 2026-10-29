/* eslint-disable react-refresh/only-export-components */
import { CheckCircle, XCircle } from 'lucide-react'
import type { LocalMeasurement } from '../../../lib/db'
import type { TemplatePoint } from '../../../types'

// ---------------------------------------------------------------------------
// Backflow test kit sheet (e.g. Zurn TG-5, procedure CP.13).
//
// The UUT is set to each nominal differential pressure (descending) and the
// reference standard ("Actual Pressure") is read As Found and As Left. A point
// passes when |actual - nominal| <= tolerance, an ABSOLUTE band in PSID
// (±0.2 by default, 0 at the 0 PSID point), not a percentage of span.
//
// Stored per point as a calibration_measurements row:
//   point_label    "14.0 PSID"
//   standard_value 14.0          (UUT nominal)
//   as_found_value reference reading, as found
//   measured_value reference reading, as left
//   unit           "PSID"
//   pass           as-left within ±tolerance
//   error_pct      |as-left - nominal| as % of the asset span (for the cert)
//   notes          "Tol ±0.2 PSID; As Found PASS|FAIL"
// ---------------------------------------------------------------------------

export const BACKFLOW_UNIT = 'PSID'
export const BACKFLOW_DEFAULT_TOLERANCE = 0.2
export const BACKFLOW_DEFAULT_SPAN = 15 // TG-5 dial is 0–15 PSID
const BACKFLOW_NOMINALS = [14, 12, 10, 8, 6, 4, 2, 0]

// Readings are entered to 0.1 PSID; absorb float noise so 2.2 vs 2.0 is
// treated as exactly 0.2 (inclusive), matching the certificate's limits.
const EPSILON = 1e-9

export interface BackflowRow {
  label: string
  nominal: number
  tolerance: number
  asFound: string
  asLeft: string
}

export interface BackflowConditions {
  poNumber: string
  roomTemp: string
  humidity: string
  uutCondition: string
}

function labelFor(nominal: number): string {
  return nominal === 0 ? `0 ${BACKFLOW_UNIT}` : `${nominal.toFixed(1)} ${BACKFLOW_UNIT}`
}

function defaultToleranceFor(nominal: number): number {
  return nominal === 0 ? 0 : BACKFLOW_DEFAULT_TOLERANCE
}

export function buildDefaultBackflowRows(): BackflowRow[] {
  return BACKFLOW_NOMINALS.map((nominal) => ({
    label: labelFor(nominal),
    nominal,
    tolerance: defaultToleranceFor(nominal),
    asFound: '',
    asLeft: '',
  }))
}

export function backflowRowsFromTemplate(points: TemplatePoint[]): BackflowRow[] {
  return points
    .filter((p) => p.standard_value != null)
    .map((p) => {
      const nominal = p.standard_value as number
      return {
        label: p.label || labelFor(nominal),
        nominal,
        tolerance: p.tolerance_abs ?? defaultToleranceFor(nominal),
        asFound: '',
        asLeft: '',
      }
    })
}

export function emptyBackflowConditions(): BackflowConditions {
  return { poNumber: '', roomTemp: '', humidity: '', uutCondition: '' }
}

function parseReading(s: string): number | null {
  if (s.trim() === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

export function backflowPointPass(nominal: number, reading: number, tolerance: number): boolean {
  return Math.abs(reading - nominal) <= tolerance + EPSILON
}

export function backflowMeasurements(
  recordId: string,
  rows: BackflowRow[],
  span: number = BACKFLOW_DEFAULT_SPAN,
): LocalMeasurement[] {
  return rows.map((row) => {
    const found = parseReading(row.asFound)
    const left = parseReading(row.asLeft)
    const foundPass = found !== null ? backflowPointPass(row.nominal, found, row.tolerance) : null
    const errorPct = left !== null && span > 0 ? (Math.abs(left - row.nominal) / span) * 100 : undefined
    const notes = [
      `Tol ±${row.tolerance} ${BACKFLOW_UNIT}`,
      foundPass !== null ? `As Found ${foundPass ? 'PASS' : 'FAIL'}` : null,
    ].filter(Boolean).join('; ')
    return {
      id: crypto.randomUUID(),
      record_id: recordId,
      point_label: row.label,
      standard_value: row.nominal,
      as_found_value: found,
      measured_value: left ?? undefined,
      unit: BACKFLOW_UNIT,
      pass: left !== null ? backflowPointPass(row.nominal, left, row.tolerance) : undefined,
      error_pct: errorPct,
      notes,
    }
  })
}

/** Rebuild rows from saved measurements (editing an existing record). */
export function backflowRowsFromMeasurements(ms: LocalMeasurement[]): BackflowRow[] {
  return ms
    .filter((m) => m.standard_value != null)
    .sort((a, b) => (b.standard_value ?? 0) - (a.standard_value ?? 0))
    .map((m) => {
      const nominal = m.standard_value as number
      const tolMatch = m.notes?.match(/Tol ±([\d.]+)/)
      return {
        label: m.point_label,
        nominal,
        tolerance: tolMatch ? parseFloat(tolMatch[1]) : defaultToleranceFor(nominal),
        asFound: m.as_found_value != null ? String(m.as_found_value) : '',
        asLeft: m.measured_value != null ? String(m.measured_value) : '',
      }
    })
}

// ---------------------------------------------------------------------------
// Sheet header fields (PO, room temperature/humidity, UUT condition) have no
// dedicated columns, so they are stored as a tagged first line of the record
// notes and parsed back on edit.
// ---------------------------------------------------------------------------
const NOTES_TAG = '[Backflow]'
const CONDITION_KEYS: Array<[keyof BackflowConditions, string]> = [
  ['poNumber', 'PO'],
  ['roomTemp', 'Room temp (°C)'],
  ['humidity', 'Humidity (%RH)'],
  ['uutCondition', 'UUT condition as found'],
]

function clean(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim()
}

export function composeBackflowNotes(c: BackflowConditions, freeNotes: string): string {
  const parts = CONDITION_KEYS
    .filter(([k]) => clean(c[k]) !== '')
    .map(([k, label]) => `${label}: ${clean(c[k])}`)
  const header = parts.length > 0 ? `${NOTES_TAG} ${parts.join(' | ')}` : ''
  return [header, freeNotes.trim()].filter(Boolean).join('\n')
}

export function parseBackflowNotes(notes: string): { conditions: BackflowConditions; freeNotes: string } {
  const conditions = emptyBackflowConditions()
  if (!notes.startsWith(NOTES_TAG)) return { conditions, freeNotes: notes }
  const nl = notes.indexOf('\n')
  const header = (nl === -1 ? notes : notes.slice(0, nl)).slice(NOTES_TAG.length).trim()
  const freeNotes = nl === -1 ? '' : notes.slice(nl + 1)
  for (const part of header.split(' | ')) {
    const entry = CONDITION_KEYS.find(([, label]) => part.startsWith(`${label}: `))
    if (entry) conditions[entry[0]] = part.slice(entry[1].length + 2)
  }
  return { conditions, freeNotes }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface BackflowTemplateProps {
  rows: BackflowRow[]
  onChange: (rows: BackflowRow[]) => void
  conditions: BackflowConditions
  onConditionsChange: (c: BackflowConditions) => void
}

const inputClass =
  'w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent'

function PassIcon({ pass }: { pass: boolean | null }) {
  if (pass === true) return <CheckCircle className="inline-block text-green-600" size={22} aria-label="Pass" />
  if (pass === false) return <XCircle className="inline-block text-red-600" size={22} aria-label="Fail" />
  return <span className="text-gray-400">—</span>
}

export default function BackflowTemplate({
  rows,
  onChange,
  conditions,
  onConditionsChange,
}: BackflowTemplateProps) {
  function handleChange(index: number, field: 'asFound' | 'asLeft', value: string) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }

  function setCondition(field: keyof BackflowConditions, value: string) {
    onConditionsChange({ ...conditions, [field]: value })
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">PO #</label>
          <input
            type="text"
            value={conditions.poNumber}
            onChange={(e) => setCondition('poNumber', e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Room Temp (°C)</label>
          <input
            type="number"
            inputMode="decimal"
            value={conditions.roomTemp}
            onChange={(e) => setCondition('roomTemp', e.target.value)}
            placeholder="e.g. 22"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Humidity (%RH)</label>
          <input
            type="number"
            inputMode="decimal"
            value={conditions.humidity}
            onChange={(e) => setCondition('humidity', e.target.value)}
            placeholder="e.g. 50"
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">UUT Condition As Found</label>
        <input
          type="text"
          value={conditions.uutCondition}
          onChange={(e) => setCondition('uutCondition', e.target.value)}
          placeholder="e.g. Readings out of tolerance"
          className={inputClass}
        />
      </div>

      <p className="text-sm text-gray-500">
        Set the UUT to each nominal (descending) and record the reference standard reading.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">UUT ({BACKFLOW_UNIT})</th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">Min</th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">Max</th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">As Found (Actual)</th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap text-center">A.F.</th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">As Left (Actual)</th>
              <th className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap text-center">A.L.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const found = parseReading(row.asFound)
              const left = parseReading(row.asLeft)
              const foundPass = found !== null ? backflowPointPass(row.nominal, found, row.tolerance) : null
              const leftPass = left !== null ? backflowPointPass(row.nominal, left, row.tolerance) : null
              return (
                <tr key={row.label} className="border-t border-gray-200">
                  <td className="px-3 py-2 font-medium text-gray-700">{row.nominal.toFixed(1)}</td>
                  <td className="px-3 py-2 text-gray-600">{Math.max(0, row.nominal - row.tolerance).toFixed(1)}</td>
                  <td className="px-3 py-2 text-gray-600">{(row.nominal + row.tolerance).toFixed(1)}</td>
                  <td className="px-3 py-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={row.asFound}
                      onChange={(e) => handleChange(i, 'asFound', e.target.value)}
                      placeholder="—"
                      aria-label={`As found at ${row.label}`}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2 text-center"><PassIcon pass={foundPass} /></td>
                  <td className="px-3 py-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={row.asLeft}
                      onChange={(e) => handleChange(i, 'asLeft', e.target.value)}
                      placeholder="—"
                      aria-label={`As left at ${row.label}`}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2 text-center"><PassIcon pass={leftPass} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
