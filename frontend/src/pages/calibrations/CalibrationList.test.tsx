import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockNavigate = vi.fn()

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  ;['select', 'eq', 'in', 'update', 'delete', 'order'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
  return {
    supabase: {
      from: vi.fn().mockReturnValue(chain),
      auth: { getSession: vi.fn() },
    },
  }
})
vi.mock('../../lib/db', () => ({
  db: {
    calibration_records: {
      where: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]), reverse: vi.fn().mockReturnValue({ sortBy: vi.fn().mockResolvedValue([]) }) }) }),
      bulkPut: vi.fn().mockResolvedValue(undefined),
    },
    assets: { get: vi.fn().mockResolvedValue(undefined) },
    measurements: { where: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) },
  },
}))
vi.mock('../../lib/sync/connectivity', () => ({ isOnline: vi.fn().mockReturnValue(false) }))

import { useAuth } from '../../hooks/useAuth'
import { useCustomerFilter } from '../../hooks/useCustomerFilter'
import CalibrationList from './CalibrationList'

vi.mock('../../hooks/useCustomerFilter', () => ({ useCustomerFilter: vi.fn() }))

const mockProfile = { id: 'u1', tenant_id: 'tenant-1', role: 'supervisor', full_name: 'Sup' }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalibrationList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CalibrationList', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile: mockProfile } as never)
    vi.mocked(useCustomerFilter).mockReturnValue({ selectedCustomerId: null, setSelectedCustomerId: vi.fn() } as never)
    mockNavigate.mockReset()
  })

  it('renders all status filter pills', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /^all$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /in progress/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /pending approval/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^approved$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /rejected/i })).toBeTruthy()
  })

  it('shows the page heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /calibrations/i })).toBeTruthy()
  })

  it('shows empty state message after loading completes with no records', async () => {
    renderPage()
    expect(await screen.findByText(/no calibrations found/i)).toBeTruthy()
  })

  it('shows search input', () => {
    renderPage()
    expect(screen.getByPlaceholderText(/search by tag id/i)).toBeTruthy()
  })

  it('does not show bulk action bar when nothing is selected', async () => {
    renderPage()
    await screen.findByText(/no calibrations found/i)
    expect(screen.queryByText(/selected/i)).toBeNull()
  })
})
