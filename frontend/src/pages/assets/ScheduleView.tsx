import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Loader2, CheckSquare, Square } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { apiRequest } from '../../lib/api/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ScheduledAsset {
  id: string
  tag_id: string
  instrument_type: string
  serial_number: string | null
  manufacturer: string | null
  model: string | null
  next_due_at: string
  customer_name: string | null
}

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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function dueDateColor(nextDueAt: string): string {
  const now = Date.now()
  const due = new Date(nextDueAt).getTime()
  const diffDays = (due - now) / (1000 * 60 * 60 * 24)
  if (diffDays < 0) return 'text-red-600 font-semibold'
  if (diffDays <= 7) return 'text-amber-500 font-semibold'
  return 'text-gray-500'
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-gray-100 bg-white px-4 py-4 shadow-sm animate-pulse">
      <div className="h-5 w-5 rounded bg-gray-200 flex-shrink-0" />
      <div className="h-5 w-24 rounded bg-gray-200 flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-40 rounded bg-gray-200" />
        <div className="h-3 w-28 rounded bg-gray-100" />
      </div>
      <div className="h-6 w-20 rounded-full bg-gray-200" />
      <div className="h-4 w-24 rounded bg-gray-100" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create Work Order Modal
// ---------------------------------------------------------------------------
interface ModalProps {
  selectedCount: number
  selectedIds: string[]
  tenantId: string
  userId: string
  onClose: () => void
  onSuccess: (workOrderId: string) => void
}

function CreateWorkOrderModal({
  selectedCount,
  selectedIds,
  tenantId,
  userId,
  onClose,
  onSuccess,
}: ModalProps) {
  const today = todayISO()
  const [title, setTitle] = useState(`Calibration Run — ${today}`)
  const [scheduledDate, setScheduledDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)

    try {
      // Create work order
      const { data: wo, error: woErr } = await supabase
        .from('work_orders')
        .insert({
          tenant_id: tenantId,
          title: title.trim(),
          scheduled_date: scheduledDate,
          notes: notes.trim() || null,
          status: 'open',
          created_by: userId,
        })
        .select('id')
        .single()

      if (woErr || !wo) {
        throw new Error(woErr?.message ?? 'Failed to create work order')
      }

      // Link assets
      const { error: linkErr } = await supabase
        .from('work_order_assets')
        .insert(selectedIds.map((asset_id) => ({ work_order_id: wo.id, asset_id })))

      if (linkErr) {
        throw new Error(linkErr.message ?? 'Failed to link assets')
      }

      onSuccess(wo.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Create Work Order</h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            aria-label="Close"
          >
            <span className="text-xl leading-none">&times;</span>
          </button>
        </div>

        {/* Modal body */}
        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
          <p className="text-sm text-gray-500">
            Creating a work order for{' '}
            <span className="font-semibold text-gray-700">{selectedCount}</span>{' '}
            {selectedCount === 1 ? 'asset' : 'assets'}.
          </p>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Work Order Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-base"
              placeholder="Calibration Run — 2026-04-25"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Scheduled Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-base"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-base resize-none"
              placeholder="Optional notes…"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 rounded-lg bg-red-50 px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 border border-gray-300 text-gray-700 font-semibold py-2.5 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="flex-1 bg-brand-500 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition-colors inline-flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Asset row
// ---------------------------------------------------------------------------
function ScheduledAssetRow({
  asset,
  selected,
  onToggle,
}: {
  asset: ScheduledAsset
  selected: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={[
        'flex items-center gap-4 rounded-xl border bg-white px-4 py-4 shadow-sm transition-colors cursor-pointer select-none',
        selected ? 'border-brand-300 bg-brand-50' : 'border-gray-100 hover:bg-gray-50',
      ].join(' ')}
      onClick={onToggle}
      role="checkbox"
      aria-checked={selected}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle() } }}
    >
      {/* Checkbox */}
      <span className={['flex-shrink-0 text-brand-500', selected ? '' : 'text-gray-300'].join(' ')}>
        {selected ? <CheckSquare size={20} /> : <Square size={20} />}
      </span>

      {/* Tag ID + type */}
      <div className="min-w-0 w-28 flex-shrink-0">
        <span className="font-mono text-sm font-bold text-gray-900 truncate block">
          {asset.tag_id}
        </span>
        <span className="mt-0.5 text-xs text-gray-500 block">
          {INSTRUMENT_LABELS[asset.instrument_type] ?? asset.instrument_type}
        </span>
      </div>

      {/* Manufacturer / model + customer */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium text-gray-800">
          {[asset.manufacturer, asset.model].filter(Boolean).join(' ') || (
            <span className="italic text-gray-400">No make/model</span>
          )}
        </p>
        {asset.customer_name && (
          <p className="truncate text-sm text-gray-500">{asset.customer_name}</p>
        )}
      </div>

      {/* Due date */}
      <div className="flex-shrink-0 text-right">
        <span className={['text-sm', dueDateColor(asset.next_due_at)].join(' ')}>
          {new Date(asset.next_due_at).toLocaleDateString()}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Day filter pills
// ---------------------------------------------------------------------------
const DAY_OPTIONS: { label: string; value: number }[] = [
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
  { label: '60d', value: 60 },
  { label: '90d', value: 90 },
]

// ---------------------------------------------------------------------------
// ScheduleView page
// ---------------------------------------------------------------------------
export default function ScheduleView() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [days, setDays] = useState(30)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [modalOpen, setModalOpen] = useState(false)

  const { data: assets, isLoading } = useQuery<ScheduledAsset[]>({
    queryKey: ['assets-schedule', days],
    queryFn: () => apiRequest<ScheduledAsset[]>('GET', `/assets/schedule?days=${days}`),
    enabled: !!profile,
  })

  function toggleAll() {
    if (!assets || assets.length === 0) return
    if (selectedIds.size === assets.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(assets.map((a) => a.id)))
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleDaysChange(d: number) {
    setDays(d)
    setSelectedIds(new Set())
  }

  const allSelected = !!assets && assets.length > 0 && selectedIds.size === assets.length
  const someSelected = selectedIds.size > 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Upcoming Schedule</h1>

          {/* Days filter pills */}
          <div className="flex items-center gap-2">
            {DAY_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => handleDaysChange(value)}
                className={[
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  days === value
                    ? 'bg-brand-500 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 pb-32">
        {/* Loading skeletons */}
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        )}

        {/* Asset list */}
        {!isLoading && assets && assets.length > 0 && (
          <>
            {/* Select all row */}
            <div
              className="flex items-center gap-3 mb-3 px-4 py-2 cursor-pointer select-none"
              onClick={toggleAll}
              role="checkbox"
              aria-checked={allSelected}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleAll() } }}
            >
              <span className={allSelected ? 'text-brand-500' : 'text-gray-300'}>
                {allSelected ? <CheckSquare size={18} /> : <Square size={18} />}
              </span>
              <span className="text-sm font-medium text-gray-600">
                Select All ({assets.length})
              </span>
            </div>

            <div className="space-y-3">
              {assets.map((asset) => (
                <ScheduledAssetRow
                  key={asset.id}
                  asset={asset}
                  selected={selectedIds.has(asset.id)}
                  onToggle={() => toggleOne(asset.id)}
                />
              ))}
            </div>
          </>
        )}

        {/* Empty state */}
        {!isLoading && assets !== undefined && assets.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
            <CalendarClock size={48} className="mb-4 text-gray-300" />
            <h2 className="mb-1 text-xl font-semibold text-gray-700">All caught up!</h2>
            <p className="text-base text-gray-500">
              No assets due within the next {days} days — you're all caught up!
            </p>
          </div>
        )}
      </main>

      {/* Sticky action bar */}
      {someSelected && (
        <div className="fixed bottom-0 inset-x-0 z-20 border-t border-gray-200 bg-white px-4 py-4 shadow-lg sm:px-6">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <span className="text-sm font-medium text-gray-700">
              {selectedIds.size} {selectedIds.size === 1 ? 'asset' : 'assets'} selected
            </span>
            <button
              onClick={() => setModalOpen(true)}
              className="flex h-11 items-center gap-2 rounded-xl bg-brand-500 px-5 text-base font-semibold text-white shadow-sm hover:bg-brand-700 active:opacity-80 transition-colors"
            >
              Create Work Order
            </button>
          </div>
        </div>
      )}

      {/* Create Work Order modal */}
      {modalOpen && profile && (
        <CreateWorkOrderModal
          selectedCount={selectedIds.size}
          selectedIds={Array.from(selectedIds)}
          tenantId={profile.tenant_id}
          userId={profile.id}
          onClose={() => setModalOpen(false)}
          onSuccess={(woId) => navigate(`/work-orders/${woId}`)}
        />
      )}
    </div>
  )
}
