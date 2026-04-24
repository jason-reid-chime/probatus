import { useParams, useNavigate, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  ArrowLeft,
  Edit2,
  AlertCircle,
  Loader2,
  Shield,
  Tag,
  ClipboardList,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useStandards } from '../../hooks/useStandards'
import { supabase } from '../../lib/supabase'
import { isStandardExpired, isStandardDueSoon } from '../../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface LinkedAsset {
  id: string
  tag_id: string
  serial_number: string
  manufacturer: string | null
  model: string | null
  instrument_type: string
}

interface RecentCalibration {
  record_id: string
  calibration_records: {
    id: string
    performed_at: string
    status: string
    asset_id: string
    assets: {
      tag_id: string
    } | null
  } | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function DueDatePill({ dueAt }: { dueAt: string }) {
  const expired = dueAt < new Date().toISOString().slice(0, 10)
  if (expired) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-300">
        OVERDUE
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-300">
      <Shield size={11} /> Valid
    </span>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-3 border-b border-gray-100 last:border-0">
      <p className="w-40 flex-shrink-0 text-sm font-medium text-gray-500">{label}</p>
      <p className="text-sm text-gray-900">{value ?? <span className="text-gray-400 italic">Not set</span>}</p>
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  approved: 'bg-green-100 text-green-700',
  pending_approval: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  approved: 'Approved',
  pending_approval: 'Pending',
  in_progress: 'In Progress',
  rejected: 'Rejected',
}

// ---------------------------------------------------------------------------
// StandardDetail page
// ---------------------------------------------------------------------------
export default function StandardDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: standards = [], isLoading: standardsLoading } = useStandards()
  const standard = standards.find((s) => s.id === id) ?? null

  const [linkedAssets, setLinkedAssets] = useState<LinkedAsset[]>([])
  const [recentCals, setRecentCals] = useState<RecentCalibration[]>([])
  const [loadingRelated, setLoadingRelated] = useState(true)

  useEffect(() => {
    if (!id || !profile?.tenant_id) return

    const assetsQuery = supabase
      .from('calibration_standards_used')
      .select('calibration_records(asset_id, assets(id, tag_id, serial_number, manufacturer, model, instrument_type))')
      .eq('standard_id', id)

    const calsQuery = supabase
      .from('calibration_standards_used')
      .select('record_id, calibration_records(id, performed_at, status, asset_id, assets(tag_id))')
      .eq('standard_id', id)
      .order('record_id', { ascending: false })
      .limit(10)

    Promise.all([assetsQuery, calsQuery]).then(([assetsRes, calsRes]) => {
      // Deduplicate assets by id
      const seen = new Set<string>()
      const assets: LinkedAsset[] = []
      if (assetsRes.data) {
        for (const row of assetsRes.data) {
          const rec = row.calibration_records as unknown as {
            asset_id: string
            assets: LinkedAsset | null
          } | null
          const asset = rec?.assets
          if (asset && !seen.has(asset.id)) {
            seen.add(asset.id)
            assets.push(asset)
          }
        }
      }
      setLinkedAssets(assets)

      if (calsRes.data) {
        setRecentCals(calsRes.data as unknown as RecentCalibration[])
      }

      setLoadingRelated(false)
    })
  }, [id, profile?.tenant_id])

  // Loading state — wait for standards list to populate
  if (standardsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 size={32} className="animate-spin text-brand-500" />
      </div>
    )
  }

  if (!standard) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <AlertCircle size={48} className="text-red-400" />
        <h2 className="text-xl font-semibold text-gray-700">Standard not found</h2>
        <p className="text-gray-500">This standard may have been deleted or you don't have access.</p>
        <button
          onClick={() => navigate('/standards')}
          className="mt-2 flex h-11 items-center gap-2 rounded-xl bg-brand-500 px-6 text-base font-medium text-white hover:bg-brand-700"
        >
          Back to Standards
        </button>
      </div>
    )
  }

  const isExpired = isStandardExpired(standard)
  const isDueSoon = isStandardDueSoon(standard, 30)
  const canEdit = profile?.role === 'supervisor' || profile?.role === 'admin'

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
            <h1 className="truncate text-xl font-bold text-gray-900">{standard.name}</h1>
            <p className="text-sm text-gray-500">Master Standard</p>
          </div>
          {canEdit && (
            <Link
              to={`/standards/${standard.id}/edit`}
              className="flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100"
            >
              <Edit2 size={18} />
              <span className="hidden sm:inline">Edit</span>
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-6">
        {/* Status banner */}
        <div
          className={`flex items-center justify-between rounded-2xl border px-5 py-4 ${
            isExpired
              ? 'bg-red-50 border-red-200 text-red-700'
              : isDueSoon
              ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-green-50 border-green-200 text-green-700'
          }`}
        >
          <div>
            <p className="text-sm font-medium opacity-80">Calibration Status</p>
            <p className="mt-0.5 text-lg font-semibold">
              {isExpired ? 'Overdue' : isDueSoon ? 'Due Within 30 Days' : 'Valid'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm opacity-70">Due</p>
            <p className="text-base font-semibold">{standard.due_at}</p>
          </div>
        </div>

        {/* Standard info card */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm px-5">
          <h2 className="pt-5 pb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Standard Details
          </h2>
          <DetailRow label="Name" value={standard.name} />
          <DetailRow label="Serial Number" value={<span className="font-mono">{standard.serial_number}</span>} />
          {standard.manufacturer && <DetailRow label="Manufacturer" value={standard.manufacturer} />}
          {standard.model && <DetailRow label="Model" value={standard.model} />}
          <DetailRow
            label="Certificate Ref"
            value={standard.certificate_ref ?? <span className="text-gray-400 italic">Not set</span>}
          />
          <DetailRow
            label="Calibrated"
            value={formatDate(standard.calibrated_at)}
          />
          <DetailRow
            label="Due"
            value={
              <span className="inline-flex items-center gap-2">
                {standard.due_at}
                <DueDatePill dueAt={standard.due_at} />
              </span>
            }
          />
          {standard.notes && <DetailRow label="Notes" value={standard.notes} />}
        </div>

        {/* Assets calibrated with this standard */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm px-5 pb-5">
          <h2 className="pt-5 pb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Assets Calibrated With This Standard
          </h2>
          {loadingRelated ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : linkedAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 py-10 text-center">
              <Tag size={32} className="mb-3 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">No assets linked yet</p>
              <p className="mt-1 text-xs text-gray-400">Assets will appear here once this standard is used in a calibration.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {linkedAssets.map((asset) => (
                <Link
                  key={asset.id}
                  to={`/assets/${asset.id}`}
                  className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-5 px-5 transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{asset.tag_id}</p>
                    <p className="text-xs text-gray-500">
                      {[asset.manufacturer, asset.model].filter((v): v is string => !!v).join(' · ') || asset.instrument_type}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-gray-400">{asset.serial_number}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent calibrations */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm px-5 pb-5">
          <h2 className="pt-5 pb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Recent Calibrations
          </h2>
          {loadingRelated ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          ) : recentCals.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 py-10 text-center">
              <ClipboardList size={32} className="mb-3 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">No calibration records yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentCals.map((row) => {
                const rec = row.calibration_records
                if (!rec) return null
                return (
                  <Link
                    key={row.record_id}
                    to={`/calibrations/${rec.id}`}
                    className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-5 px-5 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {new Date(rec.performed_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      {rec.assets?.tag_id && (
                        <p className="text-xs text-gray-500">{rec.assets.tag_id}</p>
                      )}
                    </div>
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[rec.status] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {STATUS_LABELS[rec.status] ?? rec.status}
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
