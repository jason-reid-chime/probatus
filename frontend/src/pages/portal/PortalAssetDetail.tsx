import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface AssetDetail {
  id: string
  tag_id: string
  serial_number: string | null
  manufacturer: string | null
  model: string | null
  instrument_type: string
  range_min: number | null
  range_max: number | null
  range_unit: string | null
  location: string | null
  next_due_at: string | null
}

interface CalibrationRecord {
  id: string
  performed_at: string
  status: 'in_progress' | 'pending_approval' | 'approved' | 'rejected'
  certificate_url: string | null
  notes: string | null
  technician: {
    full_name: string
  } | null
  measurements: {
    id: string
    point_label: string
    standard_value: number | null
    measured_value: number | null
    unit: string | null
    pass: boolean | null
  }[]
}

type CalibrationStatus = CalibrationRecord['status']

function StatusBadge({ status }: { status: CalibrationStatus }) {
  const styles: Record<CalibrationStatus, string> = {
    approved: 'bg-green-100 text-green-700 border-green-200',
    pending_approval: 'bg-amber-100 text-amber-700 border-amber-200',
    in_progress: 'bg-blue-100 text-blue-700 border-blue-200',
    rejected: 'bg-red-100 text-red-700 border-red-200',
  }
  const labels: Record<CalibrationStatus, string> = {
    approved: 'Approved',
    pending_approval: 'Pending Approval',
    in_progress: 'In Progress',
    rejected: 'Rejected',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatInstrumentType(type: string): string {
  const map: Record<string, string> = {
    pressure: 'Pressure',
    temperature: 'Temperature',
    ph_conductivity: 'pH / Conductivity',
    level_4_20ma: 'Level (4–20 mA)',
    other: 'Other',
  }
  return map[type] ?? type
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4">
      <dt className="text-sm font-medium text-gray-500 sm:w-40 shrink-0">{label}</dt>
      <dd className="mt-0.5 sm:mt-0 text-sm text-gray-900">{value}</dd>
    </div>
  )
}

function resultFromMeasurements(measurements: CalibrationRecord['measurements']): string {
  if (measurements.length === 0) return '—'
  const allPass = measurements.every((m) => m.pass === true)
  const anyFail = measurements.some((m) => m.pass === false)
  if (anyFail) return 'FAIL'
  if (allPass) return 'PASS'
  return '—'
}

export default function PortalAssetDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [asset, setAsset] = useState<AssetDetail | null>(null)
  const [records, setRecords] = useState<CalibrationRecord[]>([])
  const [loadingAsset, setLoadingAsset] = useState(true)
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [assetError, setAssetError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    async function loadAsset() {
      setLoadingAsset(true)
      const { data, error } = await supabase
        .from('assets')
        .select('id, tag_id, serial_number, manufacturer, model, instrument_type, range_min, range_max, range_unit, location, next_due_at')
        .eq('id', id)
        .single()

      if (error || !data) {
        setAssetError('Instrument not found or you do not have access.')
      } else {
        setAsset(data as AssetDetail)
      }
      setLoadingAsset(false)
    }

    async function loadRecords() {
      setLoadingRecords(true)
      const { data, error } = await supabase
        .from('calibration_records')
        .select(`
          id,
          performed_at,
          status,
          certificate_url,
          notes,
          technician:profiles!calibration_records_technician_id_fkey (full_name),
          measurements:calibration_measurements (id, point_label, standard_value, measured_value, unit, pass)
        `)
        .eq('asset_id', id)
        .order('performed_at', { ascending: false })

      if (!error && data) {
        setRecords(data as unknown as CalibrationRecord[])
      }
      setLoadingRecords(false)
    }

    loadAsset()
    loadRecords()
  }, [id])

  if (loadingAsset) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (assetError || !asset) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/portal')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </button>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-sm text-red-700">
          {assetError ?? 'Instrument not found.'}
        </div>
      </div>
    )
  }

  const rangeStr =
    asset.range_min != null && asset.range_max != null
      ? `${asset.range_min} – ${asset.range_max}${asset.range_unit ? ` ${asset.range_unit}` : ''}`
      : '—'

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/portal')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-800 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Dashboard
      </button>

      {/* Asset details card */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h1 className="text-lg font-semibold text-gray-900">Instrument: {asset.tag_id}</h1>
        </div>
        <div className="px-5 py-5">
          <dl className="space-y-3">
            <DetailRow label="Tag ID" value={asset.tag_id} />
            <DetailRow label="Serial Number" value={asset.serial_number ?? '—'} />
            <DetailRow label="Manufacturer" value={asset.manufacturer ?? '—'} />
            <DetailRow label="Model" value={asset.model ?? '—'} />
            <DetailRow label="Type" value={formatInstrumentType(asset.instrument_type)} />
            <DetailRow label="Range" value={rangeStr} />
            <DetailRow label="Location" value={asset.location ?? '—'} />
            <DetailRow label="Next Due" value={formatDate(asset.next_due_at)} />
          </dl>
        </div>
      </div>

      {/* Calibration history */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Calibration History</h2>
        </div>

        {loadingRecords && (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loadingRecords && records.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-500">
            No calibration records found for this instrument.
          </div>
        )}

        {!loadingRecords && records.length > 0 && (
          <>
            {/* Table header — desktop only */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_auto_auto_auto] gap-4 px-5 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wider">
              <span>Date</span>
              <span>Technician</span>
              <span>Result</span>
              <span>Status</span>
              <span>Certificate</span>
            </div>

            <ul className="divide-y divide-gray-100">
              {records.map((record) => {
                const result = resultFromMeasurements(record.measurements)
                const canDownload = record.status === 'approved' && !!record.certificate_url

                return (
                  <li key={record.id} className="px-5 py-4">
                    {/* Mobile layout */}
                    <div className="sm:hidden space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-900 text-sm">
                          {formatDateTime(record.performed_at)}
                        </span>
                        <StatusBadge status={record.status} />
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm text-gray-500">
                          {record.technician?.full_name ?? '—'}
                        </span>
                        {result !== '—' && (
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded ${
                              result === 'PASS'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {result}
                          </span>
                        )}
                      </div>
                      {canDownload && (
                        <a
                          href={record.certificate_url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-800 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download Certificate
                        </a>
                      )}
                    </div>

                    {/* Desktop layout */}
                    <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_auto_auto_auto] gap-4 items-center">
                      <span className="text-sm text-gray-900">{formatDateTime(record.performed_at)}</span>
                      <span className="text-sm text-gray-600">{record.technician?.full_name ?? '—'}</span>
                      <span>
                        {result !== '—' ? (
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded ${
                              result === 'PASS'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {result}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </span>
                      <StatusBadge status={record.status} />
                      <span>
                        {canDownload ? (
                          <a
                            href={record.certificate_url!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-800 transition-colors whitespace-nowrap"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </a>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
