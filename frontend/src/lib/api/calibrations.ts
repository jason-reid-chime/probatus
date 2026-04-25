import { supabase } from '../supabase'
import { db } from '../db'
import type { LocalCalibrationRecord, LocalMeasurement } from '../db'

const API_URL = import.meta.env.VITE_API_URL as string

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  return session.access_token
}

async function apiFetch(path: string, options: RequestInit): Promise<Response> {
  const token = await getAuthToken()
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }
  return res
}

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

  // Cache in Dexie
  await db.calibration_records.bulkPut(records)

  return records
}

// ---------------------------------------------------------------------------
// upsertCalibrationRecord — writes go through the Go backend API
//
// Backend routes:
//   Create: POST /calibrations
//   Update: PUT  /calibrations/{id}
//
// The record's `id` field is the server-side UUID. A freshly created record
// may have a placeholder id (e.g. a local_id prefix) — callers should check
// whether a real server id exists before deciding which path to use.
// ---------------------------------------------------------------------------
export async function upsertCalibrationRecord(
  record: LocalCalibrationRecord,
  opts?: {
    standardIds?: string[]
    measurements?: LocalMeasurement[]
    /** Pass true when the record is known to already exist on the server */
    isExisting?: boolean
  }
): Promise<LocalCalibrationRecord> {
  const { standardIds = [], measurements = [], isExisting = false } = opts ?? {}

  let savedRecord: LocalCalibrationRecord

  if (isExisting && record.id) {
    // UPDATE existing calibration record
    const body: Record<string, unknown> = {
      status:         record.status,
      tech_signature: record.tech_signature ?? '',
      sales_number:   record.sales_number   ?? '',
      flag_number:    record.flag_number     ?? '',
      notes:          record.notes          ?? '',
      local_id:       record.local_id,
      standard_ids:   standardIds,
    }

    const res = await apiFetch(`/calibrations/${record.id}`, {
      method: 'PUT',
      body:   JSON.stringify(body),
    })
    const json = await res.json() as { id: string }
    savedRecord = { ...record, id: json.id }
  } else {
    // CREATE new calibration record
    const body: Record<string, unknown> = {
      asset_id:       record.asset_id,
      performed_at:   record.performed_at,
      sales_number:   record.sales_number   ?? '',
      flag_number:    record.flag_number     ?? '',
      tech_signature: record.tech_signature ?? '',
      notes:          record.notes          ?? '',
      local_id:       record.local_id,
      standard_ids:   standardIds,
      measurements:   measurements.map((m) => ({
        point_label:    m.point_label,
        standard_value: m.standard_value  ?? 0,
        measured_value: m.measured_value  ?? 0,
        unit:           m.unit            ?? '',
        pass:           m.pass            ?? false,
        error_pct:      m.error_pct       ?? 0,
        notes:          m.notes           ?? '',
      })),
    }

    const res = await apiFetch('/calibrations', {
      method: 'POST',
      body:   JSON.stringify(body),
    })
    const json = await res.json() as { id: string }
    savedRecord = { ...record, id: json.id }
  }

  // Cache in Dexie
  await db.calibration_records.put(savedRecord)

  return savedRecord
}

// ---------------------------------------------------------------------------
// upsertCalibrationStandards
//
// @deprecated Standards are now part of the calibration create/update payload
// sent to the backend. Kept for backwards compatibility — still calls Supabase
// directly for any legacy callers that have not yet been migrated.
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
//
// @deprecated Measurements are now part of the calibration create payload sent
// to the backend. For updates, measurements should be included in the
// calibration update body. Kept for backwards compatibility — caches locally
// but does not write to the backend independently.
// ---------------------------------------------------------------------------
export async function upsertMeasurements(
  measurements: LocalMeasurement[],
): Promise<void> {
  if (measurements.length === 0) return

  // Cache in Dexie only — backend mutations go through upsertCalibrationRecord
  await db.measurements.bulkPut(measurements)
}
