import { supabase } from '../supabase'
import { db } from '../db'
import type { LocalCalibrationRecord, LocalMeasurement } from '../db'

// ---------------------------------------------------------------------------
// fetchCalibrationsByAsset
// ---------------------------------------------------------------------------
export async function fetchCalibrationsByAsset(
  assetId: string,
): Promise<LocalCalibrationRecord[]> {
  const { data, error } = await supabase
    .from('calibration_records')
    .select('*')
    .eq('asset_id', assetId)
    .order('performed_at', { ascending: false })

  if (error) throw error

  const records = (data ?? []) as LocalCalibrationRecord[]

  // Cache in Dexie
  await db.calibration_records.bulkPut(records)

  return records
}

// ---------------------------------------------------------------------------
// upsertCalibrationRecord
// ---------------------------------------------------------------------------
export async function upsertCalibrationRecord(
  record: LocalCalibrationRecord,
): Promise<LocalCalibrationRecord> {
  const { data, error } = await supabase
    .from('calibration_records')
    .upsert(record, { onConflict: 'local_id' })
    .select()
    .single()

  if (error) throw error

  const saved = data as LocalCalibrationRecord

  // Cache in Dexie
  await db.calibration_records.put(saved)

  return saved
}

// ---------------------------------------------------------------------------
// upsertMeasurements
// ---------------------------------------------------------------------------
export async function upsertMeasurements(
  measurements: LocalMeasurement[],
): Promise<void> {
  if (measurements.length === 0) return

  const { error } = await supabase
    .from('calibration_measurements')
    .upsert(measurements, { onConflict: 'id' })

  if (error) throw error

  // Cache in Dexie
  await db.measurements.bulkPut(measurements)
}
