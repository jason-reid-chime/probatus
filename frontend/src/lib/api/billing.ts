import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { useAuth } from '../../hooks/useAuth'

/** A tenant's sales-tax details, printed on invoices. */
export interface BillingSettings {
  /** Registration number, e.g. "123456789 RT0001". */
  tax_number: string | null
  /** What the tax is called on invoices, e.g. "HST". */
  tax_label: string
  /** Rate (percent) new invoices start with. */
  default_tax_rate: number
}

export const DEFAULT_BILLING: BillingSettings = { tax_number: null, tax_label: 'HST', default_tax_rate: 13 }

export async function getBillingSettings(tenantId: string): Promise<BillingSettings> {
  const { data, error } = await supabase
    .from('billing_settings')
    .select('tax_number, tax_label, default_tax_rate')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  return parseBilling(data)
}

/** Reads a billing_settings row, falling back to the defaults field by field. */
function parseBilling(row: unknown): BillingSettings {
  const r = (row && typeof row === 'object' && !Array.isArray(row) ? row : {}) as Record<string, unknown>
  const rate = r.default_tax_rate == null ? NaN : Number(r.default_tax_rate)
  return {
    tax_number: typeof r.tax_number === 'string' && r.tax_number.trim() ? r.tax_number : null,
    tax_label: typeof r.tax_label === 'string' && r.tax_label.trim() ? r.tax_label : DEFAULT_BILLING.tax_label,
    default_tax_rate: Number.isFinite(rate) ? rate : DEFAULT_BILLING.default_tax_rate,
  }
}

export async function saveBillingSettings(tenantId: string, s: BillingSettings): Promise<BillingSettings> {
  const { data, error } = await supabase
    .from('billing_settings')
    .upsert({
      tenant_id: tenantId,
      tax_number: s.tax_number?.trim() || null,
      tax_label: s.tax_label.trim() || 'HST',
      default_tax_rate: s.default_tax_rate,
      updated_at: new Date().toISOString(),
    })
    .select('tax_number, tax_label, default_tax_rate')
    .single()
  if (error) throw error
  return parseBilling(data)
}

/** The signed-in tenant's billing settings (defaults until saved). */
export function useBillingSettings() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['billing-settings', profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: () => getBillingSettings(profile!.tenant_id),
  })
}
