import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle, ClipboardCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { db } from '../../lib/db'
import { useAuth } from '../../hooks/useAuth'
import { API_URL } from '../../lib/api/client'

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

  // Only supervisors and admins should see this page
  if (profile && profile.role === 'technician') {
    navigate('/', { replace: true })
    return null
  }

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('calibration_records')
      .select(`
        id, asset_id, technician_id, performed_at, sales_number, flag_number, notes,
        assets ( tag_id, manufacturer, model, location ),
        profiles ( full_name )
      `)
      .eq('status', 'pending_approval')
      .order('performed_at', { ascending: true })

    if (fetchError) {
      setError('Failed to load pending approvals.')
      setLoading(false)
      return
    }

    const mapped: PendingRecord[] = (data ?? []).map((r: Record<string, unknown>) => {
      const asset = r.assets as Record<string, string | null> | null
      const tech = r.profiles as { full_name: string | null } | null
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
        technician_name: tech?.full_name ?? null,
      }
    })

    setRecords(mapped)
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleApprove(recordId: string) {
    setApproving(recordId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/calibrations/${recordId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (!res.ok) throw new Error('Approval failed')
      await db.calibration_records.update(recordId, { status: 'approved' })
      setRecords((prev) => prev.filter((r) => r.id !== recordId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed')
    } finally {
      setApproving(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pending Approvals</h1>
        <p className="text-sm text-gray-500 mt-1">
          Calibrations submitted by technicians awaiting your sign-off
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
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
                      onClick={() => handleApprove(r.id)}
                      disabled={approving === r.id}
                      className="text-sm px-3 py-1.5 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {approving === r.id ? 'Approving…' : 'Approve'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
