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
  upsertCalibrationRecord,
  upsertMeasurements,
  upsertCalibrationStandards,
} from '../lib/api/calibrations'
import { enqueue, enqueueStandardsReplace } from '../lib/sync/outbox'

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
// useCalibrationRecord — single record by id
// ---------------------------------------------------------------------------
export function useCalibrationRecord(
  recordId: string,
): UseQueryResult<LocalCalibrationRecord | undefined> {
  return useQuery({
    queryKey: calibrationKeys.detail(recordId),
    queryFn: async () => {
      // Try Dexie first
      const local = await db.calibration_records.get(recordId)
      if (local) return local

      // Fall back to Supabase
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
      return undefined
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
      // Always try Dexie first (offline-first)
      const local = await db.measurements
        .where('record_id')
        .equals(recordId)
        .toArray()
      if (local.length > 0) return sortMeasurements(local)

      // Attempt remote fetch
      const { supabase } = await import('../lib/supabase')
      const { data, error } = await supabase
        .from('calibration_measurements')
        .select('*')
        .eq('record_id', recordId)
        .order('standard_value', { ascending: true })
      if (error) throw error
      const measurements = (data ?? []) as LocalMeasurement[]
      await db.measurements.bulkPut(measurements)
      return sortMeasurements(measurements)
    },
    enabled: !!recordId,
    staleTime: 1000 * 60 * 5,
  })
}

// ---------------------------------------------------------------------------
// useSaveCalibration
// Writes record + measurements to Dexie immediately, then enqueues both
// in the outbox for sync.
// ---------------------------------------------------------------------------
export interface SaveCalibrationInput {
  record: LocalCalibrationRecord
  measurements: LocalMeasurement[]
  standardIds?: string[]
}

export function useSaveCalibration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      record,
      measurements,
      standardIds = [],
    }: SaveCalibrationInput): Promise<LocalCalibrationRecord> => {
      // 1. Write to Dexie immediately (offline-first)
      await db.calibration_records.put(record)
      if (measurements.length > 0) {
        await db.measurements.bulkPut(measurements)
      }

      // 2. Enqueue calibration record in outbox (POST for new, PUT for existing)
      await enqueue({
        method: record.id ? 'PUT' : 'POST',
        url:    record.id ? `/calibrations/${record.id}` : '/calibrations',
        body:   {
          ...(record as unknown as Record<string, unknown>),
          standard_ids: standardIds,
          measurements: measurements as unknown as Record<string, unknown>[],
        },
      })

      // 3. Standards are included in the calibration body above — no separate enqueue needed.
      //    enqueueStandardsReplace is kept for backwards compatibility (no-op).
      await enqueueStandardsReplace(record.id, standardIds)

      // 4. Attempt online sync opportunistically — skip entirely if offline.
      //    5-second timeout guards against airplane-mode where onLine stays true.
      if (isOnline()) {
        try {
          const withTimeout = <T>(p: Promise<T>): Promise<T> =>
            Promise.race([
              p,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('sync-timeout')), 5000),
              ),
            ])

          const saved = await withTimeout(upsertCalibrationRecord(record, { standardIds, measurements }))
          await withTimeout(upsertMeasurements(measurements))
          await withTimeout(upsertCalibrationStandards(record.id, standardIds))

          // Clean up outbox entries now that sync succeeded — prevents double-flush
          const calibrationUrl = record.id ? `/calibrations/${record.id}` : '/calibrations'
          const outboxEntries = await db.outbox
            .filter((e) => e.url === calibrationUrl)
            .toArray()
          if (outboxEntries.length > 0) {
            await db.outbox.bulkDelete(outboxEntries.map((e) => e.id!))
          }

          return saved
        } catch {
          // Network error or timeout — outbox will retry when back online
        }
      }
      return record
    },

    onSuccess: (saved) => {
      // Invalidate related queries so lists + detail views refresh
      queryClient.invalidateQueries({
        queryKey: calibrationKeys.byAsset(saved.asset_id),
      })
      queryClient.setQueryData(calibrationKeys.detail(saved.id), saved)
    },
  })
}
