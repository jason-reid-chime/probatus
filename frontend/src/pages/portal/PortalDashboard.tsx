import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

interface Asset {
  id: string
  tag_id: string
  manufacturer: string | null
  model: string | null
  location: string | null
  next_due_at: string | null
}

type DueStatus = 'overdue' | 'due-soon' | 'ok'

function getDueStatus(next_due_at: string | null): DueStatus {
  if (!next_due_at) return 'ok'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(next_due_at)
  if (due < today) return 'overdue'
  const ninetyDays = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
  if (due <= ninetyDays) return 'due-soon'
  return 'ok'
}

function StatusBadge({ status }: { status: DueStatus }) {
  const styles: Record<DueStatus, string> = {
    overdue: 'bg-red-100 text-red-700 border-red-200',
    'due-soon': 'bg-amber-100 text-amber-700 border-amber-200',
    ok: 'bg-green-100 text-green-700 border-green-200',
  }
  const labels: Record<DueStatus, string> = {
    overdue: 'Overdue',
    'due-soon': 'Due Soon',
    ok: 'Current',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function PortalDashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadAssets() {
      setLoading(true)
      setError(null)
      const { data, error: fetchError } = await supabase
        .from('assets')
        .select('id, tag_id, manufacturer, model, location, next_due_at')
        .order('tag_id', { ascending: true })

      if (fetchError) {
        setError('Failed to load instruments. Please try again.')
      } else {
        setAssets(data ?? [])
      }
      setLoading(false)
    }

    loadAssets()
  }, [])

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const totalCount = assets.length
  const overdueAssets = assets.filter((a) => getDueStatus(a.next_due_at) === 'overdue')
  const dueSoonAssets = assets.filter((a) => getDueStatus(a.next_due_at) === 'due-soon')
  const currentAssets = assets.filter((a) => getDueStatus(a.next_due_at) === 'ok')

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome, {profile?.full_name ?? 'Customer'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{today}</p>
      </div>

      {/* Summary cards */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-3/4 mb-3" />
              <div className="h-8 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {/* Total */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Instruments</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{totalCount}</p>
          </div>

          {/* Overdue */}
          <div className={`rounded-2xl border p-5 ${overdueAssets.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
            <p className={`text-xs font-medium uppercase tracking-wider ${overdueAssets.length > 0 ? 'text-red-600' : 'text-gray-500'}`}>
              Overdue
            </p>
            <p className={`mt-2 text-3xl font-bold ${overdueAssets.length > 0 ? 'text-red-700' : 'text-gray-900'}`}>
              {overdueAssets.length}
            </p>
          </div>

          {/* Due soon */}
          <div className={`rounded-2xl border p-5 ${dueSoonAssets.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
            <p className={`text-xs font-medium uppercase tracking-wider ${dueSoonAssets.length > 0 ? 'text-amber-600' : 'text-gray-500'}`}>
              Due Within 90 Days
            </p>
            <p className={`mt-2 text-3xl font-bold ${dueSoonAssets.length > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
              {dueSoonAssets.length}
            </p>
          </div>

          {/* All current */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">All Current</p>
            <p className="mt-2 text-3xl font-bold text-green-700">{currentAssets.length}</p>
          </div>
        </div>
      )}

      {/* Asset list */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Your Instruments</h2>
        </div>

        {loading && (
          <div className="p-8 text-center">
            <div className="inline-block w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="p-6 text-center text-sm text-red-600">{error}</div>
        )}

        {!loading && !error && assets.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-500">
            No instruments found for your account.
          </div>
        )}

        {!loading && !error && assets.length > 0 && (
          <>
            {/* Table header — hidden on small screens */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-4 px-5 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500 uppercase tracking-wider">
              <span>Tag ID</span>
              <span>Make / Model</span>
              <span>Location</span>
              <span>Next Due</span>
              <span>Status</span>
            </div>

            <ul className="divide-y divide-gray-100">
              {assets.map((asset) => {
                const status = getDueStatus(asset.next_due_at)
                const makeModel = [asset.manufacturer, asset.model].filter(Boolean).join(' ') || '—'
                return (
                  <li key={asset.id}>
                    <button
                      onClick={() => navigate(`/portal/assets/${asset.id}`)}
                      className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors focus:outline-none focus:bg-gray-50"
                    >
                      {/* Mobile layout */}
                      <div className="sm:hidden flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">{asset.tag_id}</p>
                          <p className="text-sm text-gray-500 truncate mt-0.5">{makeModel}</p>
                          {asset.location && (
                            <p className="text-sm text-gray-400 truncate">{asset.location}</p>
                          )}
                          <p className="text-sm text-gray-500 mt-1">Due: {formatDate(asset.next_due_at)}</p>
                        </div>
                        <StatusBadge status={status} />
                      </div>

                      {/* Desktop layout */}
                      <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-4 items-center">
                        <span className="font-medium text-gray-900 truncate">{asset.tag_id}</span>
                        <span className="text-gray-600 truncate">{makeModel}</span>
                        <span className="text-gray-500 truncate">{asset.location ?? '—'}</span>
                        <span className="text-gray-500">{formatDate(asset.next_due_at)}</span>
                        <StatusBadge status={status} />
                      </div>
                    </button>
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
