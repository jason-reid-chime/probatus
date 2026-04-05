import { supabase } from '../supabase'

export interface DashboardStats {
  overdue_count: number
  due_within_30: number
  due_within_90: number
  standards_expiring_soon: number
  pass_rate_30d: number
}

export interface OverdueAsset {
  id: string
  tag_id: string
  manufacturer?: string
  model?: string
  next_due_at: string
  location?: string
}

const ZERO_STATS: DashboardStats = {
  overdue_count: 0,
  due_within_30: 0,
  due_within_90: 0,
  standards_expiring_soon: 0,
  pass_rate_30d: 0,
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return ZERO_STATS

    const apiUrl = import.meta.env.VITE_API_URL as string
    const res = await fetch(`${apiUrl}/stats/dashboard`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!res.ok) return ZERO_STATS
    return res.json() as Promise<DashboardStats>
  } catch {
    return ZERO_STATS
  }
}

export async function fetchOverdueAssets(): Promise<OverdueAsset[]> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('assets')
    .select('id, tag_id, manufacturer, model, next_due_at, location')
    .lt('next_due_at', today)
    .order('next_due_at', { ascending: true })
    .limit(10)
  if (error) return []
  return data ?? []
}

export async function fetchDueSoonAssets(): Promise<OverdueAsset[]> {
  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('assets')
    .select('id, tag_id, manufacturer, model, next_due_at, location')
    .gte('next_due_at', today)
    .lte('next_due_at', in30)
    .order('next_due_at', { ascending: true })
    .limit(10)
  if (error) return []
  return data ?? []
}
