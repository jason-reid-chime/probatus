import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', () => ({ apiRequest: vi.fn().mockResolvedValue([]) }))
vi.mock('../supabase', () => ({ supabase: { from: vi.fn(), storage: { from: vi.fn() } } }))

import { apiRequest } from './client'
import { supabase } from '../supabase'
import { activityLink, fetchActivity, fieldLabel, formatValue, verifyActivity, type ActivityEntry } from './activity'
import {
  createInvoice, deleteInvoice, formatMoney, getInvoice, invoiceFromWorkOrder, invoiceTotals,
  lineAmount, listInvoices, setInvoiceStatus, updateInvoice,
} from './invoices'
import { fetchAnalytics } from './analytics'
import { describeKind, getAlertHistory, getAlertSettings, runAlertsNow, saveAlertSettings } from './notifications'
import { deleteDocument, documentPath, formatBytes, listDocuments, openDocumentUrl, uploadDocument } from './documents'
import { assetLabelUrl, resolveScan } from '../labels'

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: 1, created_at: '', user_id: null, user_name: null, table_name: 'assets', record_id: 'r', parent_id: 'p',
  action: 'UPDATE', label: '', changes: [], ...over,
})

describe('activity helpers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds the query string, skipping empty filters', async () => {
    await fetchActivity({ table: 'assets', user_id: '', before_id: 10 })
    expect(apiRequest).toHaveBeenCalledWith('GET', '/activity?table=assets&before_id=10')
    await fetchActivity()
    expect(apiRequest).toHaveBeenLastCalledWith('GET', '/activity')
    await verifyActivity()
    expect(apiRequest).toHaveBeenLastCalledWith('GET', '/activity/verify')
  })

  it('links entries to their page', () => {
    expect(activityLink(entry({ table_name: 'assets' }))).toBe('/assets/r')
    expect(activityLink(entry({ table_name: 'calibration_measurements' }))).toBe('/calibrations/p')
    expect(activityLink(entry({ table_name: 'invoice_lines' }))).toBe('/invoices/p')
    expect(activityLink(entry({ table_name: 'work_order_assets' }))).toBe('/work-orders/p')
    expect(activityLink(entry({ table_name: 'master_standards' }))).toBe('/standards/r')
    expect(activityLink(entry({ table_name: 'profiles' }))).toBeNull()
    expect(activityLink(entry({ action: 'DELETE' }))).toBeNull()
    expect(activityLink(entry({ table_name: 'calibration_documents', parent_id: null }))).toBeNull()
  })

  it('formats values and field names', () => {
    expect(formatValue(null)).toBe('—')
    expect(formatValue(true)).toBe('Yes')
    expect(formatValue([30, 7])).toBe('30, 7')
    expect(formatValue([])).toBe('—')
    expect(formatValue({ a: 1 })).toBe('{"a":1}')
    expect(formatValue(5)).toBe('5')
    expect(fieldLabel('customer_id')).toBe('customer')
    expect(fieldLabel('next_due_at')).toBe('next due at')
  })
})

describe('invoice helpers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('computes line amounts and totals like the server', () => {
    expect(lineAmount({ quantity: 3, unit_price: 33.333 })).toBe(100)
    const t = invoiceTotals([{ description: 'a', quantity: 2, unit_price: 50, asset_id: null, record_id: null }], 13)
    expect(t).toEqual({ subtotal: 100, tax: 13, total: 113 })
    expect(invoiceTotals([], 13)).toEqual({ subtotal: 0, tax: 0, total: 0 })
  })

  it('formats money, falling back for unknown currencies', () => {
    expect(formatMoney(12.5, 'CAD')).toMatch(/12\.50/)
    expect(formatMoney(1, 'NOPE')).toBe('NOPE 1.00')
  })

  it('calls the invoice endpoints', async () => {
    const input = { customer_id: null, due_date: null, currency: 'CAD', tax_rate: 0, notes: null, lines: [] }
    await listInvoices('paid')
    expect(apiRequest).toHaveBeenLastCalledWith('GET', '/invoices?status=paid')
    await listInvoices()
    expect(apiRequest).toHaveBeenLastCalledWith('GET', '/invoices')
    await getInvoice('i1')
    await createInvoice(input)
    expect(apiRequest).toHaveBeenLastCalledWith('POST', '/invoices', input)
    await updateInvoice('i1', input)
    expect(apiRequest).toHaveBeenLastCalledWith('PUT', '/invoices/i1', input)
    await deleteInvoice('i1')
    await setInvoiceStatus('i1', 'sent', true)
    expect(apiRequest).toHaveBeenLastCalledWith('PATCH', '/invoices/i1/status', { status: 'sent', email: true })
    await invoiceFromWorkOrder('w1', { unit_price: 1, tax_rate: 2, currency: 'CAD', due_days: 3 })
    expect(apiRequest).toHaveBeenLastCalledWith('POST', '/work-orders/w1/invoice', { unit_price: 1, tax_rate: 2, currency: 'CAD', due_days: 3 })
  })
})

describe('analytics and alerts API', () => {
  it('calls the endpoints', async () => {
    await fetchAnalytics(6)
    expect(apiRequest).toHaveBeenLastCalledWith('GET', '/stats/analytics?months=6')
    await getAlertSettings()
    const s = { enabled: true, lead_days: [7], notify_overdue: true, internal_recipients: [], notify_customers: false }
    await saveAlertSettings(s)
    expect(apiRequest).toHaveBeenLastCalledWith('PUT', '/notifications/settings', s)
    await getAlertHistory()
    await runAlertsNow()
    expect(apiRequest).toHaveBeenLastCalledWith('POST', '/notifications/run')
  })

  it('describes alert kinds', () => {
    expect(describeKind('overdue')).toBe('Overdue')
    expect(describeKind('due_30')).toBe('30-day reminder')
    expect(describeKind('weird')).toBe('weird')
  })
})

describe('labels', () => {
  const assets = [{ id: '11111111-2222-3333-4444-555555555555', tag_id: 'PT-1' }, { id: 'b', tag_id: 'TT-2' }, { id: 'c', tag_id: 'tt-2' }]

  it('encodes the asset URL', () => {
    expect(assetLabelUrl('abc', 'https://app.example')).toBe('https://app.example/assets/abc')
  })

  it('resolves scans to an asset or a tag search', () => {
    expect(resolveScan('https://x.example/assets/11111111-2222-3333-4444-555555555555', assets)).toEqual({ kind: 'asset', id: '11111111-2222-3333-4444-555555555555' })
    expect(resolveScan(' pt-1 ', assets)).toEqual({ kind: 'asset', id: '11111111-2222-3333-4444-555555555555' })
    expect(resolveScan('TT-2', assets)).toEqual({ kind: 'tag', tag: 'TT-2' }) // ambiguous
    expect(resolveScan('nope', assets)).toEqual({ kind: 'tag', tag: 'nope' })
  })
})

describe('documents', () => {
  const storage = { upload: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn() }
  function table(result: unknown) {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'single']) chain[m] = vi.fn(() => chain)
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
    return chain
  }
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabase.storage.from).mockReturnValue(storage as never)
    storage.upload.mockResolvedValue({ error: null })
    storage.remove.mockResolvedValue({ error: null })
  })

  it('builds safe storage paths', () => {
    expect(documentPath('t', 'r', 'Cert (final) #2.pdf', 'id')).toBe('t/r/id-Cert_final_2.pdf')
    expect(documentPath('t', 'r', '***', 'id')).toBe('t/r/id-_')
  })

  it('formats sizes', () => {
    expect(formatBytes(null)).toBe('')
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('lists documents by record or asset', async () => {
    const t = table({ data: [{ id: 'd1' }], error: null })
    vi.mocked(supabase.from).mockReturnValue(t as never)
    expect(await listDocuments({ recordId: 'r1' })).toEqual([{ id: 'd1' }])
    expect(t.eq).toHaveBeenCalledWith('record_id', 'r1')
    await listDocuments({ assetId: 'a1' })
    expect(t.eq).toHaveBeenCalledWith('asset_id', 'a1')
  })

  it('uploads the file then records it', async () => {
    const t = table({ data: { id: 'd1' }, error: null })
    vi.mocked(supabase.from).mockReturnValue(t as never)
    const file = new File(['x'], 'cert.pdf', { type: 'application/pdf' })
    const doc = await uploadDocument({ tenantId: 't1', recordId: 'r1', file, kind: 'certificate' })
    expect(doc).toEqual({ id: 'd1' })
    expect(storage.upload.mock.calls[0][0]).toMatch(/^t1\/r1\/.+-cert\.pdf$/)
    expect(t.insert).toHaveBeenCalledWith(expect.objectContaining({ record_id: 'r1', kind: 'certificate', file_name: 'cert.pdf' }))
  })

  it('removes the uploaded file if the row insert fails', async () => {
    vi.mocked(supabase.from).mockReturnValue(table({ data: null, error: new Error('rls') }) as never)
    const file = new File(['x'], 'a.pdf')
    await expect(uploadDocument({ tenantId: 't1', assetId: 'a1', file, kind: 'other' })).rejects.toThrow('rls')
    expect(storage.remove).toHaveBeenCalled()
  })

  it('rejects oversized files and missing owners', async () => {
    const big = new File(['x'], 'big.pdf')
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 })
    await expect(uploadDocument({ tenantId: 't', recordId: 'r', file: big, kind: 'other' })).rejects.toThrow('25 MB')
    await expect(uploadDocument({ tenantId: 't', file: new File(['x'], 'a'), kind: 'other' })).rejects.toThrow('record or asset')
  })

  it('opens via a signed URL and deletes row + file', async () => {
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null })
    expect(await openDocumentUrl({ file_path: 'p' })).toBe('https://signed')
    storage.createSignedUrl.mockResolvedValue({ data: null, error: new Error('nope') })
    await expect(openDocumentUrl({ file_path: 'p' })).rejects.toThrow('nope')

    vi.mocked(supabase.from).mockReturnValue(table({ error: null }) as never)
    await deleteDocument({ id: 'd1', file_path: 'p' })
    expect(storage.remove).toHaveBeenCalledWith(['p'])
  })
})
