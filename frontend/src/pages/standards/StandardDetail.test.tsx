import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../hooks/useStandards', () => ({ useStandards: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [] }).then(resolve),
    }),
  },
}))

import { useAuth } from '../../hooks/useAuth'
import { useStandards } from '../../hooks/useStandards'
import StandardDetail from './StandardDetail'

const supervisor = { id: 'u1', role: 'supervisor', tenant_id: 't1', full_name: 'Sue' }

const sampleStandard = {
  id: 's1',
  name: 'Ref Gauge A',
  serial_number: 'SN-001',
  manufacturer: 'Druck',
  model: 'DPI605',
  certificate_ref: 'CERT-1',
  calibrated_at: '2024-01-01',
  due_at: '2030-01-01',
  notes: '',
  tenant_id: 't1',
}

function renderPage(id = 's1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/standards/${id}`]}>
        <Routes>
          <Route path="/standards/:id" element={<StandardDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('StandardDetail', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile: supervisor } as never)
    mockNavigate.mockReset()
  })

  it('shows loading spinner while standards are loading', () => {
    vi.mocked(useStandards).mockReturnValue({ data: [], isLoading: true } as never)
    renderPage()
    expect(document.querySelector('.animate-spin')).toBeTruthy()
  })

  it('shows not-found state when standard does not exist', () => {
    vi.mocked(useStandards).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage('missing-id')
    expect(screen.getByText(/standard not found/i)).toBeTruthy()
  })

  it('renders the standard name in the heading', () => {
    vi.mocked(useStandards).mockReturnValue({ data: [sampleStandard], isLoading: false } as never)
    renderPage()
    expect(screen.getByRole('heading', { name: 'Ref Gauge A' })).toBeTruthy()
  })

  it('shows Valid status banner for a future due date', () => {
    vi.mocked(useStandards).mockReturnValue({ data: [sampleStandard], isLoading: false } as never)
    renderPage()
    expect(screen.getByText('Valid')).toBeTruthy()
  })

  it('shows Overdue status banner for a past due date', () => {
    const expired = { ...sampleStandard, due_at: '2020-01-01' }
    vi.mocked(useStandards).mockReturnValue({ data: [expired], isLoading: false } as never)
    renderPage()
    expect(screen.getByText('Overdue')).toBeTruthy()
  })

  it('shows Edit button for supervisor', () => {
    vi.mocked(useStandards).mockReturnValue({ data: [sampleStandard], isLoading: false } as never)
    renderPage()
    expect(screen.getByRole('link', { name: /edit/i })).toBeTruthy()
  })

  it('renders serial number and manufacturer', () => {
    vi.mocked(useStandards).mockReturnValue({ data: [sampleStandard], isLoading: false } as never)
    renderPage()
    expect(screen.getByText('SN-001')).toBeTruthy()
    expect(screen.getByText('Druck')).toBeTruthy()
  })
})
