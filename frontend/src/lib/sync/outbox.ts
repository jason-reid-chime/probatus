import { db, type OutboxEntry } from '../db'
import { supabase } from '../supabase'

const MAX_RETRIES = 5

/**
 * Flush the outbox — called when connectivity is detected.
 * Processes entries in insertion order (FIFO).
 */
export async function flushOutbox(): Promise<void> {
  const entries = await db.outbox.orderBy('id').toArray()
  if (entries.length === 0) return

  for (const entry of entries) {
    if (entry.retries >= MAX_RETRIES) continue

    try {
      await processEntry(entry)
      await db.outbox.delete(entry.id!)
    } catch (err) {
      await db.outbox.update(entry.id!, {
        retries: entry.retries + 1,
        last_error: String(err),
      })
    }
  }
}

const CONFLICT_COLUMN: Record<string, string> = {
  calibration_records:       'id',
  calibration_measurements:  'id',
  assets:                    'id',
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
