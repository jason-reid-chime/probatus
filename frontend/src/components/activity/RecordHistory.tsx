import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { fetchActivity } from '../../lib/api/activity'
import ActivityItem from './ActivityItem'

/**
 * Collapsible change history for one record (and its child rows, e.g. a
 * calibration's measurements). Loads only when opened.
 */
export default function RecordHistory({ recordId, title = 'History' }: { recordId: string; title?: string }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['activity', 'record', recordId],
    queryFn: () => fetchActivity({ record_id: recordId, limit: 100 }),
    enabled: open && !!recordId,
  })

  return (
    <section className="rounded-2xl border border-gray-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-4 text-left font-semibold text-gray-900"
      >
        <History size={18} className="text-gray-400" aria-hidden />
        {title}
        {open ? <ChevronUp size={16} className="ml-auto" aria-hidden /> : <ChevronDown size={16} className="ml-auto" aria-hidden />}
      </button>
      {open && (
        <div className="border-t border-gray-100">
          {isLoading && (
            <p className="flex items-center gap-2 px-5 py-4 text-sm text-gray-500">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Loading history…
            </p>
          )}
          {error && <p className="px-5 py-4 text-sm text-red-600">Couldn’t load history: {(error as Error).message}</p>}
          {data && data.length === 0 && <p className="px-5 py-4 text-sm text-gray-500">No changes recorded yet.</p>}
          {data && data.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {data.map((e) => <ActivityItem key={e.id} entry={e} showSubject={e.record_id !== recordId} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
