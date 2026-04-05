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
} from '../lib/api/calibrations'
import { enqueue } from '../lib/sync/outbox'

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
      if (local.length > 0) return local

      // Attempt remote fetch
      const { supabase } = await import('../lib/supabase')
      const { data, error } = await supabase
        .from('calibration_measurements')
        .select('*')
        .eq('record_id', recordId)
      if (error) throw error
      const measurements = (data ?? []) as LocalMeasurement[]
      await db.measurements.bulkPut(measurements)
      return measurements
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
}

export function useSaveCalibration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      record,
      measurements,
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

      // 3. Enqueue measurements in outbox (one entry per measurement for
      //    granular retry; bulk is fine too but per-record is safer)
      for (const m of measurements) {
        await enqueue({
          table: 'calibration_measurements',
          operation: 'upsert',
          payload: m as unknown as Record<string, unknown>,
        })
      }

      // 4. Attempt online sync opportunistically — skip entirely if offline
      if (isOnline()) {
        try {
          const saved = await upsertCalibrationRecord(record)
          await upsertMeasurements(measurements)
          return saved
        } catch {
          // Network error despite onLine — outbox will retry
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
