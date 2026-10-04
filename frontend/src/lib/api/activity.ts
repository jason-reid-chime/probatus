import { apiRequest } from './client'

export interface ActivityChange {
  field: string
  old: unknown
  new: unknown
}

export interface ActivityEntry {
  id: number
  created_at: string
  user_id: string | null
  user_name: string | null
  table_name: string
  record_id: string
  parent_id: string | null
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  label: string
  changes: ActivityChange[]
}

export interface ActivityFilters {
  record_id?: string
  table?: string
  user_id?: string
  action?: string
  from?: string
  to?: string
  before_id?: number
  limit?: number
}

export function fetchActivity(filters: ActivityFilters = {}): Promise<ActivityEntry[]> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '' && v !== null) params.set(k, String(v))
  }
  const qs = params.toString()
  return apiRequest<ActivityEntry[]>('GET', `/activity${qs ? `?${qs}` : ''}`)
}

export interface VerifyResult {
  ok: boolean
  checked: number
  first_broken_id: number | null
}

export function verifyActivity(): Promise<VerifyResult> {
  return apiRequest<VerifyResult>('GET', '/activity/verify')
}

/** Human names for audited tables. */
export const TABLE_LABELS: Record<string, string> = {
  assets: 'Asset',
  calibration_records: 'Calibration',
  calibration_measurements: 'Measurement',
  calibration_standards_used: 'Standard used',
  calibration_documents: 'Document',
  master_standards: 'Master standard',
  customers: 'Customer',
  work_orders: 'Work order',
  work_order_assets: 'Work order asset',
  work_order_technicians: 'Work order technician',
  profiles: 'User',
  invoices: 'Invoice',
  invoice_lines: 'Invoice line',
  notification_settings: 'Alert settings',
}

/** In-app link for an activity entry's subject, when there is a page for it. */
export function activityLink(e: ActivityEntry): string | null {
  if (e.action === 'DELETE') return null
  switch (e.table_name) {
    case 'assets': return `/assets/${e.record_id}`
    case 'calibration_records': return `/calibrations/${e.record_id}`
    case 'calibration_measurements':
    case 'calibration_standards_used':
    case 'calibration_documents': return e.parent_id ? `/calibrations/${e.parent_id}` : null
    case 'master_standards': return `/standards/${e.record_id}`
    case 'work_orders': return `/work-orders/${e.record_id}`
    case 'work_order_assets':
    case 'work_order_technicians': return e.parent_id ? `/work-orders/${e.parent_id}` : null
    case 'invoices': return `/invoices/${e.record_id}`
    case 'invoice_lines': return e.parent_id ? `/invoices/${e.parent_id}` : null
    default: return null
  }
}

/** Render an audited value for display. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.length ? v.map(formatValue).join(', ') : '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** "customer_id" -> "customer", "next_due_at" -> "next due at". */
export function fieldLabel(field: string): string {
  return field.replace(/_id$/, '').replace(/_/g, ' ')
}
