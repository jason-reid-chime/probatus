import { useOutboxCount } from '../../hooks/useOutboxCount'

/**
 * Displays a subtle banner at the top of the page when there are pending
 * outbox entries (i.e. changes saved offline that haven't synced yet).
 * Disappears automatically once the outbox is empty.
 */
export default function SyncStatusBanner() {
  const count = useOutboxCount()

  if (count === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-sm text-amber-800"
    >
      <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      <span>
        {count === 1
          ? '1 change saved offline — will sync when connected'
          : `${count} changes saved offline — will sync when connected`}
      </span>
    </div>
  )
}
