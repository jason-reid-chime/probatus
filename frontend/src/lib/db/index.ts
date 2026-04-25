import Dexie, { type EntityTable } from 'dexie'

// -------------------------------------------------------
// Local schema mirrors server schema for offline support
// -------------------------------------------------------

export interface LocalAsset {
  id: string
  tenant_id: string
  customer_id?: string
  tag_id: string
  serial_number?: string
  manufacturer?: string
  model?: string
  instrument_type: string
  range_min?: number
  range_max?: number
  range_unit?: string
  calibration_interval_days: number
  last_calibrated_at?: string
  next_due_at?: string
  location?: string
  notes?: string
  updated_at: string
}

export interface LocalCalibrationRecord {
  id: string
  local_id: string           // client-generated, used to deduplicate on sync
  tenant_id: string
  asset_id: string
  technician_id: string
  supervisor_id?: string
  status: 'in_progress' | 'pending_approval' | 'approved' | 'rejected'
  performed_at: string
  approved_at?: string
  sales_number?: string
  flag_number?: string
  tech_signature?: string
  supervisor_signature?: string
  certificate_url?: string
  notes?: string
  rejection_reason?: string | null
  updated_at: string
}

export interface LocalMeasurement {
  id: string
  record_id: string
  point_label: string
  standard_value?: number
  as_found_value?: number | null  // instrument reading before adjustment
  measured_value?: number          // instrument reading after adjustment (as-left)
  unit?: string
  pass?: boolean
  error_pct?: number
  notes?: string
  uncertainty_pct?: number | null
  confidence_level?: string | null
}

// -------------------------------------------------------
// Outbox: generic HTTP request queue for offline writes
// -------------------------------------------------------
export interface OutboxEntry {
  id?: number               // auto-increment local PK
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string               // e.g. '/calibrations/abc123'
  body?: Record<string, unknown>
  created_at: string
  retries: number
  last_error?: string
}

// -------------------------------------------------------
// Dexie database
// -------------------------------------------------------
class ProbatusDexie extends Dexie {
  assets!: EntityTable<LocalAsset, 'id'>
  calibration_records!: EntityTable<LocalCalibrationRecord, 'id'>
  measurements!: EntityTable<LocalMeasurement, 'id'>
  outbox!: EntityTable<OutboxEntry, 'id'>

  constructor() {
    super('probatus')

    this.on('blocked', () => {
      window.location.reload()
    })

    this.version(1).stores({
      assets:               'id, tenant_id, tag_id, next_due_at',
      calibration_records:  'id, local_id, tenant_id, asset_id, status',
      measurements:         'id, record_id',
      outbox:               '++id, table, created_at',
    })

    this.version(2).stores({
      assets:               'id, tenant_id, tag_id, next_due_at',
      calibration_records:  'id, local_id, tenant_id, asset_id, status, performed_at',
      measurements:         'id, record_id',
      outbox:               '++id, method, created_at',
    })
  }
}

export const db = new ProbatusDexie()
