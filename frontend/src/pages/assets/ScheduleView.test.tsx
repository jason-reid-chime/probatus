import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn().mockReturnValue({ profile: { id: 'u1', tenant_id: 't1', role: 'admin', full_name: 'Admin' } }),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
}))
vi.mock('../../lib/api/client', () => ({
  apiRequest: vi.fn().mockResolvedValue([]),
}))

import ScheduleView from './ScheduleView'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScheduleView />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ScheduleView', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders page heading', () => {
    renderPage()
    expect(screen.getByText(/upcoming schedule/i)).toBeTruthy()
  })

  it('renders day filter buttons', () => {
    renderPage()
    expect(screen.getByText('30d')).toBeTruthy()
    expect(screen.getByText('60d')).toBeTruthy()
  })
})
