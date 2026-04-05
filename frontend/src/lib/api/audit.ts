import { supabase } from '../supabase'

export interface AuditPackageRequest {
  start_date: string
  end_date: string
  customer_id?: string
}

export async function generateAuditPackage(req: AuditPackageRequest): Promise<Blob> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const apiUrl = import.meta.env.VITE_API_URL as string
  const res = await fetch(`${apiUrl}/audit/package`, {
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
