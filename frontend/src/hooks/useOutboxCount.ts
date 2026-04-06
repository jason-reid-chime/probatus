import { useState, useEffect } from 'react'
import { db } from '../lib/db'

const MAX_RETRIES = 5

export interface OutboxStatus {
  pending: number   // entries still being retried
  failed: number    // entries that hit the retry limit
}

/**
 * Returns counts of pending and permanently-failed outbox entries.
 * Polls Dexie every 3 seconds and re-reads whenever the component mounts.
 */
export function useOutboxCount(): OutboxStatus {
  const [status, setStatus] = useState<OutboxStatus>({ pending: 0, failed: 0 })

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      const all = await db.outbox.toArray()
      if (!cancelled) {
        setStatus({
          pending: all.filter((e) => e.retries < MAX_RETRIES).length,
          failed:  all.filter((e) => e.retries >= MAX_RETRIES).length,
        })
      }
    }

    refresh()
    const interval = setInterval(refresh, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return status
}
