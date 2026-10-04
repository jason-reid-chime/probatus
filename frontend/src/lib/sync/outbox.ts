import { db, type OutboxEntry } from '../db'
import { supabase } from '../supabase'

const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '') || 'http://localhost:8080'

export const MAX_RETRIES = 5

/** Fired on window after every flush so React Query caches can refresh. */
export const OUTBOX_FLUSHED_EVENT = 'probatus:outbox-flushed'

/** Thrown by processEntry when the request never reached the server. */
class NetworkError extends Error {}

// Single-flight guard: the connectivity monitor, auth listener, periodic timer,
// save hooks and "Sync now" can all trigger a flush at once. Running two flushes
// concurrently sends the same entry twice, so callers share the in-flight one.
let inFlight: Promise<void> | null = null

/**
 * Flush the outbox — called when connectivity is detected.
 * Processes the current user's entries in insertion order (FIFO).
 *
 * Gets a Supabase session JWT and forwards it as Authorization: Bearer <token>
 * to the Go backend API. Aborts the flush on auth or network errors to avoid
 * burning retries while the server is unreachable.
 */
export function flushOutbox(): Promise<void> {
  if (!inFlight) {
    inFlight = doFlush().finally(() => {
      inFlight = null
      window.dispatchEvent(new Event(OUTBOX_FLUSHED_EVENT))
    })
  }
  return inFlight
}

async function doFlush(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    console.warn('[outbox] aborted — no session')
    return
  }
  const token = session.access_token
  const userId = session.user?.id
  if (!userId) {
    console.warn('[outbox] aborted — session has no user')
    return
  }

  // Only replay entries queued by the signed-in user. Entries from another
  // account (or legacy entries with no owner) must never be sent with this
  // user's token — the backend would write them into this user's tenant.
  const entries = (await db.outbox.orderBy('id').toArray())
    .filter((e) => e.user_id === userId)
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
      if (err instanceof NetworkError) {
        console.warn('[outbox] network error — aborting flush')
        return  // server unreachable: don't burn retries on every entry
      }
      const msg = String(err)
      const isAuthError = /^Error: (401|403):/.test(msg)
      if (isAuthError) {
        console.warn('[outbox] auth error — aborting flush')
        return  // abort entire flush, don't burn retries
      }
      // A 4xx (other than timeout / rate limit) means the server understood and
      // refused the change — e.g. 409 record already submitted/approved, 422
      // expired standard. Retrying can't succeed, so fail it now and surface it.
      const status = Number(msg.match(/^Error: (\d{3}):/)?.[1])
      const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429
      await db.outbox.update(entry.id!, {
        retries: permanent ? MAX_RETRIES : entry.retries + 1,
        last_error: msg,
      })
    }
  }
}

async function doFetch(url: string, method: string, token: string, body: Record<string, unknown> | null | undefined): Promise<Response> {
  try {
    return await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new NetworkError(String(err))
  }
}

async function processEntry(entry: OutboxEntry, token: string): Promise<void> {
  let res = await doFetch(`${API_URL}${entry.url}`, entry.method, token, entry.body)

  // Recovery: a PUT to /calibrations/{id} or /assets/{id} that returns 404 means
  // the record was created offline and never reached the backend. Retry as a POST
  // to the collection — the backend accepts the client UUID in the body and
  // creates the row with that ID, keeping Dexie in sync.
  const createPath = entry.url.match(/^\/(calibrations|assets)\/[^/]+$/)?.[1]
  if (res.status === 404 && entry.method === 'PUT' && createPath && entry.body?.id) {
    console.info(`[outbox] PUT 404 — retrying as POST for ${entry.url}`)
    res = await doFetch(`${API_URL}/${createPath}`, 'POST', token, entry.body)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }
}

async function currentUserId(): Promise<string | undefined> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id
}

/**
 * Queue a mutation for later sync (offline-first write path).
 * The entry is stamped with the signed-in user so it is only ever replayed
 * under that user's session. Returns the new entry's id.
 */
export async function enqueue(
  entry: Omit<OutboxEntry, 'id' | 'retries' | 'created_at' | 'user_id'>
): Promise<number> {
  const user_id = await currentUserId()
  return (await db.outbox.add({ ...entry, user_id, created_at: new Date().toISOString(), retries: 0 })) as number
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

/** The signed-in user's outbox entries. */
export async function ownEntries(): Promise<OutboxEntry[]> {
  const userId = await currentUserId()
  if (!userId) return []
  return db.outbox.filter((e) => e.user_id === userId).toArray()
}

/**
 * Ids of records the signed-in user has unsynced changes for. Read paths use
 * this so a server refresh never overwrites a local edit that hasn't synced yet.
 */
export async function pendingRecordIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const e of await ownEntries()) {
    const bodyId = (e.body as Record<string, unknown> | undefined)?.id
    if (typeof bodyId === 'string') ids.add(bodyId)
    const urlId = e.url.match(/^\/(?:calibrations|assets)\/([^/]+)/)?.[1]
    if (urlId) ids.add(urlId)
  }
  return ids
}

/**
 * Reset retry counter on the current user's dead entries and flush again.
 * Called when the user explicitly triggers a manual retry.
 */
export async function retryFailed(): Promise<void> {
  const dead = (await ownEntries()).filter((e) => e.retries >= MAX_RETRIES)
  await Promise.all(
    dead.map((e) =>
      db.outbox.update(e.id!, { retries: 0, last_error: undefined })
    )
  )
  await flushOutbox()
}

/**
 * Entries with no owner were queued before outbox entries were user-stamped.
 * They can never be replayed safely, so they are surfaced as failed and can
 * only be discarded.
 */
export function isOrphan(e: OutboxEntry): boolean {
  return !e.user_id
}

/**
 * Permanently delete the current user's failed outbox entries (retries >= MAX_RETRIES)
 * plus any orphaned legacy entries.
 * Used when entries are unrecoverable (e.g. parent record was deleted server-side).
 */
export async function clearFailed(): Promise<void> {
  const dead = (await ownEntries()).filter((e) => e.retries >= MAX_RETRIES)
  const orphans = await db.outbox.filter(isOrphan).toArray()
  await db.outbox.bulkDelete([...dead, ...orphans].map((e) => e.id!))
}

/**
 * Permanently delete ALL of the current user's outbox entries regardless of status.
 * Nuclear option — user loses any unsynced changes.
 */
export async function clearAllOutbox(): Promise<void> {
  const mine = await ownEntries()
  const orphans = await db.outbox.filter(isOrphan).toArray()
  await db.outbox.bulkDelete([...mine, ...orphans].map((e) => e.id!))
}

/**
 * Called on sign-out. Drops every cached table so the next account on this
 * device never sees the previous account's data. Outbox entries are kept (they
 * are owner-stamped and only replay for their owner), except legacy entries
 * with no owner, which can never be attributed safely.
 */
export async function clearLocalDataOnSignOut(): Promise<void> {
  await db.transaction('rw', [db.assets, db.calibration_records, db.measurements, db.outbox], async () => {
    await db.assets.clear()
    await db.calibration_records.clear()
    await db.measurements.clear()
    await db.outbox.filter(isOrphan).delete()
  })
}
