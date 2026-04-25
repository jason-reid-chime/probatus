import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle, ClipboardCheck, RefreshCw, AlertCircle, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { db } from '../../lib/db'
import { useAuth } from '../../hooks/useAuth'
import { apiRequest } from '../../lib/api/client'

interface PendingRecord {
  id: string
  asset_id: string
  technician_id: string
  performed_at: string
  sales_number: string
  flag_number: string
  notes: string
  asset_tag_id: string
  asset_manufacturer: string | null
  asset_model: string | null
  asset_location: string | null
  technician_name: string | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function ApprovalDashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [records, setRecords] = useState<PendingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)   // record id being rejected
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState<string | null>(null)

  // Redirect technicians — done in effect to avoid calling navigate during render
  useEffect(() => {
    if (profile?.role === 'technician') {
      navigate('/', { replace: true })
    }
  }, [profile, navigate])

  const load = useCallback(async () => {
    if (!profile || profile.role === 'technician') return
    setLoading(true)
    setError(null)

    // Fetch pending records + asset details.
    // We avoid joining profiles here because calibration_records has two FKs
    // to profiles (technician_id and supervisor_id) which makes Supabase's
    // auto-join ambiguous. Technician names are resolved in a second pass.
    const { data, error: fetchError } = await supabase
      .from('calibration_records')
      .select(`
        id, asset_id, technician_id, performed_at,
        sales_number, flag_number, notes,
        assets ( tag_id, manufacturer, model, location )
      `)
      .eq('status', 'pending_approval')
      .order('performed_at', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const rows = data ?? []

    // Resolve unique technician IDs to names in one query
    const techIds = [...new Set(rows.map((r) => r.technician_id as string))]
    const techNames: Record<string, string> = {}
    if (techIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', techIds)
      for (const p of profiles ?? []) {
        techNames[p.id] = p.full_name ?? ''
      }
    }

    const mapped: PendingRecord[] = rows.map((r) => {
      const asset = r.assets as unknown as Record<string, string | null> | null
      return {
        id: r.id as string,
        asset_id: r.asset_id as string,
        technician_id: r.technician_id as string,
        performed_at: r.performed_at as string,
        sales_number: (r.sales_number as string) ?? '',
        flag_number: (r.flag_number as string) ?? '',
        notes: (r.notes as string) ?? '',
        asset_tag_id: asset?.tag_id ?? '—',
        asset_manufacturer: asset?.manufacturer ?? null,
        asset_model: asset?.model ?? null,
        asset_location: asset?.location ?? null,
        technician_name: techNames[r.technician_id as string] ?? null,
      }
    })

    setRecords(mapped)
    setLoading(false)
  }, [profile])

  useEffect(() => {
    load()
  }, [load])

  async function handleApprove(recordId: string) {
    setApproving(recordId)
    setError(null)
    try {
      await apiRequest('POST', `/calibrations/${recordId}/approve`)
      await db.calibration_records.update(recordId, { status: 'approved', approved_at: new Date().toISOString() })
      setRecords((prev) => prev.filter((r) => r.id !== recordId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setApproving(null)
    }
  }

  async function handleReject(recordId: string) {
    if (!rejectReason.trim()) {
      setRejectError('Rejection reason is required')
      return
    }
    setRejectError(null)
    try {
      await apiRequest('POST', `/calibrations/${recordId}/reject`, { rejection_reason: rejectReason.trim() })
      await db.calibration_records.update(recordId, { status: 'rejected', rejection_reason: rejectReason.trim() })
      setRecords((prev) => prev.filter((r) => r.id !== recordId))
      setRejecting(null)
      setRejectReason('')
    } catch (err) {
      setRejectError(err instanceof Error ? err.message : 'Rejection failed')
    }
  }

  // Don't render anything while technician redirect is in flight
  if (profile?.role === 'technician') return null

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pending Approvals</h1>
          <p className="text-sm text-gray-500 mt-1">
            Calibrations submitted by technicians awaiting your sign-off
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
          <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800">Failed to load approvals</p>
            <p className="text-xs text-red-600 mt-0.5">{error}</p>
          </div>
          <button
            onClick={load}
            className="text-xs font-semibold text-red-700 hover:text-red-900 underline underline-offset-2 flex-shrink-0"
          >
            Try again
          </button>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!loading && records.length === 0 && !error && (
        <div className="text-center py-16 text-gray-400">
          <CheckCircle size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium">All caught up</p>
          <p className="text-sm mt-1">No calibrations are waiting for approval</p>
        </div>
      )}

      {!loading && records.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
            <ClipboardCheck size={16} className="text-blue-600" />
            <span className="text-sm font-semibold text-blue-800">
              {records.length} {records.length === 1 ? 'calibration' : 'calibrations'} pending
            </span>
          </div>
          <ul className="divide-y divide-gray-100">
            {records.map((r) => {
              const makeModel = [r.asset_manufacturer, r.asset_model]
                .filter(Boolean)
                .join(' ') || null
              return (
                <li key={r.id} className="px-5 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/calibrations/${r.id}`}
                        className="font-semibold text-gray-900 hover:text-brand-600 truncate"
                      >
                        {r.asset_tag_id}
                      </Link>
                      {makeModel && (
                        <span className="text-sm text-gray-500">{makeModel}</span>
                      )}
                      {r.asset_location && (
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                          {r.asset_location}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-gray-500">
                      <span>Performed: {formatDate(r.performed_at)}</span>
                      {r.technician_name && <span>By: {r.technician_name}</span>}
                      {r.sales_number && <span>Sales #: {r.sales_number}</span>}
                      {r.flag_number && <span>Flag #: {r.flag_number}</span>}
                    </div>
                    {r.notes && (
                      <p className="mt-1 text-xs text-gray-400 truncate">{r.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Link
                      to={`/calibrations/${r.id}`}
                      className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Review
                    </Link>
                    <button
                      onClick={() => { setRejecting(r.id); setRejectReason(''); setRejectError(null) }}
                      disabled={approving === r.id}
                      className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      <XCircle size={14} className="inline mr-1" />
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprove(r.id)}
                      disabled={approving === r.id}
                      className="text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {approving === r.id ? 'Approving…' : 'Approve'}
                    </button>
                  </div>
                  {/* Inline reject reason panel */}
                  {rejecting === r.id && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl space-y-2">
                      <p className="text-xs font-semibold text-red-700">Rejection reason</p>
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        rows={2}
                        placeholder="Describe what needs to be corrected…"
                        className="w-full text-sm px-3 py-2 border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                        autoFocus
                      />
                      {rejectError && <p className="text-xs text-red-600">{rejectError}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => handleReject(r.id)} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
                          Confirm Reject
                        </button>
                        <button onClick={() => { setRejecting(null); setRejectReason('') }} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
