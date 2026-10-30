import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '../../test/render'
import type { LocalAsset } from '../../lib/db'

const qr = vi.hoisted(() => ({ onResult: null as null | ((tag: string) => void), start: vi.fn(), stop: vi.fn(), scanning: false }))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'supervisor', tenant_id: 't1', full_name: 'Sue' } }),
}))
vi.mock('../../hooks/useAssets', () => ({ useAsset: vi.fn(), useAssets: vi.fn(), useUpsertAsset: vi.fn() }))
vi.mock('../../hooks/useQrScanner', () => ({
  useQrScanner: (onResult: (tag: string) => void) => {
    qr.onResult = onResult
    return { scannerRef: { current: null }, startScanner: qr.start, stopScanner: qr.stop, isScanning: qr.scanning }
  },
}))
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) chain[m] = vi.fn(() => chain)
  chain.then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data: [{ id: 'c1', name: 'City Water' }, { id: 'c2', name: 'Mill Co' }], error: null }).then(res)
  return { supabase: { from: vi.fn(() => chain) } }
})

import AssetForm from './AssetForm'
import { useAsset, useAssets, useUpsertAsset } from '../../hooks/useAssets'

const upsert = vi.fn()
const existing: LocalAsset = {
  id: 'a1', tenant_id: 't1', customer_id: 'c2', tag_id: 'TT-9', serial_number: 'SN-9', manufacturer: 'Rosemount',
  model: '3144P', instrument_type: 'transmitter_4_20ma', range_min: -50, range_max: 250, range_unit: '°F',
  calibration_interval_days: 180, last_calibrated_at: '2026-01-01', next_due_at: '2026-07-01', location: 'Boiler room',
  notes: 'Hot tap', updated_at: '',
}
const others = [existing, { ...existing, id: 'a2', tag_id: 'PG-0042' }]

function mockHooks({ asset, loading = false, saving = false }: { asset?: LocalAsset; loading?: boolean; saving?: boolean } = {}) {
  vi.mocked(useAsset).mockReturnValue({ data: asset, isLoading: loading } as never)
  vi.mocked(useAssets).mockReturnValue({ data: others } as never)
  vi.mocked(useUpsertAsset).mockReturnValue({ mutateAsync: upsert, isPending: saving } as never)
}

const value = (label: string) => (screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement).value
const createAsset = () => renderPage(<AssetForm />, { path: '/assets/new', route: '/assets/new' })
const editAsset = () => renderPage(<AssetForm />, { path: '/assets/a1/edit', route: '/assets/:id/edit' })

describe('AssetForm (new)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    qr.scanning = false
    mockHooks()
  })

  it('pre-fills unit and range for the default pressure type and updates them when the type changes', async () => {
    createAsset()
    expect(screen.getByRole('heading', { name: 'New Asset' })).toBeTruthy()
    await waitFor(() => expect(value('Unit')).toBe('psi'))
    expect(value('Range Min')).toBe('0')
    expect(value('Range Max')).toBe('100')

    fireEvent.change(screen.getByLabelText(/Instrument Type/), { target: { value: 'transmitter_4_20ma' } })
    await waitFor(() => expect(value('Unit')).toBe('mA'))
    expect(value('Range Min')).toBe('4')
    expect(value('Range Max')).toBe('20')

    fireEvent.change(screen.getByLabelText(/Instrument Type/), { target: { value: 'backflow_test_kit' } })
    await waitFor(() => expect(value('Unit')).toBe('PSID'))
    expect(value('Range Max')).toBe('15')
  })

  it('warns about a duplicate tag ID regardless of case', async () => {
    createAsset()
    await userEvent.type(screen.getByLabelText(/^Tag ID/), 'pg-0042')
    expect(screen.getByText(/already exists for another asset/)).toBeTruthy()
    await userEvent.type(screen.getByLabelText(/^Tag ID/), '1')
    expect(screen.queryByText(/already exists for another asset/)).toBeNull()
  })

  it('requires a tag ID', async () => {
    createAsset()
    await userEvent.click(screen.getByRole('button', { name: 'Create Asset' }))
    expect(await screen.findByText('Tag ID is required')).toBeTruthy()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('rejects a calibration interval under one day', async () => {
    createAsset()
    await userEvent.type(screen.getByLabelText(/^Tag ID/), 'PG-1')
    fireEvent.change(screen.getByLabelText(/Calibration Interval/), { target: { value: '0' } })
    await userEvent.click(screen.getByRole('button', { name: 'Create Asset' }))
    expect(await screen.findByText('Must be at least 1 day')).toBeTruthy()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('creates the asset with numeric ranges, blanks omitted and the chosen customer, then opens it', async () => {
    upsert.mockResolvedValue({ id: 'saved-1' })
    createAsset()
    await userEvent.type(screen.getByLabelText(/^Tag ID/), 'PG-1')
    await userEvent.type(screen.getByLabelText(/Manufacturer/), 'Ashcroft')
    fireEvent.change(screen.getByLabelText(/Range Max/), { target: { value: '300' } })
    fireEvent.change(screen.getByLabelText(/Calibration Interval/), { target: { value: '90' } })
    await screen.findByRole('option', { name: 'Mill Co' })
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'c2' } })
    await userEvent.click(screen.getByRole('button', { name: 'Create Asset' }))

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1))
    const payload = upsert.mock.calls[0][0]
    expect(payload).toMatchObject({
      tenant_id: 't1', customer_id: 'c2', tag_id: 'PG-1', manufacturer: 'Ashcroft', instrument_type: 'pressure',
      range_min: 0, range_max: 300, range_unit: 'psi', calibration_interval_days: 90,
    })
    expect(payload.serial_number).toBeUndefined()
    expect(payload.notes).toBeUndefined()
    expect(typeof payload.id).toBe('string')
    expect(await screen.findByTestId('navigated')).toBeTruthy()
  })

  it('shows server errors, including non-Error rejections', async () => {
    upsert.mockRejectedValueOnce(new Error('A asset with this Tag ID already exists.'))
    upsert.mockRejectedValueOnce({ message: 'permission denied' })
    createAsset()
    await userEvent.type(screen.getByLabelText(/^Tag ID/), 'PG-1')
    await userEvent.click(screen.getByRole('button', { name: 'Create Asset' }))
    expect(await screen.findByText(/Tag ID already exists/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Create Asset' }))
    expect(await screen.findByText('permission denied')).toBeTruthy()
    expect(screen.queryByTestId('navigated')).toBeNull()
  })

  it('fills the tag ID from a QR scan and closes the scanner', async () => {
    createAsset()
    await userEvent.click(screen.getByRole('button', { name: /scan qr code/i }))
    expect(screen.getByText('Scan Tag QR / Barcode')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /start camera/i }))
    expect(qr.start).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Scan Tag QR / Barcode')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /scan qr code/i }))
    qr.onResult!('PG-0042')
    await waitFor(() => expect(value('Tag ID')).toBe('PG-0042'))
    expect(screen.queryByText('Scan Tag QR / Barcode')).toBeNull()
    expect(screen.getByText(/already exists for another asset/)).toBeTruthy()
  })

  it('offers Stop Camera while scanning', async () => {
    qr.scanning = true
    createAsset()
    await userEvent.click(screen.getByRole('button', { name: /scan qr code/i }))
    await userEvent.click(screen.getByRole('button', { name: /stop camera/i }))
    expect(qr.stop).toHaveBeenCalled()
  })

  it('shows Saving… while the save is pending', () => {
    mockHooks({ saving: true })
    createAsset()
    const btn = screen.getByRole('button', { name: /saving/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})

describe('AssetForm (edit)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a spinner while the asset loads', () => {
    mockHooks({ loading: true })
    editAsset()
    expect(screen.queryByRole('heading', { name: 'Edit Asset' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull()
  })

  it('populates the form from the asset and keeps its range when the type changes', async () => {
    mockHooks({ asset: existing })
    editAsset()
    expect(screen.getByRole('heading', { name: 'Edit Asset' })).toBeTruthy()
    await waitFor(() => expect(value('Tag ID')).toBe('TT-9'))
    expect(value('Serial Number')).toBe('SN-9')
    expect(value('Unit')).toBe('°F')
    expect(value('Range Min')).toBe('-50')
    expect(value('Calibration Interval')).toBe('180')
    expect(value('Location')).toBe('Boiler room')
    await screen.findByRole('option', { name: 'Mill Co' })
    expect((screen.getByLabelText('Customer') as HTMLSelectElement).value).toBe('c2')

    fireEvent.change(screen.getByLabelText(/Instrument Type/), { target: { value: 'pressure' } })
    expect(value('Unit')).toBe('°F')
    expect(value('Range Max')).toBe('250')
  })

  it("does not flag the asset's own tag as a duplicate", async () => {
    mockHooks({ asset: existing })
    editAsset()
    await waitFor(() => expect(value('Tag ID')).toBe('TT-9'))
    expect(screen.queryByText(/already exists for another asset/)).toBeNull()
  })

  it('saves changes under the same id, keeping calibration dates', async () => {
    upsert.mockResolvedValue({ id: 'a1' })
    mockHooks({ asset: existing })
    editAsset()
    await waitFor(() => expect(value('Tag ID')).toBe('TT-9'))
    fireEvent.change(screen.getByLabelText(/Location/), { target: { value: 'Pump house' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'a1', customer_id: 'c2', location: 'Pump house', instrument_type: 'transmitter_4_20ma',
      last_calibrated_at: '2026-01-01', next_due_at: '2026-07-01', range_min: -50, range_max: 250,
    })))
  })
})
