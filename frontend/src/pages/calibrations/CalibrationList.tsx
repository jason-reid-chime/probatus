import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, Clock, ChevronRight, Search, X, Trash2, CheckSquare } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from '../../lib/db'
import { isOnline } from '../../lib/sync/connectivity'
import type { LocalCalibrationRecord, LocalMeasurement } from '../../lib/db'
import { useAuth } from '../../hooks/useAuth'
import { overallResult } from '../../utils/calibrationMath'
import { useCustomerFilter } from '../../hooks/useCustomerFilter'
import { supabase } from '../../lib/supabase'

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
  serialNumber: string | null
  assetCustomerId: string | null
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

function ResultIcon({ result }: { result: 'PASS' | 'FAIL' | 'INCOMPLETE' }) {
  if (result === 'PASS') return <CheckCircle size={18} className="text-green-600 shrink-0" />
  if (result === 'FAIL') return <XCircle size={18} className="text-red-600 shrink-0" />
  return <Clock size={18} className="text-gray-400 shrink-0" />
}

// ---------------------------------------------------------------------------
// Data hook
// ---------------------------------------------------------------------------
function useCalibrationList(tenantId: string) {
  return useQuery({
    queryKey: ['calibrations', 'list', tenantId],
    queryFn: async (): Promise<EnrichedRecord[]> => {
      let records: LocalCalibrationRecord[] = []

      if (isOnline()) {
        try {
          const { data, error } = await supabase
            .from('calibration_records')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('performed_at', { ascending: false })
          if (error) throw error
          const remote = (data ?? []) as LocalCalibrationRecord[]
          await db.calibration_records.bulkPut(remote)
          const allLocal = await db.calibration_records.where('tenant_id').equals(tenantId).toArray()
          const remoteIds = new Set(remote.map(r => r.id))
          const localOnly = allLocal.filter(r => !remoteIds.has(r.id))
          records = [...remote, ...localOnly].sort((a, b) => b.performed_at.localeCompare(a.performed_at))
        } catch {
          records = await db.calibration_records.where('tenant_id').equals(tenantId).reverse().sortBy('performed_at')
        }
      } else {
        records = await db.calibration_records.where('tenant_id').equals(tenantId).reverse().sortBy('performed_at')
      }

      const enriched: EnrichedRecord[] = await Promise.all(
        records.map(async (r) => {
          const asset = await db.assets.get(r.asset_id)
          const measurements = await db.measurements.where('record_id').equals(r.id).toArray()
          return {
            ...r,
            tagId: asset?.tag_id ?? r.asset_id,
            serialNumber: asset?.serial_number ?? null,
            assetCustomerId: asset?.customer_id ?? null,
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
  const queryClient = useQueryClient()
  const tenantId = profile?.tenant_id ?? ''
  const canApprove = profile?.role === 'supervisor' || profile?.role === 'admin'
  const canDelete = profile?.role === 'admin' || profile?.role === 'supervisor'

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const { selectedCustomerId } = useCustomerFilter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const { data: records = [], isLoading, isError } = useCalibrationList(tenantId)

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (selectedCustomerId && r.assetCustomerId !== selectedCustomerId) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.tagId.toLowerCase().includes(q) && !(r.serialNumber ?? '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [records, statusFilter, selectedCustomerId, search])

  const selectedRecords = useMemo(() => filtered.filter(r => selected.has(r.id)), [filtered, selected])
  const canBulkApprove = canApprove && selectedRecords.some(r => r.status === 'pending_approval')
  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.id))

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(r => r.id)))
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleBulkApprove() {
    const toApprove = selectedRecords.filter(r => r.status === 'pending_approval').map(r => r.id)
    if (toApprove.length === 0) return
    setBulkLoading(true)
    setBulkError(null)
    const { error } = await supabase
      .from('calibration_records')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .in('id', toApprove)
    if (error) {
      setBulkError(error.message)
    } else {
      await Promise.all(toApprove.map(id =>
        db.calibration_records.update(id, { status: 'approved', approved_at: new Date().toISOString() })
      ))
      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: ['calibrations'] })
    }
    setBulkLoading(false)
  }

  async function handleBulkDelete() {
    if (!window.confirm(`Delete ${selected.size} calibration record${selected.size !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkLoading(true)
    setBulkError(null)
    const ids = [...selected]
    // Cascade in schema handles measurements + standards_used automatically
    const { error } = await supabase.from('calibration_records').delete().in('id', ids)
    if (error) {
      setBulkError(error.message)
    } else {
      await db.calibration_records.bulkDelete(ids)
      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: ['calibrations'] })
    }
    setBulkLoading(false)
  }

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

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          placeholder="Search by tag ID or serial number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label="Clear search">
            <X size={15} />
          </button>
        )}
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

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-brand-700">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            {canBulkApprove && (
              <button
                onClick={handleBulkApprove}
                disabled={bulkLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-60"
              >
                <CheckSquare size={14} />
                Approve
              </button>
            )}
            {canDelete && (
              <button
                onClick={handleBulkDelete}
                disabled={bulkLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-60"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {bulkError && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">{bulkError}</div>
      )}

      {/* List */}
      {isLoading && (
        <div className="text-center text-gray-400 py-12 text-sm">Loading calibrations…</div>
      )}
      {isError && (
        <div className="text-center text-red-500 py-12 text-sm">Failed to load calibrations.</div>
      )}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="text-center text-gray-400 py-12 text-sm">No calibrations found.</div>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <>
          {/* Select all */}
          <div className="flex items-center gap-2 px-1">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
              aria-label="Select all"
            />
            <span className="text-xs text-gray-500">Select all ({filtered.length})</span>
          </div>

          <ul className="space-y-3">
            {filtered.map((record) => {
              const result = overallResult(record.measurements)
              const performedAt = new Date(record.performed_at).toLocaleDateString(undefined, {
                day: 'numeric', month: 'short', year: 'numeric',
              })
              const isChecked = selected.has(record.id)

              return (
                <li key={record.id} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleOne(record.id)}
                    className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500 shrink-0"
                    aria-label={`Select ${record.tagId}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    type="button"
                    onClick={() => navigate(`/calibrations/${record.id}`)}
                    className="flex-1 text-left bg-white rounded-xl border border-gray-200 hover:border-brand-500 hover:shadow-sm transition-all px-5 py-4 flex items-center gap-4"
                  >
                    <ResultIcon result={result} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900 text-base truncate">{record.tagId}</span>
                        <StatusBadge status={record.status} />
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm text-gray-500">
                        <span>{performedAt}</span>
                        {record.sales_number && <span>SO: {record.sales_number}</span>}
                      </div>
                    </div>
                    <span className={`text-sm font-semibold shrink-0 ${result === 'PASS' ? 'text-green-600' : result === 'FAIL' ? 'text-red-600' : 'text-gray-400'}`}>
                      {result === 'INCOMPLETE' ? '—' : result}
                    </span>
                    <ChevronRight size={18} className="text-gray-400 shrink-0" />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
