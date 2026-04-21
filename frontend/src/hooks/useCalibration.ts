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
import { enqueue } from '../lib/sync/outbox'

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

      // 2. Enqueue record in outbox
      await enqueue({
        table: 'calibration_records',
        operation: 'upsert',
        payload: record as unknown as Record<string, unknown>,
      })

      // 3. Enqueue measurements in outbox
      for (const m of measurements) {
        await enqueue({
          table: 'calibration_measurements',
          operation: 'upsert',
          payload: m as unknown as Record<string, unknown>,
        })
      }

      // 4. Enqueue standard links in outbox (delete+re-insert happens in the
      //    online path; outbox handles inserts for offline support)
      for (const standard_id of standardIds) {
        await enqueue({
          table: 'calibration_standards_used',
          operation: 'upsert',
          payload: { record_id: record.id, standard_id },
        })
      }

      // 5. Attempt online sync opportunistically — skip entirely if offline.
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

          const saved = await withTimeout(upsertCalibrationRecord(record))
          await withTimeout(upsertMeasurements(measurements))
          await withTimeout(upsertCalibrationStandards(record.id, standardIds))
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
