/* eslint-disable react-refresh/only-export-components */
import { CheckCircle, XCircle } from 'lucide-react'
import { CopyAllAsFoundButton, CopyRowAsFoundButton } from '../../../components/calibrations/CopyAsFound'
import type { LocalAsset, LocalMeasurement } from '../../../lib/db'
import type { CalibrationTemplate } from '../../../types'

// ---------------------------------------------------------------------------
// Pressure gauge sheet (procedure based on BS EN 837-1), modelled on a
// CALTROLS certificate for a WIKA 0–100 psi glycerin-filled gauge, ±1% FS.
//
// The UUT is set to 0, 20, 40, 60, 80 and 100% of range, first with RISING
// (increasing) pressure and then FALLING (decreasing), and the reference test
// gauge is read at each point, As Found and As Left.
//
//   Deviation    = reference − instrument (in the range unit)
//   Error % FS   = |deviation| / span × 100
//   Max Error    = the largest Error % FS over all rows
//   PASS         when Max Error ≤ accuracy class (default ±1% FS)
//
// Stored per point AND direction as a calibration_measurements row:
//   point_label    "20 psi ↑" (rising) / "20 psi ↓" (falling)
//   standard_value 20             (UUT nominal = instrument reading)
//   as_found_value reference reading, as found
//   measured_value reference reading, as left
//   unit           range unit (e.g. "psi")
//   pass           as-left Error % FS ≤ accuracy class
//   error_pct      as-left |deviation| as % of span
//   notes          "Rising; Acc ±1% FS; As Found PASS|FAIL"
//
// Records saved by the older 5-point pressure sheet (labels "0%", "25%", …)
// are detected with isPressureGaugeMeasurements() and stay on that sheet.
// ---------------------------------------------------------------------------

export const GAUGE_PERCENTS = [0, 20, 40, 60, 80, 100]
export const GAUGE_DEFAULT_RANGE = { min: 0, max: 100, unit: 'psi' }
export const GAUGE_DEFAULT_ACCURACY = 1
export const RISING_MARK = '↑'
export const FALLING_MARK = '↓'

// Readings are entered to 0.01; absorb float noise so a deviation of exactly
// the accuracy class counts as a pass (inclusive limit).
const EPSILON = 1e-9

export type GaugeDirection = 'rising' | 'falling'

export interface GaugeReading {
  /** Reference reading, as found. */
  asFound: string
  /** Reference reading, as left. */
  asLeft: string
}

export interface GaugePoint {
  pct: number
  /** UUT nominal (instrument reading) in the range unit. */
  nominal: number
  rising: GaugeReading
  falling: GaugeReading
}

export interface GaugeConditions {
  /** Accuracy class in % of full scale. */
  accuracyPct: string
  temperature: string
  humidity: string
  connection: string
  dialSize: string
}

export interface GaugeRange {
  min: number
  max: number
  unit: string
}

export type GaugeResult = 'PASS' | 'FAIL' | 'INCOMPLETE'

export interface GaugeSummary {
  maxErrorFound: number | null
  maxErrorLeft: number | null
  resultFound: GaugeResult
  resultLeft: GaugeResult
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
export function gaugeRange(asset: Pick<LocalAsset, 'range_min' | 'range_max' | 'range_unit'> | null | undefined): GaugeRange {
  const min = asset?.range_min
  const max = asset?.range_max
  const unit = asset?.range_unit?.trim() || GAUGE_DEFAULT_RANGE.unit
  if (min == null || max == null || !isFinite(min) || !isFinite(max) || max <= min) {
    return { ...GAUGE_DEFAULT_RANGE, unit }
  }
  return { min, max, unit }
}

function round(n: number, dp = 6): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

export function formatNominal(n: number): string {
  return String(round(n, 4))
}

export function gaugeLabel(nominal: number, unit: string, dir: GaugeDirection): string {
  return `${formatNominal(nominal)} ${unit} ${dir === 'rising' ? RISING_MARK : FALLING_MARK}`
}

function emptyReading(): GaugeReading {
  return { asFound: '', asLeft: '' }
}

function pointAt(range: GaugeRange, pct: number): GaugePoint {
  return {
    pct,
    nominal: round(range.min + (pct / 100) * (range.max - range.min)),
    rising: emptyReading(),
    falling: emptyReading(),
  }
}

export function buildDefaultGaugePoints(range: GaugeRange): GaugePoint[] {
  return GAUGE_PERCENTS.map((pct) => pointAt(range, pct))
}

export function emptyGaugeConditions(): GaugeConditions {
  return {
    accuracyPct: String(GAUGE_DEFAULT_ACCURACY),
    temperature: '',
    humidity: '',
    connection: '',
    dialSize: '',
  }
}

/** Accuracy class as a number, falling back to the default when blank/invalid. */
export function gaugeAccuracy(c: Pick<GaugeConditions, 'accuracyPct'>): number {
  const n = parseFloat(c.accuracyPct)
  return isFinite(n) && n > 0 ? n : GAUGE_DEFAULT_ACCURACY
}

/**
 * Points from a template. A point whose unit is "%" is a percentage of the
 * asset's range (so one template fits any range); otherwise standard_value is
 * an absolute nominal in the range unit.
 */
export function gaugePointsFromTemplate(template: Pick<CalibrationTemplate, 'points'>, range: GaugeRange): GaugePoint[] {
  const span = range.max - range.min
  return template.points
    .filter((p) => p.standard_value != null && isFinite(p.standard_value))
    .map((p) => {
      const v = p.standard_value as number
      if (p.unit?.trim() === '%') return pointAt(range, v)
      return {
        pct: round(((v - range.min) / span) * 100, 4),
        nominal: v,
        rising: emptyReading(),
        falling: emptyReading(),
      }
    })
    .sort((a, b) => a.nominal - b.nominal)
}

function parseReading(s: string): number | null {
  if (s.trim() === '') return null
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}

/** reference − instrument, or null when the reading is blank. */
export function gaugeDeviation(nominal: number, reading: string): number | null {
  const r = parseReading(reading)
  return r === null ? null : round(r - nominal)
}

export function gaugeErrorPctFS(deviation: number, span: number): number {
  if (!(span > 0)) return NaN
  return round((Math.abs(deviation) / span) * 100)
}

export function gaugeWithin(errorPct: number, accuracyPct: number): boolean {
  return isFinite(errorPct) && errorPct <= accuracyPct + EPSILON
}

/** Readings in test order: rising 0 → 100%, then falling 100 → 0%. */
export function gaugeSequence(points: GaugePoint[]): Array<{ point: GaugePoint; index: number; dir: GaugeDirection }> {
  const rising = points.map((point, index) => ({ point, index, dir: 'rising' as const }))
  const falling = points.map((point, index) => ({ point, index, dir: 'falling' as const })).reverse()
  return [...rising, ...falling]
}

function maxError(points: GaugePoint[], span: number, field: keyof GaugeReading): number | null {
  let max: number | null = null
  for (const { point, dir } of gaugeSequence(points)) {
    const dev = gaugeDeviation(point.nominal, point[dir][field])
    if (dev === null) return null
    const err = gaugeErrorPctFS(dev, span)
    if (!isFinite(err)) return null
    max = max === null ? err : Math.max(max, err)
  }
  return max
}

export function gaugeSummary(points: GaugePoint[], range: GaugeRange, accuracyPct: number): GaugeSummary {
  const span = range.max - range.min
  const maxErrorFound = points.length > 0 ? maxError(points, span, 'asFound') : null
  const maxErrorLeft = points.length > 0 ? maxError(points, span, 'asLeft') : null
  const verdict = (m: number | null): GaugeResult =>
    m === null ? 'INCOMPLETE' : gaugeWithin(m, accuracyPct) ? 'PASS' : 'FAIL'
  return {
    maxErrorFound,
    maxErrorLeft,
    resultFound: verdict(maxErrorFound),
    resultLeft: verdict(maxErrorLeft),
  }
}

export function gaugeMeasurements(
  recordId: string,
  points: GaugePoint[],
  range: GaugeRange,
  accuracyPct: number,
): LocalMeasurement[] {
  const span = range.max - range.min
  return gaugeSequence(points).map(({ point, dir }) => {
    const reading = point[dir]
    const found = parseReading(reading.asFound)
    const left = parseReading(reading.asLeft)
    const foundErr = found !== null ? gaugeErrorPctFS(found - point.nominal, span) : null
    const leftErr = left !== null ? gaugeErrorPctFS(left - point.nominal, span) : null
    const notes = [
      dir === 'rising' ? 'Rising' : 'Falling',
      `Acc ±${accuracyPct}% FS`,
      foundErr !== null ? `As Found ${gaugeWithin(foundErr, accuracyPct) ? 'PASS' : 'FAIL'}` : null,
    ].filter(Boolean).join('; ')
    return {
      id: crypto.randomUUID(),
      record_id: recordId,
      point_label: gaugeLabel(point.nominal, range.unit, dir),
      standard_value: point.nominal,
      as_found_value: found,
      measured_value: left ?? undefined,
      unit: range.unit,
      pass: leftErr !== null && isFinite(leftErr) ? gaugeWithin(leftErr, accuracyPct) : undefined,
      error_pct: leftErr !== null && isFinite(leftErr) ? leftErr : undefined,
      notes,
    }
  })
}

const GAUGE_LABEL_RE = new RegExp(`\\s[${RISING_MARK}${FALLING_MARK}]$`)

/** True when saved measurements came from this rising/falling sheet. */
export function isPressureGaugeMeasurements(ms: Pick<LocalMeasurement, 'point_label'>[]): boolean {
  return ms.some((m) => GAUGE_LABEL_RE.test(m.point_label))
}

/** Rebuild points from saved measurements (editing an existing record). */
export function gaugePointsFromMeasurements(ms: LocalMeasurement[], range: GaugeRange): GaugePoint[] {
  const span = range.max - range.min
  const byNominal = new Map<string, GaugePoint>()
  for (const m of ms) {
    if (m.standard_value == null || !GAUGE_LABEL_RE.test(m.point_label)) continue
    const nominal = m.standard_value
    const key = round(nominal).toString()
    let point = byNominal.get(key)
    if (!point) {
      point = {
        pct: round(((nominal - range.min) / span) * 100, 4),
        nominal,
        rising: emptyReading(),
        falling: emptyReading(),
      }
      byNominal.set(key, point)
    }
    const dir: GaugeDirection = m.point_label.endsWith(RISING_MARK) ? 'rising' : 'falling'
    point[dir] = {
      asFound: m.as_found_value != null ? String(m.as_found_value) : '',
      asLeft: m.measured_value != null ? String(m.measured_value) : '',
    }
  }
  return [...byNominal.values()].sort((a, b) => a.nominal - b.nominal)
}

/** Accuracy class recorded on saved rows ("Acc ±1% FS"), if any. */
export function gaugeAccuracyFromMeasurements(ms: LocalMeasurement[]): string | null {
  for (const m of ms) {
    const match = m.notes?.match(/Acc ±([\d.]+)% FS/)
    if (match) return match[1]
  }
  return null
}

// ---------------------------------------------------------------------------
// Sheet header fields (accuracy class, temperature, humidity, connection,
// dial size) have no dedicated columns, so they are stored as a tagged first
// line of the record notes and parsed back on edit.
// ---------------------------------------------------------------------------
const NOTES_TAG = '[Pressure Gauge]'
const CONDITION_KEYS: Array<[keyof GaugeConditions, string]> = [
  ['accuracyPct', 'Accuracy (% FS)'],
  ['temperature', 'Temp (°C)'],
  ['humidity', 'Humidity (%RH)'],
  ['connection', 'Connection'],
  ['dialSize', 'Dial'],
]

function clean(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim()
}

export function composeGaugeNotes(c: GaugeConditions, freeNotes: string): string {
  const parts = CONDITION_KEYS
    .filter(([k]) => clean(c[k]) !== '')
    .map(([k, label]) => `${label}: ${clean(c[k])}`)
  const header = parts.length > 0 ? `${NOTES_TAG} ${parts.join(' | ')}` : ''
  return [header, freeNotes.trim()].filter(Boolean).join('\n')
}

export function parseGaugeNotes(notes: string): { conditions: GaugeConditions; freeNotes: string; tagged: boolean } {
  const conditions = emptyGaugeConditions()
  if (!notes.startsWith(NOTES_TAG)) return { conditions, freeNotes: notes, tagged: false }
  const nl = notes.indexOf('\n')
  const header = (nl === -1 ? notes : notes.slice(0, nl)).slice(NOTES_TAG.length).trim()
  const freeNotes = nl === -1 ? '' : notes.slice(nl + 1)
  for (const part of header.split(' | ')) {
    const entry = CONDITION_KEYS.find(([, label]) => part.startsWith(`${label}: `))
    if (entry) conditions[entry[0]] = part.slice(entry[1].length + 2)
  }
  return { conditions, freeNotes, tagged: true }
}

// ---------------------------------------------------------------------------
// Row editing helpers (used by the component and tests)
// ---------------------------------------------------------------------------
export function setGaugeReading(
  points: GaugePoint[],
  index: number,
  dir: GaugeDirection,
  field: keyof GaugeReading,
  value: string,
): GaugePoint[] {
  return points.map((p, i) => (i === index ? { ...p, [dir]: { ...p[dir], [field]: value } } : p))
}

/** Copy As Found → As Left for one reading, or for every reading when index is omitted. */
export function copyGaugeAsFoundToAsLeft(points: GaugePoint[], index?: number, dir?: GaugeDirection): GaugePoint[] {
  return points.map((p, i) => {
    if (index !== undefined && i !== index) return p
    const copy = (d: GaugeDirection) =>
      dir === undefined || dir === d ? { ...p[d], asLeft: p[d].asFound } : p[d]
    return { ...p, rising: copy('rising'), falling: copy('falling') }
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface PressureGaugeTemplateProps {
  asset: LocalAsset
  points: GaugePoint[]
  onChange: (points: GaugePoint[]) => void
  conditions: GaugeConditions
  onConditionsChange: (c: GaugeConditions) => void
  /** Locked record: hide the copy controls. */
  readOnly?: boolean
}

const inputClass =
  'w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent'

function PassIcon({ pass }: { pass: boolean | null }) {
  if (pass === true) return <CheckCircle className="inline-block text-green-600" size={22} aria-label="Pass" />
  if (pass === false) return <XCircle className="inline-block text-red-600" size={22} aria-label="Fail" />
  return <span className="text-gray-400">—</span>
}

function ResultChip({ label, max, result }: { label: string; max: number | null; result: GaugeResult }) {
  const tone =
    result === 'PASS' ? 'bg-green-50 border-green-200 text-green-700'
      : result === 'FAIL' ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-gray-50 border-gray-200 text-gray-500'
  return (
    <div className={`flex items-center justify-between gap-3 border rounded-lg px-3 py-2 ${tone}`}>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm font-mono font-semibold">
        {max !== null ? `±${max.toFixed(2)} % FS` : '—'} · {result}
      </span>
    </div>
  )
}

export default function PressureGaugeTemplate({
  asset,
  points,
  onChange,
  conditions,
  onConditionsChange,
  readOnly = false,
}: PressureGaugeTemplateProps) {
  const range = gaugeRange(asset)
  const span = range.max - range.min
  const accuracy = gaugeAccuracy(conditions)
  const summary = gaugeSummary(points, range, accuracy)
  const devDp = span >= 10 ? 2 : 3

  function setCondition(field: keyof GaugeConditions, value: string) {
    onConditionsChange({ ...conditions, [field]: value })
  }

  function renderDeviation(nominal: number, reading: string) {
    const dev = gaugeDeviation(nominal, reading)
    if (dev === null) return <span className="text-gray-400">Dev —</span>
    const ok = gaugeWithin(gaugeErrorPctFS(dev, span), accuracy)
    return (
      <span className={`font-mono font-semibold ${ok ? 'text-green-600' : 'text-red-600'}`}>
        Dev {dev > 0 ? '+' : ''}{dev.toFixed(devDp)}
      </span>
    )
  }

  function renderSection(dir: GaugeDirection) {
    const order = dir === 'rising'
      ? points.map((p, i) => ({ p, i }))
      : points.map((p, i) => ({ p, i })).reverse()
    return (
      <section className="space-y-2" aria-label={dir === 'rising' ? 'Rising' : 'Falling'}>
        <h3 className="text-sm font-semibold text-gray-800">
          {dir === 'rising' ? `${RISING_MARK} Rising (increasing pressure)` : `${FALLING_MARK} Falling (decreasing pressure)`}
        </h3>
        <div className="hidden sm:grid sm:grid-cols-[6.5rem_1fr_1fr_3rem_3rem] gap-x-3 px-1 text-xs font-semibold text-gray-600">
          <span>Instrument ({range.unit})</span>
          <span>As Found — Reference</span>
          <span>As Left — Reference</span>
          <span className="text-center">Copy</span>
          <span className="text-center">A.L.</span>
        </div>
        {order.map(({ p, i }) => {
          const reading = p[dir]
          const label = gaugeLabel(p.nominal, range.unit, dir)
          const leftDev = gaugeDeviation(p.nominal, reading.asLeft)
          const leftPass = leftDev === null ? null : gaugeWithin(gaugeErrorPctFS(leftDev, span), accuracy)
          return (
            <div
              key={label}
              className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-gray-200 pt-2 sm:grid-cols-[6.5rem_1fr_1fr_3rem_3rem] sm:items-start"
            >
              <div className="col-span-2 flex items-center gap-2 sm:contents">
                <div className="font-medium text-gray-800 sm:order-1 sm:pt-3">
                  {formatNominal(p.nominal)} <span className="text-gray-500 text-sm">{range.unit}</span>
                  <span className="text-gray-400 text-xs ml-1">({p.pct}%)</span>
                </div>
                <div className="ml-auto sm:ml-0 sm:order-4 sm:flex sm:justify-center sm:pt-1">
                  {!readOnly && (
                    <CopyRowAsFoundButton
                      onClick={() => onChange(copyGaugeAsFoundToAsLeft(points, i, dir))}
                      disabled={reading.asFound.trim() === ''}
                    />
                  )}
                </div>
                <div className="sm:order-5 sm:flex sm:justify-center sm:pt-3">
                  <PassIcon pass={leftPass} />
                </div>
              </div>
              <div className="space-y-1 sm:order-2">
                <span className="block text-xs text-gray-500 sm:hidden">As Found ref.</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={reading.asFound}
                  onChange={(e) => onChange(setGaugeReading(points, i, dir, 'asFound', e.target.value))}
                  placeholder="—"
                  aria-label={`As found reference at ${label}`}
                  className={inputClass}
                />
                <div className="text-xs">{renderDeviation(p.nominal, reading.asFound)}</div>
              </div>
              <div className="space-y-1 sm:order-3">
                <span className="block text-xs text-gray-500 sm:hidden">As Left ref.</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={reading.asLeft}
                  onChange={(e) => onChange(setGaugeReading(points, i, dir, 'asLeft', e.target.value))}
                  placeholder="—"
                  aria-label={`As left reference at ${label}`}
                  className={inputClass}
                />
                <div className="text-xs">{renderDeviation(p.nominal, reading.asLeft)}</div>
              </div>
            </div>
          )
        })}
      </section>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="gauge-accuracy" className="block text-sm font-medium text-gray-700 mb-1">Accuracy (± % FS)</label>
          <input
            id="gauge-accuracy"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={conditions.accuracyPct}
            onChange={(e) => setCondition('accuracyPct', e.target.value)}
            placeholder={String(GAUGE_DEFAULT_ACCURACY)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="gauge-temp" className="block text-sm font-medium text-gray-700 mb-1">Temperature (°C)</label>
          <input
            id="gauge-temp"
            type="text"
            inputMode="decimal"
            value={conditions.temperature}
            onChange={(e) => setCondition('temperature', e.target.value)}
            placeholder="20 ± 3"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="gauge-rh" className="block text-sm font-medium text-gray-700 mb-1">Humidity (%RH)</label>
          <input
            id="gauge-rh"
            type="text"
            inputMode="decimal"
            value={conditions.humidity}
            onChange={(e) => setCondition('humidity', e.target.value)}
            placeholder="50 ± 20"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="gauge-connection" className="block text-sm font-medium text-gray-700 mb-1">Connection</label>
          <input
            id="gauge-connection"
            type="text"
            value={conditions.connection}
            onChange={(e) => setCondition('connection', e.target.value)}
            placeholder={'e.g. ½" MNPT'}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="gauge-dial" className="block text-sm font-medium text-gray-700 mb-1">Dial size</label>
          <input
            id="gauge-dial"
            type="text"
            value={conditions.dialSize}
            onChange={(e) => setCondition('dialSize', e.target.value)}
            placeholder={'e.g. 6"'}
            className={inputClass}
          />
        </div>
        <div className="text-sm text-gray-600 sm:pt-7">
          Range {formatNominal(range.min)}–{formatNominal(range.max)} {range.unit}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Set the gauge to each point and read the reference. Deviation = reference − instrument.
        </p>
        {!readOnly && (
          <CopyAllAsFoundButton
            onClick={() => onChange(copyGaugeAsFoundToAsLeft(points))}
            disabled={!points.some((p) => p.rising.asFound.trim() !== '' || p.falling.asFound.trim() !== '')}
          />
        )}
      </div>

      {renderSection('rising')}
      {renderSection('falling')}

      <div className="space-y-2">
        <ResultChip label="Max Error As Found" max={summary.maxErrorFound} result={summary.resultFound} />
        <ResultChip label="Max Error As Left" max={summary.maxErrorLeft} result={summary.resultLeft} />
        <p className="text-xs text-gray-500">Limit ±{accuracy} % FS (span {formatNominal(span)} {range.unit}).</p>
      </div>
    </div>
  )
}
