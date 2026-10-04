import { apiRequest } from './client'

export interface AlertSettings {
  enabled: boolean
  lead_days: number[]
  notify_overdue: boolean
  internal_recipients: string[]
  notify_customers: boolean
}

export interface AlertHistoryEntry {
  id: number
  asset_id: string
  tag_id: string
  due_date: string
  kind: string
  recipient: string
  status: 'sending' | 'sent' | 'failed'
  error: string | null
  created_at: string
  sent_at: string | null
}

export interface AlertRunResult {
  assets: number
  sent: number
  failed: number
  skipped: number
}

export const getAlertSettings = () => apiRequest<AlertSettings>('GET', '/notifications/settings')
export const saveAlertSettings = (s: AlertSettings) => apiRequest<AlertSettings>('PUT', '/notifications/settings', s)
export const getAlertHistory = () => apiRequest<AlertHistoryEntry[]>('GET', '/notifications/history')
export const runAlertsNow = () => apiRequest<AlertRunResult>('POST', '/notifications/run')

export function describeKind(kind: string): string {
  if (kind === 'overdue') return 'Overdue'
  const m = kind.match(/^due_(\d+)$/)
  return m ? `${m[1]}-day reminder` : kind
}
