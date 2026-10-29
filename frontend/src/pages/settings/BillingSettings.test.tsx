import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '../../test/render'

// Configurable supabase stub: maybeSingle() answers the billing_settings read,
// single() answers the upsert in saveBillingSettings.
const sb = vi.hoisted(() => ({
  read: (): Promise<{ data: unknown; error: unknown }> => Promise.resolve({ data: null, error: null }),
  write: (): Promise<{ data: unknown; error: unknown }> => Promise.resolve({ data: null, error: null }),
  upsert: vi.fn(),
}))
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain)
  sb.upsert.mockImplementation(() => chain)
  chain.upsert = sb.upsert
  chain.maybeSingle = vi.fn(() => sb.read())
  chain.single = vi.fn(() => sb.write())
  return { supabase: { from: vi.fn(() => chain) } }
})
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'admin', tenant_id: 't1', full_name: 'Ada' } }),
}))

import BillingSettings from './BillingSettings'

const saved = { tax_number: '123456789 RT0001', tax_label: 'HST', default_tax_rate: 13 }

describe('BillingSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sb.read = () => Promise.resolve({ data: saved, error: null })
    sb.write = () => Promise.resolve({ data: null, error: null })
  })

  it('shows a placeholder until settings load, then the saved values', async () => {
    let resolve!: (v: { data: unknown; error: unknown }) => void
    sb.read = () => new Promise((r) => { resolve = r })
    renderPage(<BillingSettings />)
    expect(screen.queryByRole('heading', { name: 'Billing' })).toBeNull()
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()

    await act(async () => resolve({ data: { tax_number: '999 RT0001', tax_label: 'GST', default_tax_rate: '5.000' }, error: null }))
    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeTruthy()
    expect(screen.getByDisplayValue('999 RT0001')).toBeTruthy()
    expect(screen.getByDisplayValue('GST')).toBeTruthy()
    expect((screen.getByLabelText('Default tax rate percent') as HTMLInputElement).value).toBe('5')
  })

  it('shows the load error instead of the form', async () => {
    sb.read = () => Promise.resolve({ data: null, error: new Error('permission denied for billing_settings') })
    renderPage(<BillingSettings />)
    expect((await screen.findByRole('alert')).textContent).toBe('permission denied for billing_settings')
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('starts from the HST 13% defaults when nothing has been saved', async () => {
    sb.read = () => Promise.resolve({ data: null, error: null })
    renderPage(<BillingSettings />)
    const rate = (await screen.findByLabelText('Default tax rate percent')) as HTMLInputElement
    expect(rate.value).toBe('13')
    expect(screen.getByDisplayValue('HST')).toBeTruthy()
    expect((screen.getByPlaceholderText('123456789 RT0001') as HTMLInputElement).value).toBe('')
  })

  it.each([['150'], ['-1'], ['']])('rejects a rate of %j and disables Save', async (value) => {
    renderPage(<BillingSettings />)
    const rate = await screen.findByLabelText('Default tax rate percent')
    fireEvent.change(rate, { target: { value } })
    expect((await screen.findByRole('alert')).textContent).toMatch(/between 0 and 100/)
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.submit(save.closest('form')!)
    expect(sb.upsert).not.toHaveBeenCalled()
  })

  it('accepts the 0 and 100 boundaries', async () => {
    renderPage(<BillingSettings />)
    const rate = await screen.findByLabelText('Default tax rate percent')
    for (const v of ['0', '100']) {
      fireEvent.change(rate, { target: { value: v } })
      expect(screen.queryByRole('alert')).toBeNull()
      expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(false)
    }
  })

  it('saves trimmed values, confirms, and clears the confirmation on the next edit', async () => {
    sb.write = () => Promise.resolve({ data: { tax_number: '555 RT0001', tax_label: 'GST', default_tax_rate: 5 }, error: null })
    renderPage(<BillingSettings />)
    const number = await screen.findByDisplayValue('123456789 RT0001')
    fireEvent.change(number, { target: { value: '  555 RT0001 ' } })
    fireEvent.change(screen.getByDisplayValue('HST'), { target: { value: 'GST' } })
    fireEvent.change(screen.getByLabelText('Default tax rate percent'), { target: { value: '5' } })
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(sb.upsert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 't1', tax_number: '555 RT0001', tax_label: 'GST', default_tax_rate: 5,
    }))

    fireEvent.change(screen.getByLabelText('Default tax rate percent'), { target: { value: '6' } })
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('stores a blank tax number as null and a blank label as HST', async () => {
    renderPage(<BillingSettings />)
    fireEvent.change(await screen.findByDisplayValue('123456789 RT0001'), { target: { value: '   ' } })
    fireEvent.change(screen.getByDisplayValue('HST'), { target: { value: '' } })
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(sb.upsert).toHaveBeenCalledWith(expect.objectContaining({ tax_number: null, tax_label: 'HST' })))
  })

  it('shows the save error and no confirmation', async () => {
    sb.write = () => Promise.resolve({ data: null, error: new Error('new row violates row-level security policy') })
    renderPage(<BillingSettings />)
    await userEvent.click(await screen.findByRole('button', { name: /save/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/row-level security/)
    expect(screen.queryByText('Saved')).toBeNull()
  })
})
