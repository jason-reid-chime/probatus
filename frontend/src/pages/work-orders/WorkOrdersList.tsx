import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Briefcase, Plus, Search, X } from 'lucide-react'
import { useWorkOrders, type WorkOrder } from '../../hooks/useWorkOrders'
import { useAuth } from '../../hooks/useAuth'

type StatusFilter = 'all' | 'open' | 'in_progress' | 'completed' | 'cancelled'

const STATUS_PILLS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700 border border-blue-200',
  in_progress: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  completed: 'bg-green-100 text-green-700 border border-green-200',
  cancelled: 'bg-gray-100 text-gray-500 border border-gray-200',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-gray-100 bg-white px-4 py-4 shadow-sm animate-pulse">
      <div className="flex-1 space-y-2">
        <div className="h-4 w-48 rounded bg-gray-200" />
        <div className="h-3 w-32 rounded bg-gray-100" />
      </div>
      <div className="h-6 w-20 rounded-full bg-gray-200" />
      <div className="h-4 w-16 rounded bg-gray-100" />
    </div>
  )
}

function WorkOrderRow({ wo }: { wo: WorkOrder }) {
  const navigate = useNavigate()
  const assetCount = wo.work_order_assets?.[0]?.count ?? 0
  const techCount = wo.work_order_technicians?.[0]?.count ?? 0

  return (
    <button
      className="flex w-full items-center gap-4 rounded-xl border border-gray-100 bg-white px-4 py-4 shadow-sm transition-colors hover:bg-gray-50 active:bg-gray-100 text-left"
      onClick={() => navigate(`/work-orders/${wo.id}`)}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium text-gray-900">{wo.title}</p>
        <p className="mt-0.5 text-sm text-gray-500">
          {wo.scheduled_date
            ? new Date(wo.scheduled_date + 'T00:00:00').toLocaleDateString()
            : '—'}
          {wo.customer?.name ? ` · ${wo.customer.name}` : ''}
        </p>
      </div>
      <span
        className={`inline-flex items-center rounded-full px-3 py-0.5 text-sm font-medium ${STATUS_BADGE[wo.status] ?? STATUS_BADGE.open}`}
      >
        {STATUS_LABEL[wo.status] ?? wo.status}
      </span>
      <span className="hidden sm:flex flex-shrink-0 items-center gap-3 text-sm text-gray-500">
        <span>{assetCount} asset{assetCount !== 1 ? 's' : ''}</span>
        {techCount > 0 && (
          <span className="inline-flex items-center gap-1 text-indigo-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {techCount}
          </span>
        )}
      </span>
    </button>
  )
}

export default function WorkOrdersList() {
  const { profile } = useAuth()
  const { data: workOrders, isLoading } = useWorkOrders()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const isTechnician = profile?.role === 'technician'
  const canCreate = profile?.role === 'supervisor' || profile?.role === 'admin'

  const filtered = (workOrders ?? []).filter((wo) => {
    if (statusFilter !== 'all' && wo.status !== statusFilter) return false
    if (search && !wo.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Work Orders</h1>
          {canCreate && (
            <Link
              to="/work-orders/new"
              className="flex h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 text-base font-medium text-white shadow-sm hover:bg-brand-700 active:opacity-80"
            >
              <Plus size={20} />
              <span className="hidden sm:inline">New Work Order</span>
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {isTechnician && (
          <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
            Showing work orders assigned to you. Contact a supervisor to be added to others.
          </div>
        )}

        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="search"
            placeholder="Search by title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {STATUS_PILLS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={[
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                statusFilter === value
                  ? 'bg-brand-500 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((wo) => (
              <WorkOrderRow key={wo.id} wo={wo} />
            ))}
          </div>
        )}

        {!isLoading && workOrders !== undefined && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
            <Briefcase size={48} className="mb-4 text-gray-300" />
            <h2 className="mb-1 text-xl font-semibold text-gray-700">
              {statusFilter !== 'all' || search ? 'No work orders match your filters' : 'No work orders yet'}
            </h2>
            <p className="mb-6 text-base text-gray-500">
              {statusFilter !== 'all' || search
                ? 'Try adjusting your search or status filter.'
                : 'Create your first work order to get started.'}
            </p>
            {canCreate && statusFilter === 'all' && !search && (
              <Link
                to="/work-orders/new"
                className="flex h-11 items-center gap-2 rounded-xl bg-brand-500 px-6 text-base font-medium text-white hover:bg-brand-700 active:opacity-80"
              >
                <Plus size={20} />
                New Work Order
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
