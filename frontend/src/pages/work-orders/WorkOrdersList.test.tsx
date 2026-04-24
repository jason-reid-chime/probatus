import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../hooks/useWorkOrders', () => ({
  useWorkOrders: vi.fn(),
  useDeleteWorkOrder: vi.fn().mockReturnValue({ mutateAsync: vi.fn() }),
}))
vi.mock('../../hooks/useCustomerFilter', () => ({
  useCustomerFilter: vi.fn().mockReturnValue({ customers: [], selectedCustomerId: null, setSelectedCustomerId: vi.fn() }),
}))

import { useAuth } from '../../hooks/useAuth'
import { useWorkOrders } from '../../hooks/useWorkOrders'
import WorkOrdersList from './WorkOrdersList'

const supervisor = { id: 'u1', role: 'supervisor', tenant_id: 't1', full_name: 'Sue' }

const sampleOrders = [
  {
    id: 'wo1', tenant_id: 't1', title: 'Pump Room Calibration', scheduled_date: '2026-05-01',
    status: 'open', customer_id: 'c1', notes: null, created_by: 'u1',
    created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z',
    customer: { name: 'Acme Lab' }, work_order_assets: [{ count: 3 }],
  },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WorkOrdersList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('WorkOrdersList', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile: supervisor } as never)
    mockNavigate.mockReset()
  })

  it('shows loading skeletons while fetching', () => {
    vi.mocked(useWorkOrders).mockReturnValue({ data: [], isLoading: true } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('shows empty state when no work orders', () => {
    vi.mocked(useWorkOrders).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(screen.getByText(/no work orders/i)).toBeTruthy()
  })

  it('renders work order rows', () => {
    vi.mocked(useWorkOrders).mockReturnValue({ data: sampleOrders, isLoading: false } as never)
    renderPage()
    expect(screen.getByText('Pump Room Calibration')).toBeTruthy()
    expect(screen.getByText(/acme lab/i)).toBeTruthy()
  })

  it('shows New Work Order button for supervisor', () => {
    vi.mocked(useWorkOrders).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(screen.getAllByRole('link', { name: /new work order/i }).length).toBeGreaterThan(0)
  })

  it('shows the page heading', () => {
    vi.mocked(useWorkOrders).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: /work orders/i })).toBeTruthy()
  })
})
