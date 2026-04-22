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
vi.mock('../../hooks/useStandards', () => ({
  useStandards: vi.fn(),
  useDeleteStandard: vi.fn().mockReturnValue({ mutateAsync: vi.fn() }),
}))

import { useAuth } from '../../hooks/useAuth'
import { useStandards } from '../../hooks/useStandards'
import StandardsList from './StandardsList'

const supervisor = { id: 'u1', role: 'supervisor', tenant_id: 't1', full_name: 'Sue' }
const technician = { ...supervisor, role: 'technician' }

const sampleStandards = [
  { id: 's1', name: 'Ref Gauge A', serial_number: 'SN-001', manufacturer: 'Druck', model: 'DPI605', certificate_ref: 'CERT-1', calibrated_at: '2024-01-01', due_at: '2026-01-01', notes: '' },
  { id: 's2', name: 'Thermometer B', serial_number: 'SN-002', manufacturer: 'Fluke', model: '52 II', certificate_ref: 'CERT-2', calibrated_at: '2024-06-01', due_at: '2025-06-01', notes: '' },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StandardsList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('StandardsList', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile: supervisor } as never)
    mockNavigate.mockReset()
  })

  it('renders the page heading for supervisors', () => {
    vi.mocked(useStandards).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(screen.getByRole('heading', { name: /master standards/i })).toBeTruthy()
  })

  it('shows loading skeletons while fetching', () => {
    vi.mocked(useStandards).mockReturnValue({ data: [], isLoading: true } as never)
    renderPage()
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows empty state when no standards exist', () => {
    vi.mocked(useStandards).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(screen.getByText(/no master standards yet/i)).toBeTruthy()
  })

  it('renders standard rows when standards exist', () => {
    vi.mocked(useStandards).mockReturnValue({ data: sampleStandards, isLoading: false } as never)
    renderPage()
    expect(screen.getByText('Ref Gauge A')).toBeTruthy()
    expect(screen.getByText('Thermometer B')).toBeTruthy()
  })

  it('redirects technicians away from the page', () => {
    vi.mocked(useAuth).mockReturnValue({ profile: technician } as never)
    vi.mocked(useStandards).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
  })
})
