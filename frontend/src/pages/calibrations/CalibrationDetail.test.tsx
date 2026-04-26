import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../hooks/useCalibration', () => ({
  useCalibrationRecord:    vi.fn(),
  useMeasurementsByRecord: vi.fn(),
  calibrationKeys:         { detail: (id: string) => ['calibrations', id] },
}))
vi.mock('../../lib/db', () => ({
  db: {
    outbox:               { filter: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }) },
    calibration_records:  { put: vi.fn(), update: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) },
    assets:               { get: vi.fn().mockResolvedValue(null) },
    measurements:         { where: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue({ delete: vi.fn().mockResolvedValue(undefined) }) }) },
  },
}))
vi.mock('../../lib/sync/outbox', () => ({
  enqueue:      vi.fn().mockResolvedValue(undefined),
  flushOutbox:  vi.fn().mockResolvedValue(undefined),
  retryFailed:  vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve),
    }),
  },
}))
vi.mock('../../lib/api/client', () => ({
  API_URL: 'http://localhost:8080',
  apiRequest: vi.fn().mockResolvedValue({}),
}))

import { useAuth } from '../../hooks/useAuth'
import { useCalibrationRecord, useMeasurementsByRecord } from '../../hooks/useCalibration'
import CalibrationDetail from './CalibrationDetail'

const supervisor = { id: 'u1', role: 'supervisor', tenant_id: 't1', full_name: 'Sue Supervisor' }

const baseRecord = {
  id: 'rec-1', asset_id: 'asset-1', tenant_id: 't1', technician_id: 'u1',
  status: 'in_progress', performed_at: new Date().toISOString(),
  sales_number: 'SO-100', flag_number: '', notes: '', local_id: '',
  tech_signature: '', supervisor_signature: '',
}

function renderPage(recordId = 'rec-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/calibrations/${recordId}`]}>
        <Routes>
          <Route path="/calibrations/:recordId" element={<CalibrationDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CalibrationDetail', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile: supervisor } as never)
    vi.mocked(useMeasurementsByRecord).mockReturnValue({ data: [], isLoading: false } as never)
  })

  it('shows loading state while record is fetching', () => {
    vi.mocked(useCalibrationRecord).mockReturnValue({ data: undefined, isLoading: true } as never)
    renderPage()
    expect(screen.getByText(/loading/i)).toBeTruthy()
  })

  it('shows not-found message when record is null', () => {
    vi.mocked(useCalibrationRecord).mockReturnValue({ data: undefined, isLoading: false } as never)
    renderPage()
    expect(screen.getByText(/calibration record not found/i)).toBeTruthy()
  })

  it('renders the heading and status badge for a loaded record', () => {
    vi.mocked(useCalibrationRecord).mockReturnValue({ data: baseRecord, isLoading: false } as never)
    renderPage()
    expect(screen.getByRole('heading', { name: /calibration record/i })).toBeTruthy()
    expect(screen.getByText(/in progress/i)).toBeTruthy()
  })

  it('shows Submit for Approval button when status is in_progress', () => {
    vi.mocked(useCalibrationRecord).mockReturnValue({ data: baseRecord, isLoading: false } as never)
    renderPage()
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeTruthy()
  })

  it('shows Approve button for supervisor when status is pending_approval', () => {
    vi.mocked(useCalibrationRecord).mockReturnValue({
      data: { ...baseRecord, status: 'pending_approval' }, isLoading: false,
    } as never)
    renderPage()
    expect(screen.getByRole('button', { name: /approve calibration/i })).toBeTruthy()
  })

  it('shows Download Certificate button when status is approved', () => {
    vi.mocked(useCalibrationRecord).mockReturnValue({
      data: { ...baseRecord, status: 'approved' }, isLoading: false,
    } as never)
    renderPage()
    expect(screen.getByRole('button', { name: /download certificate/i })).toBeTruthy()
  })

  it('does not show Approve button for technician even on pending_approval record', () => {
    vi.mocked(useAuth).mockReturnValue({ profile: { ...supervisor, role: 'technician' } } as never)
    vi.mocked(useCalibrationRecord).mockReturnValue({
      data: { ...baseRecord, status: 'pending_approval' }, isLoading: false,
    } as never)
    renderPage()
    expect(screen.queryByRole('button', { name: /approve calibration/i })).toBeNull()
  })

  it('shows pending approval status badge', () => {
    vi.mocked(useCalibrationRecord).mockReturnValue({
      data: { ...baseRecord, status: 'pending_approval' }, isLoading: false,
    } as never)
    renderPage()
    expect(screen.getByText(/pending approval/i)).toBeTruthy()
  })

  it('submit for approval button triggers outbox flush and API update', async () => {
    const { apiRequest } = await import('../../lib/api/client')
    const { flushOutbox, retryFailed } = await import('../../lib/sync/outbox')

    vi.mocked(useCalibrationRecord).mockReturnValue({ data: baseRecord, isLoading: false } as never)
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }))

    await waitFor(() => {
      expect(vi.mocked(retryFailed)).toHaveBeenCalled()
      expect(vi.mocked(flushOutbox)).toHaveBeenCalled()
      expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('GET', expect.stringContaining('rec-1'))
    })
  })

  it('approve button opens the supervisor signature modal', () => {
    vi.mocked(useCalibrationRecord).mockReturnValue({
      data: { ...baseRecord, status: 'pending_approval' }, isLoading: false,
    } as never)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /approve calibration/i }))
    expect(screen.getByText(/supervisor signature/i)).toBeTruthy()
  })
})
