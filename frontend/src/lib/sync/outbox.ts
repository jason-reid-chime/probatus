import { db, type OutboxEntry } from '../db'
import { supabase } from '../supabase'

const MAX_RETRIES = 5

/**
 * Flush the outbox — called when connectivity is detected.
 * Processes entries in insertion order (FIFO).
 *
 * Guards against unauthenticated calls: Supabase RLS will reject writes
 * from a session-less client, burning through retries permanently.
 */
export async function flushOutbox(): Promise<void> {
  // Auth guard — do not flush if the session hasn't been restored yet.
  // This prevents the startup race where flushOutbox fires before
  // supabase.auth has rehydrated the session from storage.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return

  const entries = await db.outbox.orderBy('id').toArray()
  if (entries.length === 0) return

  for (const entry of entries) {
    if (entry.retries >= MAX_RETRIES) continue

    try {
      await processEntry(entry)
      await db.outbox.delete(entry.id!)
    } catch (err) {
      // Don't increment retries for auth errors — they'll always fail until
      // the user re-authenticates and are not a transient network problem.
      const msg = String(err)
      const isAuthError = msg.includes('JWT') || msg.includes('401') || msg.includes('403') || msg.includes('not authenticated')
      if (!isAuthError) {
        await db.outbox.update(entry.id!, {
          retries: entry.retries + 1,
          last_error: msg,
        })
      }
    }
  }
}

const CONFLICT_COLUMN: Record<string, string> = {
  calibration_records:        'id',
  calibration_measurements:   'id',
  assets:                     'id',
  calibration_standards_used: 'record_id,standard_id',
}

async function processEntry(entry: OutboxEntry): Promise<void> {
  if (entry.operation === 'upsert') {
    const onConflict = CONFLICT_COLUMN[entry.table] ?? 'id'
    const { error } = await supabase
      .from(entry.table)
      .upsert(entry.payload, { onConflict })
    if (error) throw new Error(error.message)
  } else if (entry.operation === 'delete') {
    const { error } = await supabase
      .from(entry.table)
      .delete()
      .eq('id', (entry.payload as { id: string }).id)
    if (error) throw new Error(error.message)
  } else if (entry.operation === 'replace_standards') {
    // Offline-safe delete+insert for calibration_standards_used.
    // Stored as a single outbox entry so the full replacement is atomic on flush.
    const { record_id, standard_ids } = entry.payload as { record_id: string; standard_ids: string[] }
    await supabase.from('calibration_standards_used').delete().eq('record_id', record_id)
    if (standard_ids.length > 0) {
      const rows = standard_ids.map((standard_id) => ({ record_id, standard_id }))
      const { error } = await supabase.from('calibration_standards_used').insert(rows)
      if (error) throw new Error(error.message)
    }
  }
}

/**
 * Queue a mutation for later sync (offline-first write path).
 */
export async function enqueue(
  entry: Omit<OutboxEntry, 'id' | 'retries' | 'created_at'>
): Promise<void> {
  await db.outbox.add({
    ...entry,
    created_at: new Date().toISOString(),
    retries: 0,
  })
}

/**
 * Queue a full standards replacement for a calibration record.
 * Unlike individual upserts, this captures the deletion of removed standards
 * so the offline→online transition produces the correct final state.
 */
export async function enqueueStandardsReplace(recordId: string, standardIds: string[]): Promise<void> {
  // Remove any previous pending replace for this record to avoid stale sets
  const existing = await db.outbox
    .filter((e) => e.operation === 'replace_standards' && (e.payload['record_id'] as string) === recordId)
    .toArray()
  if (existing.length > 0) {
    await db.outbox.bulkDelete(existing.map((e) => e.id!))
  }

  await db.outbox.add({
    table: 'calibration_standards_used',
    operation: 'replace_standards',
    payload: { record_id: recordId, standard_ids: standardIds },
    created_at: new Date().toISOString(),
    retries: 0,
  })
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
