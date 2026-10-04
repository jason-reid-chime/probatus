import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { db } from '../lib/db'
import { isOnline } from '../lib/sync/connectivity'
import type { LocalCalibrationRecord, LocalMeasurement } from '../lib/db'
import {
  fetchCalibrationsByAsset,
  buildCalibrationPayload,
} from '../lib/api/calibrations'
import { enqueue, flushOutbox, ownEntries } from '../lib/sync/outbox'

function sortMeasurements(measurements: LocalMeasurement[]): LocalMeasurement[] {
  return [...measurements].sort((a, b) => {
    const aVal = a.standard_value ?? Infinity
    const bVal = b.standard_value ?? Infinity
    return aVal - bVal
  })
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const calibrationKeys = {
  byAsset: (assetId: string) => ['calibrations', 'asset', assetId] as const,
  detail: (recordId: string) => ['calibrations', 'detail', recordId] as const,
  measurements: (recordId: string) =>
    ['calibrations', 'measurements', recordId] as const,
}

// ---------------------------------------------------------------------------
// useCalibrationsByAsset
// Falls back to Dexie when the network call fails (offline-first)
// ---------------------------------------------------------------------------
export function useCalibrationsByAsset(
  assetId: string,
): UseQueryResult<LocalCalibrationRecord[]> {
  return useQuery({
    queryKey: calibrationKeys.byAsset(assetId),
    queryFn: async () => {
      try {
        return await fetchCalibrationsByAsset(assetId)
      } catch {
        // Offline fallback
        return db.calibration_records
          .where('asset_id')
          .equals(assetId)
          .reverse()
          .sortBy('performed_at')
      }
    },
    enabled: !!assetId,
    staleTime: 1000 * 60 * 5,
  })
}

// ---------------------------------------------------------------------------
// Read freshness
// Local data wins only while the current user has unsynced changes for the
// record. Otherwise the server copy is fetched and written back to Dexie, so
// changes made elsewhere (e.g. a supervisor approving on another device) show
// up instead of the first cached copy being served forever.
// ---------------------------------------------------------------------------
async function hasPendingChanges(recordId: string): Promise<boolean> {
  const entries = await ownEntries()
  return entries.some(
    (e) => (e.body as Record<string, unknown> | undefined)?.id === recordId
      || e.url.startsWith(`/calibrations/${recordId}`),
  )
}

// ---------------------------------------------------------------------------
// useCalibrationRecord — single record by id
// ---------------------------------------------------------------------------
export function useCalibrationRecord(
  recordId: string,
): UseQueryResult<LocalCalibrationRecord | undefined> {
  return useQuery({
    queryKey: calibrationKeys.detail(recordId),
    queryFn: async () => {
      const local = await db.calibration_records.get(recordId)
      if (local && await hasPendingChanges(recordId)) return local

      try {
        const { supabase } = await import('../lib/supabase')
        const { data, error } = await supabase
          .from('calibration_records')
          .select('*')
          .eq('id', recordId)
          .maybeSingle()
        if (error) throw error
        if (data) {
          await db.calibration_records.put(data as LocalCalibrationRecord)
          return data as LocalCalibrationRecord
        }
        return local
      } catch (err) {
        // Offline fallback
        if (local) return local
        throw err
      }
    },
    enabled: !!recordId,
    staleTime: 1000 * 60 * 5,
  })
}

// ---------------------------------------------------------------------------
// useMeasurementsByRecord
// ---------------------------------------------------------------------------
export function useMeasurementsByRecord(
  recordId: string,
): UseQueryResult<LocalMeasurement[]> {
  return useQuery({
    queryKey: calibrationKeys.measurements(recordId),
    queryFn: async () => {
      const local = await db.measurements
        .where('record_id')
        .equals(recordId)
        .toArray()
      if (local.length > 0 && await hasPendingChanges(recordId)) return sortMeasurements(local)

      try {
        const { supabase } = await import('../lib/supabase')
        const { data, error } = await supabase
          .from('calibration_measurements')
          .select('*')
          .eq('record_id', recordId)
          .order('standard_value', { ascending: true })
        if (error) throw error
        const measurements = (data ?? []) as LocalMeasurement[]
        if (measurements.length === 0 && local.length > 0) return sortMeasurements(local)
        await db.measurements.where('record_id').equals(recordId).delete()
        await db.measurements.bulkPut(measurements)
        return sortMeasurements(measurements)
      } catch (err) {
        // Offline fallback
        if (local.length > 0) return sortMeasurements(local)
        throw err
      }
    },
    enabled: !!recordId,
    staleTime: 1000 * 60 * 5,
  })
}

// ---------------------------------------------------------------------------
// useSaveCalibration
// Writes record + measurements to Dexie immediately, then enqueues one outbox
// entry and (when online) flushes it. The outbox is the only write path, so a
// save is never sent twice by racing a direct API call against a flush.
// ---------------------------------------------------------------------------
export interface SaveCalibrationInput {
  record: LocalCalibrationRecord
  measurements: LocalMeasurement[]
  standardIds?: string[]
  /** True when this is the first save (record doesn't exist in the backend yet). */
  isNewRecord?: boolean
}

export interface SaveCalibrationResult {
  record: LocalCalibrationRecord
  /** True when the change reached the server; false when it is queued for later. */
  synced: boolean
}

const SYNC_TIMEOUT_MS = 5000

export function useSaveCalibration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      record,
      measurements,
      standardIds = [],
      isNewRecord = false,
    }: SaveCalibrationInput): Promise<SaveCalibrationResult> => {
      // 1. Write to Dexie immediately (offline-first). The form regenerates
      //    measurement ids on every edit, so replace the record's measurements
      //    rather than adding to them.
      await db.calibration_records.put(record)
      await db.measurements.where('record_id').equals(record.id).delete()
      if (measurements.length > 0) {
        await db.measurements.bulkPut(measurements)
      }

      // 2. Enqueue in outbox. New records POST with the client UUID so the
      //    backend creates the record with the same ID as Dexie; existing records
      //    PUT. Both carry the full payload, and the server replaces measurements
      //    and standards, so replays are idempotent.
      const entryId = await enqueue({
        method: isNewRecord ? 'POST' : 'PUT',
        url:    isNewRecord ? '/calibrations' : `/calibrations/${record.id}`,
        body:   buildCalibrationPayload(record, measurements, standardIds),
      })

      // 3. Flush now when online. The timeout guards against airplane mode,
      //    where onLine stays true; the entry stays queued and the periodic
      //    flush picks it up.
      if (isOnline()) {
        await Promise.race([
          flushOutbox().catch(console.error),
          new Promise((resolve) => setTimeout(resolve, SYNC_TIMEOUT_MS)),
        ])
        const stillQueued = await db.outbox.get(entryId)
        return { record, synced: !stillQueued }
      }
      return { record, synced: false }
    },

    onSuccess: ({ record }) => {
      // Invalidate related queries so lists + detail views refresh
      queryClient.invalidateQueries({
        queryKey: calibrationKeys.byAsset(record.asset_id),
      })
      queryClient.setQueryData(calibrationKeys.detail(record.id), record)
      queryClient.invalidateQueries({
        queryKey: calibrationKeys.measurements(record.id),
      })
    },
  })
}
