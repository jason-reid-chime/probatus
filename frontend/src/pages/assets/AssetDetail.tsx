import { useParams, useNavigate, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  ArrowLeft,
  Edit2,
  ClipboardList,
  FlaskConical,
  Tag,
  Hash,
  Factory,
  Box,
  Gauge,
  MapPin,
  Calendar,
  StickyNote,
  Clock,
  AlertCircle,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useAsset } from '../../hooks/useAssets'
import { useCalibrationsByAsset } from '../../hooks/useCalibration'
import { supabase } from '../../lib/supabase'
import { apiRequest } from '../../lib/api/client'
import { useAuth } from '../../hooks/useAuth'
import type { LocalMeasurement } from '../../lib/db'
import DriftChart from '../../components/calibrations/DriftChart'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const INSTRUMENT_LABELS: Record<string, string> = {
  pressure: 'Pressure',
  temperature: 'Temperature',
  ph_conductivity: 'pH / Conductivity',
  level_4_20ma: 'Level / 4-20 mA',
  other: 'Other',
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatDateShort(iso: string | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

type CalibrationStatus = 'overdue' | 'due-soon' | 'due-ok' | 'ok'

function getStatus(nextDueAt: string | undefined): CalibrationStatus {
  if (!nextDueAt) return 'ok'
  const diff = (new Date(nextDueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  if (diff < 0) return 'overdue'
  if (diff <= 30) return 'due-soon'
  if (diff <= 90) return 'due-ok'
  return 'ok'
}

const STATUS_CONFIG: Record<CalibrationStatus, { label: string; className: string }> = {
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-600 border border-red-200' },
  'due-soon': { label: 'Due Within 30 Days', className: 'bg-amber-100 text-amber-500 border border-amber-200' },
  'due-ok': { label: 'Due Within 90 Days', className: 'bg-yellow-100 text-yellow-500 border border-yellow-200' },
  ok: { label: 'OK', className: 'bg-green-100 text-green-600 border border-green-200' },
}

// ---------------------------------------------------------------------------
// Result badge helpers
// ---------------------------------------------------------------------------
type ResultLabel = 'PASS' | 'FAIL' | 'INCOMPLETE'

function getResultFromStatus(status: string): ResultLabel {
  if (status === 'approved') return 'PASS'
  if (status === 'rejected') return 'FAIL'
  return 'INCOMPLETE'
}

function ResultBadge({ result }: { result: ResultLabel }) {
  const cfg: Record<ResultLabel, { className: string }> = {
    PASS: { className: 'bg-green-100 text-green-700 border border-green-200' },
    FAIL: { className: 'bg-red-100 text-red-700 border border-red-200' },
    INCOMPLETE: { className: 'bg-gray-100 text-gray-500 border border-gray-200' },
  }
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg[result].className}`}>
      {result}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Detail row
// ---------------------------------------------------------------------------
function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-4 py-4 border-b border-gray-100 last:border-0">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-500">
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="mt-0.5 text-base text-gray-900">{value || <span className="text-gray-400 italic">Not set</span>}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Types for fetched data
// ---------------------------------------------------------------------------
interface ProfileRow {
  id: string
  full_name: string | null
}

interface MasterStandard {
  id: string
  name: string
  serial_number: string | null
  manufacturer: string | null
  due_at: string | null
}

interface StandardsUsedRow {
  standard_id: string
  master_standards: MasterStandard | null
}

// ---------------------------------------------------------------------------
// AssetDetail page
// ---------------------------------------------------------------------------
export default function AssetDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: asset, isLoading, isError } = useAsset(id ?? '')
  const { data: calibrations = [] } = useCalibrationsByAsset(id ?? '')

  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null)
  const [techNames, setTechNames] = useState<Record<string, string>>({})
  const [standards, setStandards] = useState<MasterStandard[]>([])

  const [deletingAsset, setDeletingAsset] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [driftMeasurements, setDriftMeasurements] = useState<Record<string, LocalMeasurement[]>>({})

  const canManage = profile?.role === 'supervisor' || profile?.role === 'admin'

  // Fetch customer
  useEffect(() => {
    if (!asset?.customer_id) return
    supabase
      .from('customers')
      .select('id, name')
      .eq('id', asset.customer_id)
      .single()
      .then(({ data }) => {
        setCustomer(data as { id: string; name: string } | null)
      })
  }, [asset?.customer_id])

  // Fetch technician names once calibrations are loaded
  useEffect(() => {
    if (calibrations.length === 0) return
    const uniqueIds = [...new Set(calibrations.map((c) => c.technician_id).filter(Boolean))]
    if (uniqueIds.length === 0) return

    supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', uniqueIds)
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, string> = {}
        for (const row of data as ProfileRow[]) {
          map[row.id] = row.full_name ?? 'Unknown'
        }
        setTechNames(map)
      })
  }, [calibrations])

  // Fetch measurements for drift trend chart (approved cals only)
  useEffect(() => {
    const approved = calibrations.filter(c => c.status === 'approved')
    if (approved.length < 2) return
    const ids = approved.map(c => c.id)
    supabase
      .from('calibration_measurements')
      .select('*')
      .in('record_id', ids)
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, LocalMeasurement[]> = {}
        for (const m of data as LocalMeasurement[]) {
          if (!map[m.record_id]) map[m.record_id] = []
          map[m.record_id].push(m)
        }
        setDriftMeasurements(map)
      })
  }, [calibrations])

  // Fetch standards used across all calibrations for this asset
  useEffect(() => {
    if (calibrations.length === 0) return
    const calIds = calibrations.map((c) => c.id)

    supabase
      .from('calibration_standards_used')
      .select('standard_id, master_standards(id, name, serial_number, manufacturer, due_at)')
      .in('record_id', calIds)
      .then(({ data }) => {
        if (!data) return
        const rows = data as unknown as StandardsUsedRow[]
        // Deduplicate by standard_id
        const seen = new Set<string>()
        const deduped: MasterStandard[] = []
        for (const row of rows) {
          if (!row.master_standards) continue
          if (seen.has(row.standard_id)) continue
          seen.add(row.standard_id)
          deduped.push(row.master_standards)
        }
        setStandards(deduped)
      })
  }, [calibrations])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 size={32} className="animate-spin text-brand-500" />
      </div>
    )
  }

  if (isError || !asset) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <AlertCircle size={48} className="text-red-400" />
        <h2 className="text-xl font-semibold text-gray-700">Asset not found</h2>
        <p className="text-gray-500">This asset may have been deleted or you don't have access.</p>
        <button
          onClick={() => navigate('/assets')}
          className="mt-2 flex h-11 items-center gap-2 rounded-xl bg-brand-500 px-6 text-base font-medium text-white hover:bg-brand-700"
        >
          Back to Assets
        </button>
      </div>
    )
  }

  // Derive calibration dates from history when the asset fields aren't populated yet
  // (they're written by the backend on approval; new assets start null).
  const approvedCals = calibrations.filter((c) => c.status === 'approved')
  const lastCalibratedAt = asset.last_calibrated_at
    ?? (approvedCals.length > 0 ? approvedCals[0].performed_at : undefined)
  const nextDueAt = asset.next_due_at
    ?? (lastCalibratedAt
      ? new Date(
          new Date(lastCalibratedAt).getTime() +
          asset.calibration_interval_days * 86400000,
        ).toISOString().slice(0, 10)
      : undefined)

  async function handleConfirmDelete() {
    if (!asset) return
    setDeleteLoading(true)
    setDeleteError(null)

    try {
      await apiRequest('DELETE', `/assets/${asset.id}`)
      navigate('/assets')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete asset')
      setDeleteLoading(false)
    }
  }

  const status = getStatus(nextDueAt)
  const { label: statusLabel, className: statusClass } = STATUS_CONFIG[status]

  const rangeStr =
    asset.range_min !== undefined && asset.range_max !== undefined
      ? `${asset.range_min} – ${asset.range_max}${asset.range_unit ? ` ${asset.range_unit}` : ''}`
      : asset.range_unit
        ? `— ${asset.range_unit}`
        : undefined

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-gray-900">{asset.tag_id}</h1>
            <p className="text-sm text-gray-500">
              {INSTRUMENT_LABELS[asset.instrument_type] ?? asset.instrument_type}
            </p>
          </div>
          {canManage && (
            <>
              <Link
                to={`/assets/${asset.id}/edit`}
                className="flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100"
              >
                <Edit2 size={18} />
                <span className="hidden sm:inline">Edit</span>
              </Link>
              <button
                onClick={() => setDeletingAsset(true)}
                className="flex h-11 items-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 px-4 text-base font-medium text-white shadow-sm active:opacity-80"
              >
                <Trash2 size={18} />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-6">
        {/* Customer badge */}
        {customer && (
          <Link
            to={`/customers/${customer.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
          >
            {customer.name}
          </Link>
        )}

        {/* Status banner */}
        <div className={`flex items-center justify-between rounded-2xl border px-5 py-4 ${statusClass}`}>
          <div>
            <p className="text-sm font-medium opacity-80">Calibration Status</p>
            <p className="mt-0.5 text-lg font-semibold">{statusLabel}</p>
          </div>
          {asset.next_due_at && (
            <div className="text-right">
              <p className="text-sm opacity-70">Next Due</p>
              <p className="text-base font-semibold">{formatDate(asset.next_due_at)}</p>
            </div>
          )}
        </div>

        {/* Start Calibration */}
        <Link
          to={`/calibrations/${asset.id}/new`}
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-brand-500 py-4 text-lg font-semibold text-white shadow hover:bg-brand-700 active:opacity-80 transition-colors"
        >
          <FlaskConical size={22} />
          Start Calibration
        </Link>

        {/* Asset details card */}
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5">
          <h2 className="pt-5 pb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Asset Details
          </h2>

          <DetailRow icon={Tag} label="Tag ID" value={asset.tag_id} />
          <DetailRow icon={Hash} label="Serial Number" value={asset.serial_number} />
          <DetailRow icon={Factory} label="Manufacturer" value={asset.manufacturer} />
          <DetailRow icon={Box} label="Model" value={asset.model} />
          <DetailRow
            icon={Gauge}
            label="Instrument Type"
            value={INSTRUMENT_LABELS[asset.instrument_type] ?? asset.instrument_type}
          />
          <DetailRow icon={Gauge} label="Range" value={rangeStr} />
          <DetailRow
            icon={Calendar}
            label="Calibration Interval"
            value={`${asset.calibration_interval_days} days`}
          />
          <DetailRow icon={Clock} label="Last Calibrated" value={formatDate(lastCalibratedAt)} />
          <DetailRow icon={Calendar} label="Next Due" value={formatDate(nextDueAt)} />
          <DetailRow icon={MapPin} label="Location" value={asset.location} />
          <DetailRow icon={StickyNote} label="Notes" value={asset.notes} />
        </div>

        {/* Calibration History */}
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 pb-5">
          <h2 className="pt-5 pb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Calibration History
          </h2>
          {calibrations.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 py-12 text-center">
              <ClipboardList size={36} className="mb-3 text-gray-300" />
              <p className="text-base font-medium text-gray-500">No calibration records yet</p>
              <p className="mt-1 text-sm text-gray-400">Completed calibrations will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {calibrations.map((rec) => {
                const result = getResultFromStatus(rec.status)
                const techName = rec.technician_id ? (techNames[rec.technician_id] ?? null) : null

                return (
                  <Link
                    key={rec.id}
                    to={`/calibrations/${rec.id}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50 transition-colors shadow-sm"
                  >
                    {/* Left: date + tech */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">
                        {formatDateShort(rec.performed_at)}
                      </p>
                      {techName && (
                        <p className="mt-0.5 text-xs text-gray-500">{techName}</p>
                      )}
                      {rec.sales_number && (
                        <p className="text-xs text-gray-400">SO: {rec.sales_number}</p>
                      )}
                    </div>

                    {/* Right: result badge + cert link */}
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <ResultBadge result={result} />
                      {rec.certificate_url && (
                        <a
                          href={rec.certificate_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                        >
                          <ExternalLink size={12} />
                          View Cert
                        </a>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Drift Trend Chart */}
        <DriftChart calibrations={calibrations} measurements={driftMeasurements} tolerancePct={1} />

        {/* Standards Used */}
        {standards.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 pb-5">
            <div className="flex items-center gap-2 pt-5 pb-4">
              <ShieldCheck size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Standards Used
              </h2>
            </div>
            <div className="space-y-3">
              {standards.map((std) => {
                const dueStatus = getStatus(std.due_at ?? undefined)
                const dueClass =
                  dueStatus === 'overdue'
                    ? 'bg-red-100 text-red-600 border border-red-200'
                    : 'bg-green-100 text-green-700 border border-green-200'
                const dueLabel =
                  dueStatus === 'overdue' ? 'Overdue' : `Due ${formatDateShort(std.due_at ?? undefined)}`

                return (
                  <div
                    key={std.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/standards/${std.id}`}
                        className="text-sm font-semibold text-brand-600 hover:underline"
                      >
                        {std.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                        {std.serial_number && <span>S/N: {std.serial_number}</span>}
                        {std.manufacturer && <span>{std.manufacturer}</span>}
                      </div>
                    </div>
                    {std.due_at && (
                      <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${dueClass}`}>
                        {dueLabel}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>

      {deletingAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
            <div className="px-6 pt-6 pb-2">
              <h2 className="text-lg font-semibold text-gray-900">Delete Asset?</h2>
              <p className="mt-2 text-sm text-gray-600">
                This will permanently remove <span className="font-medium">{asset.tag_id}</span> and
                all of its calibration records. This action cannot be undone.
              </p>
              {deleteError && (
                <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {deleteError}
                </p>
              )}
            </div>
            <div className="flex gap-3 px-6 py-4">
              <button
                onClick={() => {
                  setDeletingAsset(false)
                  setDeleteError(null)
                }}
                disabled={deleteLoading}
                className="flex flex-1 items-center justify-center rounded-xl border border-gray-200 py-3 text-base font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleteLoading}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 py-3 text-base font-medium text-white disabled:opacity-50"
              >
                {deleteLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Trash2 size={18} />
                )}
                {deleteLoading ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
