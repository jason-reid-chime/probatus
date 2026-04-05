export interface TemplatePoint {
  label: string
  standard_value: number | null
  unit: string
}

export interface CalibrationTemplate {
  id: string
  tenant_id: string
  name: string
  description?: string
  instrument_type: 'pressure' | 'temperature' | 'ph_conductivity' | 'conductivity' | 'level_4_20ma' | 'flow' | 'transmitter_4_20ma' | 'pressure_switch' | 'temperature_switch' | 'other'
  tolerance_pct: number
  points: TemplatePoint[]
  created_by?: string
  created_at: string
}

export interface Profile {
  id: string
  tenant_id: string
  full_name: string
  role: 'technician' | 'supervisor' | 'admin' | 'customer'
  roles: Array<'technician' | 'supervisor' | 'admin' | 'customer'>
  signature?: string
  customer_id?: string
}

export interface MasterStandard {
  id: string
  tenant_id: string
  name: string
  serial_number: string
  model?: string
  manufacturer?: string
  certificate_ref?: string
  calibrated_at: string
  due_at: string
  notes?: string
}

export function isStandardExpired(standard: MasterStandard): boolean {
  return standard.due_at < new Date().toISOString().slice(0, 10)
}

export function isStandardDueSoon(standard: MasterStandard, days = 30): boolean {
  const cutoff = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10)
  return !isStandardExpired(standard) && standard.due_at <= cutoff
}
