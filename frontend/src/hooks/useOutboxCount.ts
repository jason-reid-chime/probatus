import { useState, useEffect } from 'react'
import { db } from '../lib/db'

/**
 * Returns the number of pending outbox entries.
 * Polls Dexie every 3 seconds and re-reads whenever the component mounts.
 */
export function useOutboxCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      const n = await db.outbox.count()
      if (!cancelled) setCount(n)
    }

    refresh()
    const interval = setInterval(refresh, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return count
}
