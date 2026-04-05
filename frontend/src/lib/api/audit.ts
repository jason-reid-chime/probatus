import { supabase } from '../supabase'
import { API_URL } from './client'

export interface AuditPackageRequest {
  start_date: string
  end_date: string
  customer_id?: string
}

export async function generateAuditPackage(req: AuditPackageRequest): Promise<Blob> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const res = await fetch(`${API_URL}/audit/package`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error')
    throw new Error(`Failed to generate audit package: ${text}`)
  }

  return res.blob()
}
