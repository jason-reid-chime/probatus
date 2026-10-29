import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '../../test/render'
import type { LocalCalibrationRecord, LocalMeasurement } from '../../lib/db'

const store = vi.hoisted(() => ({
  local: [] as LocalCalibrationRecord[],
  remote: [] as LocalCalibrationRecord[],
  remoteError: null as unknown,
  measurements: {} as Record<string, LocalMeasurement[]>,
  assets: {} as Record<string, { tag_id: string; serial_number?: string; customer_id?: string }>,
  online: false,
}))

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../hooks/useCustomerFilter', () => ({ useCustomerFilter: vi.fn() }))
vi.mock('../../lib/sync/connectivity', () => ({ isOnline: () => store.online }))
vi.mock('../../lib/api/client', () => ({ apiRequest: vi.fn() }))
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) chain[m] = vi.fn(() => chain)
  chain.then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data: store.remote, error: store.remoteError }).then(res)
  return { supabase: { from: vi.fn(() => chain) } }
})
vi.mock('../../lib/db', () => {
  const byDateDesc = (rs: LocalCalibrationRecord[]) => [...rs].sort((a, b) => b.performed_at.localeCompare(a.performed_at))
  return {
    db: {
      calibration_records: {
        where: vi.fn(() => ({
          equals: vi.fn(() => ({
            toArray: vi.fn(async () => store.local),
            reverse: vi.fn(() => ({ sortBy: vi.fn(async () => byDateDesc(store.local)) })),
          })),
        })),
        bulkPut: vi.fn(async () => undefined),
        update: vi.fn(async () => 1),
        bulkDelete: vi.fn(async () => undefined),
      },
      assets: { get: vi.fn(async (id: string) => store.assets[id]) },
      measurements: {
        where: vi.fn(() => ({
          equals: vi.fn((id: string) => ({ toArray: vi.fn(async () => store.measurements[id] ?? []) })),
          anyOf: vi.fn((ids: string[]) => ({ toArray: vi.fn(async () => ids.flatMap((id) => store.measurements[id] ?? [])) })),
        })),
        bulkDelete: vi.fn(async () => undefined),
      },
    },
  }
})

import CalibrationList from './CalibrationList'
import { useAuth } from '../../hooks/useAuth'
import { useCustomerFilter } from '../../hooks/useCustomerFilter'
import { apiRequest } from '../../lib/api/client'
import { db } from '../../lib/db'

const rec = (id: string, asset_id: string, status: LocalCalibrationRecord['status'], performed_at: string, extra: Partial<LocalCalibrationRecord> = {}): LocalCalibrationRecord => ({
  id, local_id: id, tenant_id: 't1', asset_id, technician_id: 'tech', status, performed_at, updated_at: performed_at, ...extra,
})

const meas = (record_id: string, pass: boolean): LocalMeasurement => ({ id: `${record_id}-m`, record_id, point_label: '50%', pass, error_pct: pass ? 0.1 : 3 })

function asRole(role: string, selectedCustomerId: string | null = null) {
  vi.mocked(useAuth).mockReturnValue({ profile: { id: 'u1', tenant_id: 't1', role, full_name: 'X' } } as never)
  vi.mocked(useCustomerFilter).mockReturnValue({ selectedCustomerId, setSelectedCustomerId: vi.fn(), customers: [] })
}

const checkbox = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

describe('CalibrationList with records', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.online = false
    store.remote = []
    store.remoteError = null
    store.local = [
      rec('r1', 'a1', 'pending_approval', '2026-10-03T00:00:00Z', { sales_number: 'SO-77' }),
      rec('r2', 'a2', 'pending_approval', '2026-10-02T00:00:00Z'),
      rec('r3', 'a3', 'approved', '2026-10-01T00:00:00Z'),
    ]
    store.assets = {
      a1: { tag_id: 'PT-1', serial_number: 'SN-AAA', customer_id: 'c1' },
      a2: { tag_id: 'PT-2', serial_number: 'SN-BBB', customer_id: 'c2' },
      a3: { tag_id: 'TT-3', customer_id: 'c1' },
    }
    store.measurements = { r1: [meas('r1', true)], r2: [meas('r2', false)] }
    asRole('supervisor')
  })
  afterEach(() => vi.restoreAllMocks())

  it('lists records with tag, status, sales number and overall result', async () => {
    renderPage(<CalibrationList />)
    expect(await screen.findByText('PT-1')).toBeTruthy()
    expect(screen.getByText('SO: SO-77')).toBeTruthy()
    expect(screen.getByText('PASS')).toBeTruthy()
    expect(screen.getByText('FAIL')).toBeTruthy()
    expect(screen.getAllByText('Pending Approval').length).toBeGreaterThan(1)
    expect(screen.getByText('Select all (3)')).toBeTruthy()
  })

  it('filters by status, by search on tag or serial, and by customer', async () => {
    renderPage(<CalibrationList />)
    await screen.findByText('PT-1')
    await userEvent.click(screen.getByRole('button', { name: /^approved$/i }))
    expect(screen.queryByText('PT-1')).toBeNull()
    expect(screen.getByText('TT-3')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^all$/i }))

    await userEvent.type(screen.getByPlaceholderText(/search by tag id/i), 'sn-bbb')
    expect(screen.getByText('PT-2')).toBeTruthy()
    expect(screen.queryByText('PT-1')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /clear search/i }))
    expect(screen.getByText('PT-1')).toBeTruthy()
  })

  it('applies the sidebar customer filter', async () => {
    asRole('supervisor', 'c2')
    renderPage(<CalibrationList />)
    expect(await screen.findByText('PT-2')).toBeTruthy()
    expect(screen.queryByText('PT-1')).toBeNull()
  })

  it('opens a record when clicked', async () => {
    renderPage(<CalibrationList />, { path: '/calibrations', route: '/calibrations' })
    await userEvent.click(await screen.findByText('PT-1'))
    expect(await screen.findByTestId('navigated')).toBeTruthy()
  })

  it('approves only what the server approved and keeps skipped records selected', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ approved: 1, skipped: ['r2'] })
    renderPage(<CalibrationList />)
    await screen.findByText('PT-1')
    await userEvent.click(checkbox('Select all'))
    expect(screen.getByText('3 selected')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))

    // only pending records are sent
    expect(apiRequest).toHaveBeenCalledWith('POST', '/calibrations/bulk/approve', { ids: ['r1', 'r2'] })
    expect(await screen.findByText(/1 of 2 not approved/)).toBeTruthy()
    expect(db.calibration_records.update).toHaveBeenCalledTimes(1)
    expect(db.calibration_records.update).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'approved' }))
    expect(screen.getByText('1 selected')).toBeTruthy()
    expect(checkbox('Select PT-2').checked).toBe(true)
    expect(checkbox('Select PT-1').checked).toBe(false)
  })

  it('clears the selection with no message when everything is approved', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ approved: 2 })
    renderPage(<CalibrationList />)
    await screen.findByText('PT-1')
    await userEvent.click(checkbox('Select PT-1'))
    await userEvent.click(checkbox('Select PT-2'))
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(db.calibration_records.update).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull())
    expect(screen.queryByText(/not approved/)).toBeNull()
  })

  it('shows the error and leaves local records alone when bulk approve fails', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('server unavailable'))
    renderPage(<CalibrationList />)
    await screen.findByText('PT-1')
    await userEvent.click(checkbox('Select PT-1'))
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('server unavailable')).toBeTruthy()
    expect(db.calibration_records.update).not.toHaveBeenCalled()
    expect(screen.getByText('1 selected')).toBeTruthy()
  })

  it('hides Approve when no pending record is selected', async () => {
    renderPage(<CalibrationList />)
    await screen.findByText('TT-3')
    await userEvent.click(checkbox('Select TT-3'))
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('deletes selected records and their measurements after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(apiRequest).mockResolvedValue(undefined)
    renderPage(<CalibrationList />)
    await screen.findByText('PT-1')
    await userEvent.click(checkbox('Select PT-1'))
    await userEvent.click(checkbox('Select PT-2'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Delete 2 calibration records/))
    await waitFor(() => expect(db.measurements.bulkDelete).toHaveBeenCalledWith(['r1-m', 'r2-m']))
    expect(apiRequest).toHaveBeenCalledWith('DELETE', '/calibrations/bulk', { ids: ['r1', 'r2'] })
    expect(db.calibration_records.bulkDelete).toHaveBeenCalledWith(['r1', 'r2'])
  })

  it('does nothing when deletion is not confirmed, and reports delete failures', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(apiRequest).mockRejectedValue(new Error('forbidden'))
    renderPage(<CalibrationList />)
    await screen.findByText('PT-1')
    await userEvent.click(checkbox('Select PT-1'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(apiRequest).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('forbidden')).toBeTruthy()
    expect(db.calibration_records.bulkDelete).not.toHaveBeenCalled()
  })

  it('gives technicians no bulk approve or delete', async () => {
    asRole('technician')
    renderPage(<CalibrationList />)
    await screen.findByText('PT-1')
    await userEvent.click(checkbox('Select PT-1'))
    expect(screen.getByText('1 selected')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('online: caches server records and keeps local-only (unsynced) ones', async () => {
    store.online = true
    store.remote = [rec('r9', 'a1', 'approved', '2026-10-05T00:00:00Z')]
    store.local = [rec('offline-1', 'a2', 'in_progress', '2026-10-06T00:00:00Z'), ...store.remote]
    renderPage(<CalibrationList />)
    expect(await screen.findByText('Select all (2)')).toBeTruthy()
    expect(db.calibration_records.bulkPut).toHaveBeenCalledWith(store.remote)
    const tags = screen.getAllByRole('checkbox').slice(1).map((c) => c.getAttribute('aria-label'))
    expect(tags).toEqual(['Select PT-2', 'Select PT-1'])
  })

  it('online: falls back to the local cache when the server query fails', async () => {
    store.online = true
    store.remoteError = new Error('timeout')
    renderPage(<CalibrationList />)
    expect(await screen.findByText('Select all (3)')).toBeTruthy()
    expect(db.calibration_records.bulkPut).not.toHaveBeenCalled()
  })
})
