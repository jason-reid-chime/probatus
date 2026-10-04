import { supabase } from '../supabase'
import { db } from '../db'
import type { LocalCalibrationRecord, LocalMeasurement } from '../db'
import { pendingRecordIds } from '../sync/outbox'

// ---------------------------------------------------------------------------
// fetchCalibrationsByAsset — read path stays on Supabase (no backend proxy)
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

  // Cache in Dexie — except records with unsynced local edits, which must not
  // be overwritten by the older server copy. Those (and records created offline
  // that the server doesn't have yet) are shown from Dexie instead.
  const pending = await pendingRecordIds()
  if (pending.size === 0) {
    await db.calibration_records.bulkPut(records)
    return records
  }
  await db.calibration_records.bulkPut(records.filter((r) => !pending.has(r.id)))
  const unsynced = await db.calibration_records
    .where('asset_id').equals(assetId)
    .filter((r) => pending.has(r.id))
    .toArray()
  const unsyncedIds = new Set(unsynced.map((r) => r.id))
  return [...records.filter((r) => !unsyncedIds.has(r.id)), ...unsynced]
    .sort((a, b) => b.performed_at.localeCompare(a.performed_at))
}

// ---------------------------------------------------------------------------
// buildCalibrationPayload — the single request body for create and update.
//
// The same body is valid for POST /calibrations and PUT /calibrations/{id}, so
// an outbox PUT that 404s (record created offline) can be replayed as a POST
// unchanged. Measurements are sent in full so the server replaces them on
// every save — nullable fields stay null rather than collapsing to 0.
// ---------------------------------------------------------------------------
export function buildCalibrationPayload(
  record: LocalCalibrationRecord,
  measurements: LocalMeasurement[],
  standardIds: string[],
): Record<string, unknown> {
  return {
    id:             record.id,             // client UUID — backend stores it so IDs stay in sync
    asset_id:       record.asset_id,
    status:         record.status,
    performed_at:   record.performed_at,
    sales_number:   record.sales_number   ?? '',
    flag_number:    record.flag_number    ?? '',
    tech_signature: record.tech_signature ?? '',
    notes:          record.notes          ?? '',
    local_id:       record.local_id,
    standard_ids:   standardIds,
    measurements:   measurements.map((m) => ({
      point_label:      m.point_label,
      standard_value:   m.standard_value   ?? null,
      as_found_value:   m.as_found_value   ?? null,
      measured_value:   m.measured_value   ?? null,
      unit:             m.unit             ?? '',
      pass:             m.pass             ?? null,
      error_pct:        m.error_pct        ?? null,
      notes:            m.notes            ?? '',
      uncertainty_pct:  m.uncertainty_pct  ?? null,
      confidence_level: m.confidence_level ?? null,
    })),
  }
}
