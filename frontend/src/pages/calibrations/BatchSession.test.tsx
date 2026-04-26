import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn().mockReturnValue({ profile: { id: 'u1', tenant_id: 't1', role: 'technician', full_name: 'Tech' } }),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }) }) }) },
}))
vi.mock('../../lib/api/client', () => ({ apiRequest: vi.fn() }))

import BatchSession from './BatchSession'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BatchSession />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BatchSession', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders page heading', () => {
    renderPage()
    expect(screen.getByText(/batch calibration session/i)).toBeTruthy()
  })

  it('renders the page without crashing', () => {
    const { container } = renderPage()
    expect(container.firstChild).toBeTruthy()
  })

  it('renders step indicator text', () => {
    renderPage()
    expect(screen.queryAllByText(/select assets/i).length).toBeGreaterThan(0)
  })
})
