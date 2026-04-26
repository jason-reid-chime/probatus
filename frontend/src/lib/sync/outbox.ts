import { db, type OutboxEntry } from '../db'
import { supabase } from '../supabase'

const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '') || 'http://localhost:8080'

const MAX_RETRIES = 5

/**
 * Flush the outbox — called when connectivity is detected.
 * Processes entries in insertion order (FIFO).
 *
 * Gets a Supabase session JWT and forwards it as Authorization: Bearer <token>
 * to the Go backend API. Aborts the flush on auth errors to avoid burning retries.
 */
export async function flushOutbox(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    console.warn('[outbox] aborted — no session')
    return
  }
  const token = session.access_token

  const entries = await db.outbox.orderBy('id').toArray()
  if (entries.length === 0) return

  for (const entry of entries) {
    if (entry.retries >= MAX_RETRIES) {
      console.warn(`[outbox] skipping dead entry id=${entry.id}`)
      continue
    }
    try {
      await processEntry(entry, token)
      await db.outbox.delete(entry.id!)
    } catch (err) {
      const msg = String(err)
      const isAuthError = msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized') || msg.includes('Forbidden')
      if (isAuthError) {
        console.warn('[outbox] auth error — aborting flush')
        return  // abort entire flush, don't burn retries
      }
      await db.outbox.update(entry.id!, { retries: entry.retries + 1, last_error: msg })
    }
  }
}

async function doFetch(url: string, method: string, token: string, body: Record<string, unknown> | null | undefined): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
}

async function processEntry(entry: OutboxEntry, token: string): Promise<void> {
  let res = await doFetch(`${API_URL}${entry.url}`, entry.method, token, entry.body)

  // Recovery: a PUT to /calibrations/{id} that returns 404 means the record was
  // never created in the backend (e.g. saved offline before this bug was fixed).
  // Retry as POST to /calibrations — the backend now accepts the client UUID in
  // the body and will create the record with that ID, keeping Dexie in sync.
  if (!res.ok && res.status === 404 && entry.method === 'PUT' && /^\/calibrations\/[^/]+$/.test(entry.url) && entry.body?.asset_id) {
    console.info(`[outbox] PUT 404 — retrying as POST for ${entry.url}`)
    res = await doFetch(`${API_URL}/calibrations`, 'POST', token, entry.body)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }
}

/**
 * Queue a mutation for later sync (offline-first write path).
 */
export async function enqueue(
  entry: Omit<OutboxEntry, 'id' | 'retries' | 'created_at'>
): Promise<void> {
  await db.outbox.add({ ...entry, created_at: new Date().toISOString(), retries: 0 })
}

/**
 * @deprecated Standards are now included as part of the calibration create/update
 * payload sent to the backend. This function is a no-op kept for backwards
 * compatibility with callers that have not yet been migrated.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function enqueueStandardsReplace(_recordId: string, _standardIds: string[]): Promise<void> {
  // No-op: the backend handles standards as part of calibration create/update body.
  // Callers should pass standard_ids in the calibration enqueue body instead.
}

/**
 * Reset retry counter on all dead entries so they can be flushed again.
 * Called when the user explicitly triggers a manual retry.
 */
export async function retryFailed(): Promise<void> {
  const dead = await db.outbox
    .filter((e) => e.retries >= MAX_RETRIES)
    .toArray()
  await Promise.all(
    dead.map((e) =>
      db.outbox.update(e.id!, { retries: 0, last_error: undefined })
    )
  )
}

/**
 * Permanently delete all failed outbox entries (retries >= MAX_RETRIES).
 * Used when entries are unrecoverable (e.g. parent record was deleted server-side).
 */
export async function clearFailed(): Promise<void> {
  const dead = await db.outbox
    .filter((e) => e.retries >= MAX_RETRIES)
    .toArray()
  await db.outbox.bulkDelete(dead.map((e) => e.id!))
}

/**
 * Permanently delete ALL outbox entries regardless of status.
 * Nuclear option — user loses any unsynced changes.
 */
export async function clearAllOutbox(): Promise<void> {
  await db.outbox.clear()
}
