import { supabase } from '../supabase'
import type { CalibrationTemplate } from '../../types'

export async function fetchTemplates(
  tenantId: string,
  instrumentType?: string,
): Promise<CalibrationTemplate[]> {
  let query = supabase
    .from('calibration_templates')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })

  if (instrumentType) {
    query = query.eq('instrument_type', instrumentType)
  }

  const { data, error } = await query

  if (error) throw new Error(error.message)
  return (data ?? []) as CalibrationTemplate[]
}

export async function upsertTemplate(
  t: CalibrationTemplate,
): Promise<CalibrationTemplate> {
  const { data, error } = await supabase
    .from('calibration_templates')
    .upsert(t, { onConflict: 'id' })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as CalibrationTemplate
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('calibration_templates')
    .delete()
    .eq('id', id)

  if (error) throw new Error(error.message)
}
