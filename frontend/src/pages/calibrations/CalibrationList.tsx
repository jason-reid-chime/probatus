import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, Clock, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { db } from '../../lib/db'
import { isOnline } from '../../lib/sync/connectivity'
import type { LocalCalibrationRecord, LocalMeasurement } from '../../lib/db'
import { useAuth } from '../../hooks/useAuth'
import { overallResult } from '../../utils/calibrationMath'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type StatusFilter =
  | 'all'
  | 'in_progress'
  | 'pending_approval'
  | 'approved'
  | 'rejected'

interface EnrichedRecord extends LocalCalibrationRecord {
  tagId: string
  measurements: LocalMeasurement[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In Progress',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
}

const STATUS_STYLES: Record<string, string> = {
  in_progress: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  pending_approval: 'bg-blue-100 text-blue-700 border-blue-300',
  approved: 'bg-green-100 text-green-700 border-green-300',
  rejected: 'bg-red-100 text-red-700 border-red-300',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600 border-gray-300'}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

function ResultIcon({
  result,
}: {
  result: 'PASS' | 'FAIL' | 'INCOMPLETE'
}) {
  if (result === 'PASS')
    return <CheckCircle size={18} className="text-green-600 shrink-0" />
  if (result === 'FAIL')
    return <XCircle size={18} className="text-red-600 shrink-0" />
  return <Clock size={18} className="text-gray-400 shrink-0" />
}

// ---------------------------------------------------------------------------
// Data hook — loads all records for tenant from Dexie (offline-first)
// then enriches with asset tag and measurements
// ---------------------------------------------------------------------------
function useCalibrationList(tenantId: string) {
  return useQuery({
    queryKey: ['calibrations', 'list', tenantId],
    queryFn: async (): Promise<EnrichedRecord[]> => {
      // Load all records for this tenant
      let records: LocalCalibrationRecord[] = []

      if (isOnline()) {
        try {
          const { supabase } = await import('../../lib/supabase')
          const { data, error } = await supabase
            .from('calibration_records')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('performed_at', { ascending: false })
          if (error) throw error
          const remote = (data ?? []) as LocalCalibrationRecord[]
          await db.calibration_records.bulkPut(remote)

          // Merge any local-only records not yet synced
          const allLocal = await db.calibration_records
            .where('tenant_id').equals(tenantId).toArray()
          const remoteIds = new Set(remote.map(r => r.id))
          const localOnly = allLocal.filter(r => !remoteIds.has(r.id))
          records = [...remote, ...localOnly]
            .sort((a, b) => b.performed_at.localeCompare(a.performed_at))
        } catch {
          records = await db.calibration_records
            .where('tenant_id').equals(tenantId).reverse().sortBy('performed_at')
        }
      } else {
        records = await db.calibration_records
          .where('tenant_id').equals(tenantId).reverse().sortBy('performed_at')
      }

      // Enrich: load asset tag_id and measurements from Dexie
      const enriched: EnrichedRecord[] = await Promise.all(
        records.map(async (r) => {
          const asset = await db.assets.get(r.asset_id)
          const measurements = await db.measurements
            .where('record_id')
            .equals(r.id)
            .toArray()
          return {
            ...r,
            tagId: asset?.tag_id ?? r.asset_id,
            measurements,
          }
        }),
      )

      return enriched
    },
    enabled: !!tenantId,
    staleTime: 0,
  })
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function CalibrationList() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const tenantId = profile?.tenant_id ?? ''

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const { data: records = [], isLoading, isError } = useCalibrationList(tenantId)

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return records
    return records.filter((r) => r.status === statusFilter)
  }, [records, statusFilter])

  const filterOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'pending_approval', label: 'Pending Approval' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Calibrations</h1>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setStatusFilter(opt.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              statusFilter === opt.value
                ? 'bg-brand-500 text-white border-brand-500'
                : 'bg-white text-gray-600 border-gray-300 hover:border-brand-500 hover:text-brand-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading && (
        <div className="text-center text-gray-400 py-12 text-sm">
          Loading calibrations…
        </div>
      )}

      {isError && (
        <div className="text-center text-red-500 py-12 text-sm">
          Failed to load calibrations.
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="text-center text-gray-400 py-12 text-sm">
          No calibrations found.
        </div>
      )}

      <ul className="space-y-3">
        {filtered.map((record) => {
          const result = overallResult(record.measurements)
          const performedAt = new Date(record.performed_at).toLocaleDateString(
            undefined,
            { day: 'numeric', month: 'short', year: 'numeric' },
          )

          return (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => navigate(`/calibrations/${record.id}`)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 hover:border-brand-500 hover:shadow-sm transition-all px-5 py-4 flex items-center gap-4"
              >
                {/* Result icon */}
                <ResultIcon result={result} />

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900 text-base truncate">
                      {record.tagId}
                    </span>
                    <StatusBadge status={record.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm text-gray-500">
                    <span>{performedAt}</span>
                    {record.sales_number && (
                      <span>SO: {record.sales_number}</span>
                    )}
                  </div>
                </div>

                {/* Result text */}
                <span
                  className={`text-sm font-semibold shrink-0 ${
                    result === 'PASS'
                      ? 'text-green-600'
                      : result === 'FAIL'
                        ? 'text-red-600'
                        : 'text-gray-400'
                  }`}
                >
                  {result === 'INCOMPLETE' ? '—' : result}
                </span>

                <ChevronRight size={18} className="text-gray-400 shrink-0" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
