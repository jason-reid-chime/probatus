import { supabase } from '../supabase'
import type { MasterStandard } from '../../types'

export async function fetchStandards(tenantId: string): Promise<MasterStandard[]> {
  const { data, error } = await supabase
    .from('master_standards')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('due_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function upsertStandard(
  standard: MasterStandard
): Promise<MasterStandard> {
  const { data, error } = await supabase
    .from('master_standards')
    .upsert(standard)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteStandard(id: string): Promise<void> {
  const { error } = await supabase.from('master_standards').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
