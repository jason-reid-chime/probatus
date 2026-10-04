import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '../test/render'

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'supervisor', tenant_id: 't1', full_name: 'Sue' } }),
}))
vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'maybeSingle']) chain[m] = vi.fn(() => chain)
  chain.then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data: [{ id: 'c1', name: 'City Water', email: 'ops@city.example' }], error: null }).then(res)
  return { supabase: { from: vi.fn(() => chain) } }
})
vi.mock('../lib/api/activity', async (orig) => ({
  ...(await orig<typeof import('../lib/api/activity')>()),
  fetchActivity: vi.fn(),
  verifyActivity: vi.fn(),
}))
vi.mock('../lib/api/analytics', () => ({ fetchAnalytics: vi.fn() }))
vi.mock('../lib/api/invoices', async (orig) => ({
  ...(await orig<typeof import('../lib/api/invoices')>()),
  listInvoices: vi.fn(),
  getInvoice: vi.fn(),
  createInvoice: vi.fn(),
  updateInvoice: vi.fn(),
  deleteInvoice: vi.fn(),
  setInvoiceStatus: vi.fn(),
  invoiceFromWorkOrder: vi.fn(),
}))
vi.mock('../lib/api/notifications', async (orig) => ({
  ...(await orig<typeof import('../lib/api/notifications')>()),
  getAlertSettings: vi.fn(),
  saveAlertSettings: vi.fn(),
  getAlertHistory: vi.fn(),
  runAlertsNow: vi.fn(),
}))

import ActivityLog from './activity/ActivityLog'
import Analytics from './analytics/Analytics'
import InvoicesList from './invoices/InvoicesList'
import InvoiceDetail from './invoices/InvoiceDetail'
import AlertSettings from './settings/AlertSettings'
import CreateInvoicePanel from './work-orders/CreateInvoicePanel'
import RecordHistory from '../components/activity/RecordHistory'
import { fetchActivity, verifyActivity, type ActivityEntry } from '../lib/api/activity'
import { fetchAnalytics, type Analytics as AnalyticsData } from '../lib/api/analytics'
import {
  createInvoice, deleteInvoice, getInvoice, invoiceFromWorkOrder, listInvoices, setInvoiceStatus, updateInvoice,
  type Invoice,
} from '../lib/api/invoices'
import { getAlertHistory, getAlertSettings, runAlertsNow, saveAlertSettings } from '../lib/api/notifications'

const entries: ActivityEntry[] = [
  { id: 2, created_at: '2026-10-01T10:00:00Z', user_id: 'u1', user_name: 'Sue', table_name: 'assets', record_id: 'a1', parent_id: null, action: 'UPDATE', label: 'PT-1', changes: [{ field: 'location', old: 'Bay 3', new: 'Bay 9' }] },
  { id: 1, created_at: '2026-10-01T09:00:00Z', user_id: null, user_name: null, table_name: 'invoices', record_id: 'i1', parent_id: null, action: 'INSERT', label: '#7', changes: [{ field: 'status', old: null, new: 'draft' }] },
]

describe('ActivityLog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists entries with diffs and verifies the chain', async () => {
    vi.mocked(fetchActivity).mockResolvedValue(entries)
    vi.mocked(verifyActivity).mockResolvedValue({ ok: true, checked: 2, first_broken_id: null })
    renderPage(<ActivityLog />)
    expect(await screen.findByText('Asset PT-1')).toBeTruthy()
    expect(screen.getByText('Bay 9')).toBeTruthy()
    expect(screen.getByText('by system')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /verify integrity/i }))
    expect(await screen.findByText(/all 2 entries match/i)).toBeTruthy()
  })

  it('reports tampering', async () => {
    vi.mocked(fetchActivity).mockResolvedValue(entries)
    vi.mocked(verifyActivity).mockResolvedValue({ ok: false, checked: 9, first_broken_id: 4 })
    renderPage(<ActivityLog />)
    await screen.findByText('Asset PT-1')
    await userEvent.click(screen.getByRole('button', { name: /verify integrity/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/entry #4/)
  })

  it('filters and shows the empty state', async () => {
    vi.mocked(fetchActivity).mockResolvedValue([])
    renderPage(<ActivityLog />)
    expect(await screen.findByText(/no activity matches/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'DELETE' } })
    await waitFor(() => expect(fetchActivity).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'DELETE' })))
  })

  it('pages through older entries', async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({ ...entries[0], id: 100 - i }))
    vi.mocked(fetchActivity).mockResolvedValueOnce(page).mockResolvedValueOnce([entries[1]])
    renderPage(<ActivityLog />)
    await userEvent.click(await screen.findByRole('button', { name: /load older/i }))
    await waitFor(() => expect(fetchActivity).toHaveBeenLastCalledWith(expect.objectContaining({ before_id: 51 })))
  })
})

describe('RecordHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads history only when opened', async () => {
    vi.mocked(fetchActivity).mockResolvedValue(entries)
    renderPage(<RecordHistory recordId="a1" />)
    expect(fetchActivity).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /history/i }))
    expect(await screen.findByText('Bay 9')).toBeTruthy()
    expect(fetchActivity).toHaveBeenCalledWith({ record_id: 'a1', limit: 100 })
  })

  it('shows an empty message', async () => {
    vi.mocked(fetchActivity).mockResolvedValue([])
    renderPage(<RecordHistory recordId="a1" />)
    await userEvent.click(screen.getByRole('button', { name: /history/i }))
    expect(await screen.findByText(/no changes recorded/i)).toBeTruthy()
  })
})

const analytics: AnalyticsData = {
  months: 12, calibrations: 10, failures: 3, fail_rate: 30, total_billed: 360,
  by_make_model: [{ manufacturer: 'Ashcroft', model: '1009', instrument_type: 'pressure', instruments: 4, calibrations: 10, failures: 3, fail_rate: 30 }],
  monthly: [{ month: '2026-09', calibrations: 6, failures: 2 }, { month: '2026-10', calibrations: 4, failures: 1 }],
  cost_by_asset: [{ asset_id: 'a1', tag_id: 'PT-1', manufacturer: 'Ashcroft', model: '1009', instrument_type: 'pressure', calibrations: 3, failures: 2, total_billed: 360, cost_per_year: 360 }],
  repeat_failures: [{ asset_id: 'a1', tag_id: 'PT-1', manufacturer: 'Ashcroft', model: '1009', instrument_type: 'pressure', calibrations: 3, failures: 2, total_billed: 360, cost_per_year: 360 }],
}

describe('Analytics', () => {
  it('shows totals, breakdowns, repeat failures and costs', async () => {
    vi.mocked(fetchAnalytics).mockResolvedValue(analytics)
    renderPage(<Analytics />)
    expect(await screen.findByText('30.0%')).toBeTruthy()
    expect(screen.getByText(/2 of 3 failed/)).toBeTruthy()
    expect(screen.getAllByText('PT-1').length).toBeGreaterThan(0)
    fireEvent.mouseEnter(screen.getByRole('img').firstElementChild!)
    expect(screen.getByText(/2026-09: 33.3%/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '2 yr' }))
    await waitFor(() => expect(fetchAnalytics).toHaveBeenLastCalledWith(24))
  })

  it('shows the empty state', async () => {
    vi.mocked(fetchAnalytics).mockResolvedValue({ ...analytics, calibrations: 0, total_billed: 0, by_make_model: [], monthly: [], cost_by_asset: [], repeat_failures: [] })
    renderPage(<Analytics />)
    expect(await screen.findByText(/no approved calibrations/i)).toBeTruthy()
  })
})

const invoice: Invoice = {
  id: 'i1', number: 7, customer_id: 'c1', customer_name: 'City Water', customer_email: 'ops@city.example',
  work_order_id: null, status: 'draft', issue_date: '2026-10-01', due_date: '2026-10-31', currency: 'CAD',
  tax_rate: 13, notes: 'Net 30', sent_at: null, paid_at: null, created_at: '', subtotal: 100, tax: 13, total: 113,
  lines: [{ id: 'l1', description: 'Calibration — PT-1', quantity: 1, unit_price: 100, asset_id: 'a1', record_id: null, asset_tag: 'PT-1' }],
}

describe('Invoices', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists invoices and filters by status', async () => {
    vi.mocked(listInvoices).mockResolvedValue([{ ...invoice, status: 'sent', due_date: '2020-01-01' }])
    renderPage(<InvoicesList />)
    expect(await screen.findByText('#7')).toBeTruthy()
    expect(screen.getByText(/1 outstanding · 1 past due/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Paid' }))
    await waitFor(() => expect(listInvoices).toHaveBeenLastCalledWith('paid'))
  })

  it('shows an empty list', async () => {
    vi.mocked(listInvoices).mockResolvedValue([])
    renderPage(<InvoicesList />)
    expect(await screen.findByText(/no invoices yet/i)).toBeTruthy()
  })

  it('creates a new invoice', async () => {
    vi.mocked(createInvoice).mockResolvedValue({ id: 'new-id' })
    renderPage(<InvoiceDetail />, { path: '/invoices/new', route: '/invoices/:id' })
    await userEvent.type(screen.getByLabelText('Line 1 description'), 'Rush fee')
    fireEvent.change(screen.getByLabelText('Line 1 unit price'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Tax rate percent'), { target: { value: '13' } })
    expect(screen.getByText(/56\.50/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /add line/i }))
    await userEvent.click(screen.getByRole('button', { name: /remove line 2/i }))
    await userEvent.click(screen.getByRole('button', { name: /create draft/i }))
    await waitFor(() => expect(createInvoice).toHaveBeenCalledWith(expect.objectContaining({
      tax_rate: 13, lines: [expect.objectContaining({ description: 'Rush fee', unit_price: 50 })],
    })))
  })

  it('edits a draft, sends it with email, and surfaces errors', async () => {
    vi.mocked(getInvoice).mockResolvedValue(invoice)
    vi.mocked(updateInvoice).mockResolvedValue({ id: 'i1' })
    vi.mocked(setInvoiceStatus).mockRejectedValueOnce(new Error('API PATCH /invoices/i1/status: 502 failed to email'))
    renderPage(<InvoiceDetail />, { path: '/invoices/i1', route: '/invoices/:id' })
    expect(await screen.findByText('Invoice #7')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '2' } })
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }))
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledWith('i1', expect.objectContaining({ lines: [expect.objectContaining({ quantity: 2 })] })))

    await userEvent.click(await screen.findByRole('button', { name: /mark as sent/i }))
    expect((await screen.findByRole('alert')).textContent).toBe('failed to email')
    expect(setInvoiceStatus).toHaveBeenCalledWith('i1', 'sent', true)
  })

  it('marks a sent invoice paid and voids with confirmation', async () => {
    vi.mocked(getInvoice).mockResolvedValue({ ...invoice, status: 'sent' })
    vi.mocked(setInvoiceStatus).mockResolvedValue({})
    renderPage(<InvoiceDetail />, { path: '/invoices/i1', route: '/invoices/:id' })
    await userEvent.click(await screen.findByRole('button', { name: /mark as paid/i }))
    expect(setInvoiceStatus).toHaveBeenCalledWith('i1', 'paid', false)
    await userEvent.click(screen.getByRole('button', { name: /void/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(setInvoiceStatus).toHaveBeenCalledWith('i1', 'void', false))
  })

  it('deletes a draft after confirmation', async () => {
    vi.mocked(getInvoice).mockResolvedValue(invoice)
    vi.mocked(deleteInvoice).mockResolvedValue(undefined)
    renderPage(<InvoiceDetail />, { path: '/invoices/i1', route: '/invoices/:id' })
    await userEvent.click(await screen.findByRole('button', { name: /delete draft/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(deleteInvoice).toHaveBeenCalledWith('i1'))
  })
})

describe('CreateInvoicePanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a draft from the work order', async () => {
    vi.mocked(invoiceFromWorkOrder).mockResolvedValue({ id: 'inv-1' })
    renderPage(<CreateInvoicePanel workOrderId="w1" assetCount={3} />, { path: '/wo', route: '/wo' })
    fireEvent.change(screen.getByLabelText(/price per instrument/i), { target: { value: '85' } })
    await userEvent.click(screen.getByRole('button', { name: /create draft invoice/i }))
    await waitFor(() => expect(invoiceFromWorkOrder).toHaveBeenCalledWith('w1', { unit_price: 85, tax_rate: 13, currency: 'CAD', due_days: 30 }))
    expect(await screen.findByTestId('navigated')).toBeTruthy()
  })

  it('opens the existing invoice on conflict and shows other errors', async () => {
    vi.mocked(invoiceFromWorkOrder).mockRejectedValueOnce(new Error('API POST /work-orders/w1/invoice: 409 {"error":"exists","id":"11111111-2222-3333-4444-555555555555"}'))
    renderPage(<CreateInvoicePanel workOrderId="w1" assetCount={1} />, { path: '/wo', route: '/wo' })
    await userEvent.click(screen.getByRole('button', { name: /create draft invoice/i }))
    expect(await screen.findByTestId('navigated')).toBeTruthy()

    vi.mocked(invoiceFromWorkOrder).mockRejectedValueOnce(new Error('API POST /x: 500 boom'))
    renderPage(<CreateInvoicePanel workOrderId="w2" assetCount={1} />, { path: '/wo', route: '/wo' })
    await userEvent.click(screen.getAllByRole('button', { name: /create draft invoice/i }).at(-1)!)
    expect((await screen.findByRole('alert')).textContent).toBe('boom')
  })
})

describe('AlertSettings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads, edits and saves settings, then runs alerts', async () => {
    const initial = { enabled: true, lead_days: [30, 7], notify_overdue: true, internal_recipients: ['qa@acme.example'], notify_customers: false }
    vi.mocked(getAlertSettings).mockResolvedValue(initial)
    vi.mocked(getAlertHistory).mockResolvedValue([
      { id: 1, asset_id: 'a1', tag_id: 'PT-1', due_date: '2026-10-10', kind: 'due_7', recipient: 'qa@acme.example', status: 'sent', error: null, created_at: '2026-10-03T00:00:00Z', sent_at: '2026-10-03T00:00:00Z' },
      { id: 2, asset_id: 'a1', tag_id: 'PT-1', due_date: '2026-10-10', kind: 'overdue', recipient: 'x@y.z', status: 'failed', error: 'bounced', created_at: '2026-10-03T00:00:00Z', sent_at: null },
    ])
    vi.mocked(saveAlertSettings).mockImplementation(async (s) => s)
    vi.mocked(runAlertsNow).mockResolvedValue({ assets: 2, sent: 1, failed: 1, skipped: 3 })

    renderPage(<AlertSettings />)
    expect(await screen.findByText('7-day reminder')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()

    await userEvent.click(screen.getByLabelText('14 days'))
    await userEvent.click(screen.getByLabelText(/email customers/i))
    fireEvent.change(screen.getByLabelText(/staff recipients/i), { target: { value: 'a@b.c; d@e.f' } })
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }))
    await waitFor(() => expect(saveAlertSettings).toHaveBeenCalledWith(expect.objectContaining({
      lead_days: [30, 7, 14], notify_customers: true, internal_recipients: ['a@b.c', 'd@e.f'],
    })))
    expect(await screen.findByText('Saved.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /send due alerts now/i }))
    expect(await screen.findByText(/1 email\(s\) sent, 3 already sent earlier, 1 failed/)).toBeTruthy()
  })

  it('shows save errors and an empty history', async () => {
    vi.mocked(getAlertSettings).mockResolvedValue({ enabled: false, lead_days: [], notify_overdue: false, internal_recipients: [], notify_customers: false })
    vi.mocked(getAlertHistory).mockResolvedValue([])
    vi.mocked(saveAlertSettings).mockRejectedValue(new Error('add at least one recipient'))
    renderPage(<AlertSettings />)
    expect(await screen.findByText(/no alerts sent yet/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: /send due alerts now/i }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByLabelText(/send automatic alerts/i))
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/recipient/)
  })
})
