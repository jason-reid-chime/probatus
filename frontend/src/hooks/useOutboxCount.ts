import { useState, useEffect, useCallback } from 'react'
import { db } from '../lib/db'
import { supabase } from '../lib/supabase'
import { MAX_RETRIES, OUTBOX_FLUSHED_EVENT, isOrphan } from '../lib/sync/outbox'

export interface OutboxStatus {
  pending: number      // entries still being retried
  failed: number       // entries that hit the retry limit (or orphaned legacy entries)
  lastError?: string   // most recent failure message, shown in the banner
}

/**
 * Returns counts of the signed-in user's pending and permanently-failed outbox
 * entries. Other users' entries on this device are never counted.
 * Polls Dexie every 3 seconds, re-reads after every flush, and exposes
 * `refresh` so actions can update the banner immediately.
 */
export function useOutboxCount(): OutboxStatus & { refresh: () => Promise<void> } {
  const [status, setStatus] = useState<OutboxStatus>({ pending: 0, failed: 0 })

  const refresh = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    const all = await db.outbox.toArray()
    const mine = all.filter((e) => userId && e.user_id === userId)
    const failedEntries = [...mine.filter((e) => e.retries >= MAX_RETRIES), ...all.filter(isOrphan)]
    setStatus({
      pending:   mine.filter((e) => e.retries < MAX_RETRIES).length,
      failed:    failedEntries.length,
      lastError: failedEntries.find((e) => e.last_error)?.last_error
        ?? mine.find((e) => e.last_error)?.last_error,
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const safeRefresh = () => { if (!cancelled) refresh().catch(console.error) }

    safeRefresh()
    const interval = setInterval(safeRefresh, 3000)
    window.addEventListener(OUTBOX_FLUSHED_EVENT, safeRefresh)
    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener(OUTBOX_FLUSHED_EVENT, safeRefresh)
    }
  }, [refresh])

  return { ...status, refresh }
}
