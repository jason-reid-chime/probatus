import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle, XCircle, LayoutTemplate, X } from 'lucide-react'
import { db } from '../../lib/db'
import { isOnline } from '../../lib/sync/connectivity'
import type { LocalAsset, LocalMeasurement } from '../../lib/db'
import { useAuth } from '../../hooks/useAuth'
import { useSaveCalibration } from '../../hooks/useCalibration'
import { overallResult, calcErrorPct, isPass, calc4_20mAErrorPct } from '../../utils/calibrationMath'
import TemplatePicker from '../../components/calibrations/TemplatePicker'
import StandardPicker from '../../components/standards/StandardPicker'
import type { CalibrationTemplate } from '../../types'

import PressureTemplate, {
  buildDefaultPressureRows,
  type PressureRow,
} from './templates/PressureTemplate'
import TemperatureTemplate, {
  buildDefaultTemperatureRows,
  type TemperatureRow,
} from './templates/TemperatureTemplate'
import PHTemplate, {
  buildDefaultPHData,
  type PHData,
} from './templates/PHTemplate'
import LevelTemplate, {
  buildDefaultLevelRows,
  type LevelRow,
} from './templates/LevelTemplate'
import SwitchTemplate, {
  buildDefaultSwitchData,
  type SwitchData,
} from './templates/SwitchTemplate'
import ConductivityTemplate, {
  buildDefaultConductivityData,
  type ConductivityData,
} from './templates/ConductivityTemplate'
import TransmitterTemplate, {
  buildDefaultTransmitterRows,
  type TransmitterRow,
} from './templates/TransmitterTemplate'

// ---------------------------------------------------------------------------
// Toast — minimal local implementation
// ---------------------------------------------------------------------------
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg">
      {message}
    </div>
  )
}

// ---------------------------------------------------------------------------
// helpers to convert template state → LocalMeasurement[]
// ---------------------------------------------------------------------------
function pressureMeasurements(
  recordId: string,
  rows: PressureRow[],
  asset: LocalAsset,
): LocalMeasurement[] {
  const span = (asset.range_max ?? 100) - (asset.range_min ?? 0)
  return rows.map((row) => {
    const asLeftNum = parseFloat(row.asLeft)
    const hasLeft = row.asLeft !== '' && !isNaN(asLeftNum)
    const errorPct = hasLeft && span !== 0
      ? Math.abs(asLeftNum - row.standardValue) / span * 100
      : undefined
    const pass = hasLeft && errorPct !== undefined && isFinite(errorPct)
      ? isPass(errorPct)
      : undefined
    return {
      id: crypto.randomUUID(),
      record_id: recordId,
      point_label: `${row.pct}%`,
      standard_value: row.standardValue,
      measured_value: hasLeft ? asLeftNum : undefined,
      unit: undefined,
      pass,
      error_pct: errorPct !== undefined && isFinite(errorPct) ? errorPct : undefined,
    }
  })
}

function temperatureMeasurements(
  recordId: string,
  rows: TemperatureRow[],
): LocalMeasurement[] {
  return rows.map((row) => {
    const refNum = parseFloat(row.reference)
    const measNum = parseFloat(row.measured)
    const hasValue =
      row.reference !== '' &&
      row.measured !== '' &&
      !isNaN(refNum) &&
      !isNaN(measNum)
    const rawErr = hasValue ? calcErrorPct(refNum, measNum) : undefined
    const errorPct = rawErr !== undefined && isFinite(rawErr) ? rawErr : undefined
    const pass = errorPct !== undefined ? isPass(errorPct) : undefined
    return {
      id: crypto.randomUUID(),
      record_id: recordId,
      point_label: row.label,
      standard_value: hasValue ? refNum : undefined,
      measured_value: hasValue ? measNum : undefined,
      unit: '°C',
      pass,
      error_pct: errorPct !== undefined && isFinite(errorPct) ? errorPct : undefined,
    }
  })
}

function phMeasurements(recordId: string, data: PHData): LocalMeasurement[] {
  const ms: LocalMeasurement[] = []
  if (data.phReading !== '') {
    ms.push({
      id: crypto.randomUUID(),
      record_id: recordId,
      point_label: 'pH Reading',
      measured_value: parseFloat(data.phReading) || undefined,
      notes: `Buffer 1 Lot: ${data.buffer1LotNumber} Exp: ${data.buffer1Expiry}${data.buffer2LotNumber ? ` | Buffer 2 Lot: ${data.buffer2LotNumber} Exp: ${data.buffer2Expiry}` : ''}`,
    })
  }
  if (data.conductivityReading !== '') {
    ms.push({
      id: crypto.randomUUID(),
      record_id: recordId,
      point_label: 'Conductivity Reading',
      measured_value: parseFloat(data.conductivityReading) || undefined,
      unit: 'µS/cm',
    })
  }
  return ms
}

function levelMeasurements(
  recordId: string,
  rows: LevelRow[],
): LocalMeasurement[] {
  return rows.map((row) => {
    const outNum = parseFloat(row.outputMA)
    const hasValue = row.outputMA !== '' && !isNaN(outNum)
    const expectedMA = 4 + (row.pct / 100) * 16
    const errorPct = hasValue ? calc4_20mAErrorPct(row.pct, outNum) : undefined
    const pass =
      hasValue && errorPct !== undefined && isFinite(errorPct)
        ? isPass(errorPct)
        : undefined
    return {
      id: crypto.randomUUID(),
      record_id: recordId,
      point_label: `${row.pct}%`,
      standard_value: expectedMA,
      measured_value: hasValue ? outNum : undefined,
      unit: 'mA',
      pass,
      error_pct: errorPct !== undefined && isFinite(errorPct) ? errorPct : undefined,
    }
  })
}

function switchMeasurements(
  recordId: string,
  data: SwitchData,
  asset: LocalAsset,
): LocalMeasurement[] {
  const span = (asset.range_max ?? 100) - (asset.range_min ?? 0)
  const setpointNum = parseFloat(data.setpoint)
  const tolerancePct = parseFloat(data.tolerancePct) || 2
  const unit = asset.range_unit
  const ms: LocalMeasurement[] = []

  const addRow = (label: string, asLeftStr: string) => {
    const val = parseFloat(asLeftStr)
    if (asLeftStr === '' || isNaN(val) || isNaN(setpointNum)) return
    const errPct = span > 0 ? Math.abs(val - setpointNum) / span * 100 : 0
    ms.push({
      id: crypto.randomUUID(),
      record_id: recordId,
      point_label: label,
      standard_value: setpointNum,
      measured_value: val,
      unit,
      error_pct: errPct,
      pass: errPct <= tolerancePct,
    })
  }

  addRow('Trip (Rising)', data.asLeftTrip)
  addRow('Reset (Falling)', data.asLeftReset)
  return ms
}

function conductivityMeasurements(
  recordId: string,
  data: ConductivityData,
): LocalMeasurement[] {
  const tolerancePct = parseFloat(data.tolerancePct) || 2
  return data.standards
    .filter(s => s.nominal !== '' && s.reading !== '')
    .map(s => {
      const nominal = parseFloat(s.nominal)
      const reading = parseFloat(s.reading)
      if (isNaN(nominal) || isNaN(reading)) return null
      const errPct = nominal > 0 ? Math.abs(reading - nominal) / nominal * 100 : 0
      const notes = [s.lotNumber && `Lot: ${s.lotNumber}`, s.expiry && `Exp: ${s.expiry}`].filter(Boolean).join(' ') || undefined
      return {
        id: crypto.randomUUID(),
        record_id: recordId,
        point_label: `${s.nominal} ${data.unit}`,
        standard_value: nominal,
        measured_value: reading,
        unit: data.unit as string,
        error_pct: errPct,
        pass: errPct <= tolerancePct,
        notes,
      } as LocalMeasurement
    })
    .filter((m): m is NonNullable<typeof m> => m !== null) as LocalMeasurement[]
}

function transmitterMeasurements(
  recordId: string,
  rows: TransmitterRow[],
): LocalMeasurement[] {
  const ms: LocalMeasurement[] = []
  for (const row of rows) {
    const pvNum = parseFloat(row.pvAsLeft)
    const maNum = parseFloat(row.maAsLeft)
    const hasPV = row.pvAsLeft !== '' && !isNaN(pvNum)
    const hasMA = row.maAsLeft !== '' && !isNaN(maNum)

    if (hasPV) {
      const errPct = calcErrorPct(row.appliedValue, pvNum)
      ms.push({
        id: crypto.randomUUID(),
        record_id: recordId,
        point_label: `${row.pct}% PV`,
        standard_value: row.appliedValue,
        measured_value: pvNum,
        error_pct: isFinite(errPct) ? errPct : undefined,
        pass: isFinite(errPct) ? isPass(errPct) : undefined,
      })
    }
    if (hasMA) {
      const expMA = 4 + (row.pct / 100) * 16
      const errPct = calc4_20mAErrorPct(row.pct, maNum)
      ms.push({
        id: crypto.randomUUID(),
        record_id: recordId,
        point_label: `${row.pct}% mA`,
        standard_value: expMA,
        measured_value: maNum,
        unit: 'mA',
        error_pct: isFinite(errPct) ? errPct : undefined,
        pass: isFinite(errPct) ? isPass(errPct) : undefined,
      })
    }
  }
  return ms
}

// ---------------------------------------------------------------------------
// Result banner
// ---------------------------------------------------------------------------
function ResultBanner({ result }: { result: 'PASS' | 'FAIL' | 'INCOMPLETE' }) {
  if (result === 'INCOMPLETE') {
    return (
      <div className="flex items-center gap-3 px-5 py-4 rounded-xl border bg-gray-50 border-gray-300 text-gray-500 text-lg font-semibold">
        <span>—</span>
        <span>Awaiting measurements</span>
      </div>
    )
  }
  if (result === 'PASS') {
    return (
      <div className="flex items-center gap-3 px-5 py-4 rounded-xl border-2 bg-green-50 border-green-500 text-green-700 text-lg font-bold">
        <CheckCircle size={28} />
        <span>PASS</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 px-5 py-4 rounded-xl border-2 bg-red-50 border-red-500 text-red-700 text-lg font-bold">
      <XCircle size={28} />
      <span>FAIL</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------
export default function CalibrationForm() {
  const { assetId, existingRecordId } = useParams<{ assetId: string; existingRecordId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const saveCalibration = useSaveCalibration()

  // Asset loaded from Dexie
  const [asset, setAsset] = useState<LocalAsset | null>(null)
  const [assetLoading, setAssetLoading] = useState(true)

  // Header fields
  const [salesNumber, setSalesNumber] = useState('')
  const [flagNumber, setFlagNumber] = useState('')
  const [notes, setNotes] = useState('')

  // Template state
  const [pressureRows, setPressureRows] = useState<PressureRow[]>([])
  const [temperatureRows, setTemperatureRows] = useState<TemperatureRow[]>(
    buildDefaultTemperatureRows(),
  )
  const [phData, setPhData] = useState<PHData>(buildDefaultPHData())
  const [levelRows, setLevelRows] = useState<LevelRow[]>(
    buildDefaultLevelRows(),
  )
  const [switchData, setSwitchData] = useState<SwitchData>(buildDefaultSwitchData())
  const [conductivityData, setConductivityData] = useState<ConductivityData>(buildDefaultConductivityData())
  const [transmitterRows, setTransmitterRows] = useState<TransmitterRow[]>([])

  const [selectedStandardIds, setSelectedStandardIds] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [appliedTemplate, setAppliedTemplate] = useState<CalibrationTemplate | null>(null)

  // Stable IDs — reuse existing if editing, generate new if creating
  const [localId] = useState(() => existingRecordId ?? crypto.randomUUID())
  const [recordId] = useState(() => existingRecordId ?? crypto.randomUUID())

  // Stable measurement IDs keyed by point_label. Seeded from DB on edit load,
  // otherwise generated once on first access. Prevents duplicate rows when the
  // form is saved multiple times (each helper function calls crypto.randomUUID()
  // on every render, which would cause new DB rows on every save).
  const stableMeasurementIds = useRef<Map<string, string>>(new Map())

  // Load asset (and existing record if editing) from Dexie on mount
  useEffect(() => {
    if (!assetId) return

    async function load() {
      // Try Dexie first, fall back to Supabase
      let a = await db.assets.get(assetId!)
      if (!a) {
        const { supabase } = await import('../../lib/supabase')
        const { data } = await supabase.from('assets').select('*').eq('id', assetId).maybeSingle()
        if (data) {
          await db.assets.put(data as LocalAsset)
          a = data as LocalAsset
        }
      }

      setAsset(a ?? null)
      if (a) {
        setPressureRows(buildDefaultPressureRows(a))
        setTransmitterRows(buildDefaultTransmitterRows(a))
      }

      if (existingRecordId) {
        // Load existing record header fields — Dexie first, fall back to Supabase
        const rec = await db.calibration_records.get(existingRecordId)
        if (rec) {
          setSalesNumber(rec.sales_number ?? '')
          setFlagNumber(rec.flag_number ?? '')
          setNotes(rec.notes ?? '')
        }

        // Load existing measurements — fall back to Supabase if Dexie is empty.
        // Critical: if Dexie is empty (different browser/cleared storage), we must
        // seed stableMeasurementIds from remote IDs or a re-save will generate new
        // UUIDs and insert duplicate rows instead of updating existing ones.
        let measurements = await db.measurements
          .where('record_id').equals(existingRecordId).toArray()
        if (measurements.length === 0) {
          const { supabase } = await import('../../lib/supabase')
          const { data } = await supabase
            .from('calibration_measurements')
            .select('*')
            .eq('record_id', existingRecordId)
          if (data && data.length > 0) {
            measurements = data as typeof measurements
            await db.measurements.bulkPut(measurements)
          }
        }

        // Load existing standard IDs so re-save doesn't wipe them
        const { supabase } = await import('../../lib/supabase')
        const { data: stdLinks } = await supabase
          .from('calibration_standards_used')
          .select('standard_id')
          .eq('record_id', existingRecordId)
        if (stdLinks && stdLinks.length > 0) {
          setSelectedStandardIds(stdLinks.map((l: { standard_id: string }) => l.standard_id))
        }

        // Seed stable ID map so re-saves update existing rows rather than inserting new ones
        for (const m of measurements) {
          stableMeasurementIds.current.set(m.point_label, m.id)
        }
        if (measurements.length > 0 && a) {
          const type = a.instrument_type?.toLowerCase() ?? ''
          if (type === 'pressure') {
            setPressureRows(measurements.map(m => ({
              pct: m.standard_value ?? 0,
              standardValue: m.standard_value ?? 0,
              asFound: m.measured_value != null ? String(m.measured_value) : '',
              asLeft: m.measured_value != null ? String(m.measured_value) : '',
            })))
          } else if (type === 'temperature') {
            setTemperatureRows(measurements.map(m => ({
              id: m.id ?? crypto.randomUUID(),
              label: m.point_label,
              reference: m.standard_value != null ? String(m.standard_value) : '',
              measured: m.measured_value != null ? String(m.measured_value) : '',
            })))
          } else if (type === 'level_4_20ma' || type === 'flow') {
            setLevelRows(measurements.map(m => ({
              pct: m.standard_value ?? 0,
              outputMA: m.measured_value != null ? String(m.measured_value) : '',
            })))
          } else if (type === 'pressure_switch' || type === 'temperature_switch') {
            const trip = measurements.find(m => m.point_label === 'Trip (Rising)')
            const reset = measurements.find(m => m.point_label === 'Reset (Falling)')
            setSwitchData({
              setpoint: trip?.standard_value != null ? String(trip.standard_value) : '',
              tolerancePct: '2',
              asFoundTrip: '',
              asFoundReset: '',
              asLeftTrip: trip?.measured_value != null ? String(trip.measured_value) : '',
              asLeftReset: reset?.measured_value != null ? String(reset.measured_value) : '',
            })
          } else if (type === 'conductivity') {
            const standards = measurements.map(m => ({
              id: crypto.randomUUID(),
              nominal: m.standard_value != null ? String(m.standard_value) : '',
              reading: m.measured_value != null ? String(m.measured_value) : '',
              lotNumber: '',
              expiry: '',
            }))
            if (standards.length > 0) {
              setConductivityData(prev => ({ ...prev, standards }))
            }
          } else if (type === 'transmitter_4_20ma' && a) {
            const pvMeasurements = measurements.filter(m => m.point_label.endsWith('% PV'))
            if (pvMeasurements.length > 0) {
              setTransmitterRows(pvMeasurements.map(m => {
                const pct = parseInt(m.point_label) || 0
                const maMeas = measurements.find(mm => mm.point_label === `${pct}% mA`)
                return {
                  pct,
                  appliedValue: m.standard_value ?? 0,
                  pvAsFound: '',
                  pvAsLeft: m.measured_value != null ? String(m.measured_value) : '',
                  maAsFound: '',
                  maAsLeft: maMeas?.measured_value != null ? String(maMeas.measured_value) : '',
                }
              }))
            }
          }
        }
      }

      setAssetLoading(false)
    }

    load()
  }, [assetId, existingRecordId])

  // Compute live measurements for overallResult
  const liveMeasurements: LocalMeasurement[] = useMemo(() => {
    if (!asset) return []
    const type = asset.instrument_type ?? ''
    let raw: LocalMeasurement[] = []
    if (type === 'pressure') raw = pressureMeasurements(recordId, pressureRows, asset)
    else if (type === 'temperature') raw = temperatureMeasurements(recordId, temperatureRows)
    else if (type === 'ph_conductivity') raw = phMeasurements(recordId, phData)
    else if (type === 'conductivity') raw = conductivityMeasurements(recordId, conductivityData)
    else if (type === 'level_4_20ma' || type === 'flow') raw = levelMeasurements(recordId, levelRows)
    else if (type === 'transmitter_4_20ma') raw = transmitterMeasurements(recordId, transmitterRows)
    else if (type === 'pressure_switch' || type === 'temperature_switch') raw = switchMeasurements(recordId, switchData, asset)
    else raw = []

    // Assign stable IDs so that re-saves upsert the same rows rather than
    // inserting duplicates. IDs are keyed by point_label and generated once
    // per session (or seeded from the DB when editing an existing record).
    const idMap = stableMeasurementIds.current
    return raw.map(m => {
      if (!idMap.has(m.point_label)) idMap.set(m.point_label, crypto.randomUUID())
      return { ...m, id: idMap.get(m.point_label)! }
    })
  }, [asset, pressureRows, temperatureRows, phData, conductivityData, levelRows, transmitterRows, switchData, recordId])

  const result = useMemo(() => {
    if (!asset) return 'INCOMPLETE' as const
    if (asset.instrument_type === 'ph_conductivity') return 'INCOMPLETE' as const
    return overallResult(liveMeasurements)
  }, [asset, liveMeasurements])

  function handleTemplateSelect(template: CalibrationTemplate) {
    setAppliedTemplate(template)

    // Pre-fill measurement rows from the template's points
    const type = asset?.instrument_type?.toLowerCase() ?? ''

    if (type === 'pressure') {
      setPressureRows(
        template.points.map((p, i) => ({
          pct: p.standard_value ?? i * 25,
          standardValue: p.standard_value ?? 0,
          asFound: '',
          asLeft: '',
        })),
      )
    } else if (type === 'temperature') {
      setTemperatureRows(
        template.points.map((p) => ({
          id: crypto.randomUUID(),
          label: p.label,
          reference: p.standard_value !== null ? String(p.standard_value) : '',
          measured: '',
        })),
      )
    } else if (type === 'level_4_20ma' || type === 'flow') {
      setLevelRows(
        template.points.map((p, i) => ({
          pct: p.standard_value ?? i * 25,
          outputMA: '',
        })),
      )
    } else if (type === 'pressure_switch' || type === 'temperature_switch') {
      const firstPoint = template.points[0]
      setSwitchData(prev => ({
        ...prev,
        setpoint: firstPoint?.standard_value != null ? String(firstPoint.standard_value) : prev.setpoint,
        tolerancePct: template.tolerance_pct != null ? String(template.tolerance_pct) : prev.tolerancePct,
      }))
    } else if (type === 'conductivity') {
      setConductivityData(prev => ({
        ...prev,
        tolerancePct: template.tolerance_pct != null ? String(template.tolerance_pct) : prev.tolerancePct,
        standards: template.points.map(p => ({
          id: crypto.randomUUID(),
          nominal: p.standard_value != null ? String(p.standard_value) : '',
          reading: '',
          lotNumber: '',
          expiry: '',
        })),
      }))
    } else if (type === 'transmitter_4_20ma' && asset) {
      setTransmitterRows(
        template.points.map((p, i) => ({
          pct: p.standard_value ?? i * 25,
          appliedValue: p.standard_value ?? 0,
          pvAsFound: '',
          pvAsLeft: '',
          maAsFound: '',
          maAsLeft: '',
        })),
      )
    }
    // pH template points are display-only; no row state to pre-fill
  }

  async function handleSave() {
    if (!asset || !profile) return
    setSaving(true)

    try {
      const now = new Date().toISOString()
      const record = {
        id: recordId,
        local_id: localId,
        tenant_id: profile.tenant_id,
        asset_id: asset.id,
        technician_id: profile.id,
        status: 'in_progress' as const,
        performed_at: now,
        updated_at: now,
        sales_number: salesNumber || undefined,
        flag_number: flagNumber || undefined,
        notes: notes || undefined,
      }

      await saveCalibration.mutateAsync({
        record,
        measurements: liveMeasurements,
        standardIds: selectedStandardIds,
      })

      setToast(isOnline() ? 'Saved' : 'Saved offline — will sync when online')
      setTimeout(() => navigate(`/calibrations/${recordId}`), 1200)
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (assetLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Loading asset…
      </div>
    )
  }

  if (!asset) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Asset not found. Make sure it has been synced to this device.
      </div>
    )
  }

  const instrumentType = asset.instrument_type ?? ''
  const typeLower = instrumentType.toLowerCase()

  const isPH = typeLower === 'ph_conductivity'
  const isConductivity = typeLower === 'conductivity'
  const isSwitch = typeLower === 'pressure_switch' || typeLower === 'temperature_switch'
  const isLevel = typeLower === 'level_4_20ma' || typeLower === 'flow'
  const isTransmitter = typeLower === 'transmitter_4_20ma'

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Asset header */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 space-y-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-bold text-gray-900">{asset.tag_id}</h1>
          <span className="text-sm bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">
            {instrumentType}
          </span>
        </div>
        <p className="text-sm text-gray-500">
          {[asset.manufacturer, asset.model].filter(Boolean).join(' · ')}
          {asset.range_min !== undefined && asset.range_max !== undefined && (
            <span>
              {' '}
              · Range: {asset.range_min}–{asset.range_max}
              {asset.range_unit ? ` ${asset.range_unit}` : ''}
            </span>
          )}
          {asset.location && <span> · {asset.location}</span>}
        </p>
      </div>

      {/* Master standards */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-3">
        <h2 className="text-base font-semibold text-gray-800">Master Standards Used</h2>
        {selectedStandardIds.length === 0 && (
          <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>No standard selected — traceability will not be recorded.</span>
          </div>
        )}
        <StandardPicker selected={selectedStandardIds} onChange={setSelectedStandardIds} />
      </div>

      {/* Template picker button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowTemplatePicker(true)}
          className="inline-flex items-center gap-2 border border-brand-300 text-brand-600 hover:bg-brand-50 font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors"
        >
          <LayoutTemplate size={16} />
          Use Template
        </button>
        {appliedTemplate && (
          <div className="flex items-center gap-2 flex-1 bg-brand-50 border border-brand-200 text-brand-700 text-sm font-medium px-4 py-2.5 rounded-xl">
            <LayoutTemplate size={15} className="shrink-0" />
            <span className="truncate">
              Template applied: {appliedTemplate.name}
            </span>
            <button
              type="button"
              onClick={() => setAppliedTemplate(null)}
              className="ml-auto p-0.5 text-brand-400 hover:text-brand-700 rounded transition-colors"
              aria-label="Clear template"
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Overall result banner */}
      {!isPH && !isConductivity && <ResultBanner result={result} />}

      {/* Header fields */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-800">
          Job Information
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sales # <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={salesNumber}
              onChange={(e) => setSalesNumber(e.target.value)}
              placeholder="e.g. SO-12345"
              className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Flag # <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={flagNumber}
              onChange={(e) => setFlagNumber(e.target.value)}
              placeholder="e.g. FLAG-001"
              className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Observations, conditions, remarks…"
            className="w-full text-base px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
          />
        </div>
      </div>

      {/* Measurement template */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-800">
          Measurements
        </h2>

        {typeLower === 'pressure' && (
          <PressureTemplate asset={asset} rows={pressureRows} onChange={setPressureRows} />
        )}

        {typeLower === 'temperature' && (
          <TemperatureTemplate rows={temperatureRows} onChange={setTemperatureRows} />
        )}

        {isPH && (
          <PHTemplate data={phData} onChange={setPhData} />
        )}

        {isConductivity && (
          <ConductivityTemplate data={conductivityData} onChange={setConductivityData} />
        )}

        {isLevel && (
          <LevelTemplate rows={levelRows} onChange={setLevelRows} />
        )}

        {isTransmitter && (
          <TransmitterTemplate asset={asset} rows={transmitterRows} onChange={setTransmitterRows} />
        )}

        {isSwitch && (
          <SwitchTemplate asset={asset} data={switchData} onChange={setSwitchData} />
        )}

        {typeLower === 'other' && (
          <p className="text-sm text-gray-500 italic">
            No template for "Other" — add measurements manually via notes.
          </p>
        )}
      </div>

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl min-h-[52px] px-6 py-3 transition-colors"
      >
        {saving ? 'Saving…' : 'Save Calibration'}
      </button>

      {toast && (
        <Toast message={toast} onDone={() => setToast(null)} />
      )}

      {showTemplatePicker && (
        <TemplatePicker
          instrumentType={instrumentType}
          onSelect={handleTemplateSelect}
          onDismiss={() => setShowTemplatePicker(false)}
        />
      )}
    </div>
  )
}
