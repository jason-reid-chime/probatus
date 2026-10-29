import { describe, it, expect, vi } from 'vitest'

const result: { data: unknown; error: unknown } = { data: null, error: null }
vi.mock('../supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve(result))
  return { supabase: { from: vi.fn(() => chain) } }
})
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ profile: null }) }))

import { getBillingSettings, DEFAULT_BILLING } from './billing'

describe('getBillingSettings', () => {
  it('returns defaults (HST 13%) when nothing is saved', async () => {
    result.data = null
    expect(await getBillingSettings('t1')).toEqual(DEFAULT_BILLING)
  })

  it('reads saved values, converting the numeric rate', async () => {
    result.data = { tax_number: '123456789 RT0001', tax_label: 'GST', default_tax_rate: '5.000' }
    expect(await getBillingSettings('t1')).toEqual({ tax_number: '123456789 RT0001', tax_label: 'GST', default_tax_rate: 5 })
  })

  it('keeps a 0% rate rather than falling back', async () => {
    result.data = { tax_number: null, tax_label: 'HST', default_tax_rate: 0 }
    expect((await getBillingSettings('t1')).default_tax_rate).toBe(0)
  })
})
