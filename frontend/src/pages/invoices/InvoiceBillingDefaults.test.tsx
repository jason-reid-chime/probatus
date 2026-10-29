import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '../../test/render'

// Supabase stub routed by table: billing_settings and tenants use maybeSingle(),
// the customers list is awaited directly.
const sb = vi.hoisted(() => ({
  billing: (): Promise<{ data: unknown; error: unknown }> => Promise.resolve({ data: null, error: null }),
}))
vi.mock('../../lib/supabase', () => {
  const make = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order']) chain[m] = vi.fn(() => chain)
    chain.maybeSingle = vi.fn(() =>
      table === 'billing_settings' ? sb.billing() : Promise.resolve({ data: { name: 'Acme Calibration' }, error: null }))
    chain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [{ id: 'c1', name: 'City Water', email: 'ops@city.example' }], error: null }).then(res)
    return chain
  }
  return { supabase: { from: vi.fn((t: string) => make(t)) } }
})
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'supervisor', tenant_id: 't1', full_name: 'Sue' } }),
}))
vi.mock('../../lib/api/invoices', async (orig) => ({
  ...(await orig<typeof import('../../lib/api/invoices')>()),
  getInvoice: vi.fn(),
  createInvoice: vi.fn(),
  invoiceFromWorkOrder: vi.fn(),
}))

import InvoiceDetail from './InvoiceDetail'
import CreateInvoicePanel from '../work-orders/CreateInvoicePanel'
import { createInvoice, getInvoice, invoiceFromWorkOrder, type Invoice } from '../../lib/api/invoices'

const gst = { tax_number: '987654321 RT0001', tax_label: 'GST', default_tax_rate: 5 }

const invoice: Invoice = {
  id: 'i1', number: 7, customer_id: 'c1', customer_name: 'City Water', customer_email: null,
  work_order_id: null, status: 'sent', issue_date: '2026-10-01', due_date: '2026-10-31', currency: 'CAD',
  tax_rate: 13, notes: null, sent_at: null, paid_at: null, created_at: '', subtotal: 100, tax: 13, total: 113,
  lines: [{ id: 'l1', description: 'Calibration — PT-1', quantity: 1, unit_price: 100, asset_id: 'a1', record_id: null, asset_tag: 'PT-1' }],
}

const newInvoice = () => renderPage(<InvoiceDetail />, { path: '/invoices/new', route: '/invoices/:id' })
const taxRateInput = () => screen.getByLabelText('Tax rate percent') as HTMLInputElement

describe('InvoiceDetail billing defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sb.billing = () => Promise.resolve({ data: gst, error: null })
  })

  it('starts a new invoice at the tenant default rate once settings load', async () => {
    let resolve!: (v: { data: unknown; error: unknown }) => void
    sb.billing = () => new Promise((r) => { resolve = r })
    newInvoice()
    expect(taxRateInput().value).toBe('0')
    await act(async () => resolve({ data: gst, error: null }))
    await waitFor(() => expect(taxRateInput().value).toBe('5'))
  })

  it('shows the tax registration number and uses the tax label on the tax line', async () => {
    newInvoice()
    expect(await screen.findByText('GST # 987654321 RT0001')).toBeTruthy()
    expect(screen.getByText('Acme Calibration')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Line 1 unit price'), { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: 'Calibration' } })
    // 200 + 5% GST
    expect(screen.getByText(/210\.00/)).toBeTruthy()
  })

  it('creates the draft with the default rate', async () => {
    vi.mocked(createInvoice).mockResolvedValue({ id: 'new-id' })
    newInvoice()
    await waitFor(() => expect(taxRateInput().value).toBe('5'))
    await userEvent.type(screen.getByLabelText('Line 1 description'), 'Rush fee')
    await userEvent.click(screen.getByRole('button', { name: /create draft/i }))
    await waitFor(() => expect(createInvoice).toHaveBeenCalledWith(expect.objectContaining({ tax_rate: 5 })))
  })

  it('hides the registration line when no tax number is set and falls back to HST', async () => {
    sb.billing = () => Promise.resolve({ data: null, error: null })
    newInvoice()
    await waitFor(() => expect(taxRateInput().value).toBe('13'))
    expect(screen.queryByText(/ # /)).toBeNull()
    expect(screen.getByText(/^HST/)).toBeTruthy()
  })

  it('keeps an existing invoice at its own rate, labelled with the tenant tax name', async () => {
    vi.mocked(getInvoice).mockResolvedValue(invoice)
    renderPage(<InvoiceDetail />, { path: '/invoices/i1', route: '/invoices/:id' })
    expect(await screen.findByText('Invoice #7')).toBeTruthy()
    expect(await screen.findByText('GST (13%)')).toBeTruthy()
    expect(screen.getByText('GST # 987654321 RT0001')).toBeTruthy()
  })
})

describe('CreateInvoicePanel billing defaults', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prefills and submits the tenant default rate', async () => {
    sb.billing = () => Promise.resolve({ data: gst, error: null })
    vi.mocked(invoiceFromWorkOrder).mockResolvedValue({ id: 'inv-1' })
    renderPage(<CreateInvoicePanel workOrderId="w1" assetCount={2} />, { path: '/wo', route: '/wo' })
    await waitFor(() => expect(screen.getByDisplayValue('5')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: /create draft invoice/i }))
    await waitFor(() => expect(invoiceFromWorkOrder).toHaveBeenCalledWith('w1', expect.objectContaining({ tax_rate: 5 })))
  })

  it('keeps 13% when settings cannot be loaded', async () => {
    sb.billing = () => Promise.resolve({ data: null, error: new Error('offline') })
    vi.mocked(invoiceFromWorkOrder).mockResolvedValue({ id: 'inv-1' })
    renderPage(<CreateInvoicePanel workOrderId="w1" assetCount={2} />, { path: '/wo', route: '/wo' })
    expect(screen.getByDisplayValue('13')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /create draft invoice/i }))
    await waitFor(() => expect(invoiceFromWorkOrder).toHaveBeenCalledWith('w1', expect.objectContaining({ tax_rate: 13 })))
  })
})
