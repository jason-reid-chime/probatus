import { useState } from 'react'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { ShieldCheck, ShieldAlert, Loader2, ScrollText } from 'lucide-react'
import { fetchActivity, verifyActivity, TABLE_LABELS, type ActivityFilters } from '../../lib/api/activity'
import ActivityItem from '../../components/activity/ActivityItem'

const PAGE = 50
const inputClass = 'rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm'

export default function ActivityLog() {
  const [filters, setFilters] = useState<ActivityFilters>({})
  const set = (k: keyof ActivityFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value || undefined }))

  const query = useInfiniteQuery({
    queryKey: ['activity', 'log', filters],
    queryFn: ({ pageParam }) => fetchActivity({ ...filters, limit: PAGE, before_id: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  })
  const verify = useMutation({ mutationFn: verifyActivity })
  const entries = query.data?.pages.flat() ?? []

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Activity log</h1>
          <p className="text-sm text-gray-500 mt-1">
            Every change to assets, calibrations, standards, customers, work orders and invoices — who, what and when.
            Entries can’t be edited or deleted.
          </p>
        </div>
        <button
          type="button"
          onClick={() => verify.mutate()}
          disabled={verify.isPending}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {verify.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ShieldCheck size={16} aria-hidden />}
          Verify integrity
        </button>
      </div>

      {verify.data && (
        verify.data.ok ? (
          <p role="status" className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <ShieldCheck size={16} aria-hidden /> Intact — all {verify.data.checked} entries match their hash chain.
          </p>
        ) : (
          <p role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <ShieldAlert size={16} aria-hidden /> Tampering detected: entry #{verify.data.first_broken_id} doesn’t match the chain
            (checked {verify.data.checked}). Entries from that point on can’t be trusted.
          </p>
        )
      )}
      {verify.error && <p role="alert" className="text-sm text-red-600">Verification failed: {(verify.error as Error).message}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-gray-600">Type
          <select className={`${inputClass} mt-1 block`} value={filters.table ?? ''} onChange={set('table')}>
            <option value="">All</option>
            {Object.entries(TABLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">Action
          <select className={`${inputClass} mt-1 block`} value={filters.action ?? ''} onChange={set('action')}>
            <option value="">All</option>
            <option value="INSERT">Created</option>
            <option value="UPDATE">Changed</option>
            <option value="DELETE">Deleted</option>
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">From
          <input type="date" className={`${inputClass} mt-1 block`} value={filters.from ?? ''} onChange={set('from')} />
        </label>
        <label className="text-xs font-medium text-gray-600">To
          <input type="date" className={`${inputClass} mt-1 block`} value={filters.to ?? ''} onChange={set('to')} />
        </label>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : query.error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{(query.error as Error).message}</div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <ScrollText size={48} className="mb-4 text-gray-300" aria-hidden />
          <p className="text-gray-500">No activity matches these filters.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white">
          <ul className="divide-y divide-gray-100">{entries.map((e) => <ActivityItem key={e.id} entry={e} />)}</ul>
          {query.hasNextPage && (
            <div className="border-t border-gray-100 p-3 text-center">
              <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                {query.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
