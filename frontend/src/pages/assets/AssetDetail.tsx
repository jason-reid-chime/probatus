import { useParams, useNavigate, Link } from 'react-router-dom'
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
} from 'lucide-react'
import { useAsset } from '../../hooks/useAssets'
import { useCalibrationsByAsset } from '../../hooks/useCalibration'

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
// AssetDetail page
// ---------------------------------------------------------------------------
export default function AssetDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: asset, isLoading, isError } = useAsset(id ?? '')
  const { data: calibrations = [] } = useCalibrationsByAsset(id ?? '')

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

  const status = getStatus(asset.next_due_at)
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
          <Link
            to={`/assets/${asset.id}/edit`}
            className="flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100"
          >
            <Edit2 size={18} />
            <span className="hidden sm:inline">Edit</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-6">
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
          <DetailRow icon={Clock} label="Last Calibrated" value={formatDate(asset.last_calibrated_at)} />
          <DetailRow icon={Calendar} label="Next Due" value={formatDate(asset.next_due_at)} />
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
            <div className="divide-y divide-gray-100">
              {calibrations.map((rec) => {
                const statusColors: Record<string, string> = {
                  approved: 'bg-green-100 text-green-700',
                  pending_approval: 'bg-blue-100 text-blue-700',
                  in_progress: 'bg-yellow-100 text-yellow-700',
                  rejected: 'bg-red-100 text-red-700',
                }
                const statusLabels: Record<string, string> = {
                  approved: 'Approved',
                  pending_approval: 'Pending',
                  in_progress: 'In Progress',
                  rejected: 'Rejected',
                }
                return (
                  <Link
                    key={rec.id}
                    to={`/calibrations/${rec.id}`}
                    className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-5 px-5 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {new Date(rec.performed_at).toLocaleDateString(undefined, {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </p>
                      {rec.sales_number && (
                        <p className="text-xs text-gray-400">SO: {rec.sales_number}</p>
                      )}
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[rec.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {statusLabels[rec.status] ?? rec.status}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
