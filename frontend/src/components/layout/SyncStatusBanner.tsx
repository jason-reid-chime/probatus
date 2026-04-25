import { useOutboxCount } from '../../hooks/useOutboxCount'
import { retryFailed, flushOutbox, clearFailed, clearAllOutbox } from '../../lib/sync/outbox'

export default function SyncStatusBanner() {
  const { pending, failed } = useOutboxCount()

  if (failed > 0) {
    const label = failed === 1 ? '1 change' : `${failed} changes`
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between gap-2 text-sm text-red-800"
      >
        <span className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          {label} failed to sync
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={retryFailed}
            className="text-xs font-semibold underline underline-offset-2 hover:text-red-900"
          >
            Retry
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Discard ${failed} failed change${failed !== 1 ? 's' : ''}? This cannot be undone.`)) {
                clearFailed()
              }
            }}
            className="text-xs font-semibold underline underline-offset-2 hover:text-red-900 text-red-600"
          >
            Discard
          </button>
        </div>
      </div>
    )
  }

  if (pending > 0) {
    const label = pending === 1 ? '1 change' : `${pending} changes`
    return (
      <div
        role="status"
        aria-live="polite"
        className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-2 text-sm text-amber-800"
      >
        <span className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          {label} pending sync
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => flushOutbox().catch(console.error)}
            className="text-xs font-semibold underline underline-offset-2 hover:text-amber-900"
          >
            Sync now
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Discard all ${pending} pending change${pending !== 1 ? 's' : ''}? This cannot be undone.`)) {
                clearAllOutbox()
              }
            }}
            className="text-xs font-semibold underline underline-offset-2 hover:text-amber-900 text-amber-600"
          >
            Discard all
          </button>
        </div>
      </div>
    )
  }

  return null
}
