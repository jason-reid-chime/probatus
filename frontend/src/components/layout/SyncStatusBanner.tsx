import { useState } from 'react'
import { useOutboxCount } from '../../hooks/useOutboxCount'
import { retryFailed, flushOutbox, clearFailed, clearAllOutbox } from '../../lib/sync/outbox'

export default function SyncStatusBanner() {
  const { pending, failed, lastError, refresh } = useOutboxCount()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // Every action awaits its work and re-reads the outbox so the banner reflects
  // the result immediately instead of on the next 3-second poll.
  const run = (action: () => Promise<void>) => async () => {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      console.error('[sync banner]', err)
    } finally {
      setConfirming(false)
      await refresh().catch(console.error)
      setBusy(false)
    }
  }

  if (failed === 0 && pending === 0) return null

  const isFailed = failed > 0
  const count = isFailed ? failed : pending
  const message = `${count === 1 ? '1 change' : `${count} changes`} ${isFailed ? 'failed to sync' : 'pending sync'}`
  const discard = isFailed ? clearFailed : clearAllOutbox

  const buttonClass = 'text-xs font-semibold underline underline-offset-2 disabled:opacity-50'

  return (
    <div
      role={isFailed ? 'alert' : 'status'}
      aria-live={isFailed ? 'assertive' : 'polite'}
      className={
        isFailed
          ? 'bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between gap-2 text-sm text-red-800'
          : 'bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-2 text-sm text-amber-800'
      }
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={`inline-block w-2 h-2 shrink-0 rounded-full ${isFailed ? 'bg-red-500' : 'bg-amber-400 animate-pulse'}`} />
        <span className="truncate" title={lastError}>
          {busy ? 'Syncing…' : message}
          {isFailed && lastError && !busy && (
            <span className="ml-1 text-xs opacity-75">({lastError})</span>
          )}
        </span>
      </span>
      <div className="flex items-center gap-3 shrink-0">
        {confirming ? (
          <>
            <span className="text-xs">{`Discard ${count === 1 ? 'this change' : `${count} changes`}? This cannot be undone.`}</span>
            <button onClick={run(discard)} disabled={busy} className={buttonClass}>
              Yes, discard
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} className={buttonClass}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={run(isFailed ? retryFailed : flushOutbox)} disabled={busy} className={buttonClass}>
              {isFailed ? 'Retry' : 'Sync now'}
            </button>
            <button onClick={() => setConfirming(true)} disabled={busy} className={buttonClass}>
              {isFailed ? 'Discard' : 'Discard all'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
