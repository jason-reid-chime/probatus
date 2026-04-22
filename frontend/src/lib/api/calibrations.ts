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
// upsertCalibrationStandards
// ---------------------------------------------------------------------------
export async function upsertCalibrationStandards(
  recordId: string,
  standardIds: string[],
): Promise<void> {
  // Remove previous links then insert the current selection
  await supabase
    .from('calibration_standards_used')
    .delete()
    .eq('record_id', recordId)

  if (standardIds.length === 0) return

  const rows = standardIds.map((standard_id) => ({ record_id: recordId, standard_id }))
  const { error } = await supabase.from('calibration_standards_used').insert(rows)
  if (error) throw error
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
