import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../lib/api/dashboard', () => ({
  fetchDashboardStats: vi.fn(),
  fetchOverdueAssets:  vi.fn(),
  fetchDueSoonAssets:  vi.fn(),
}))

import { useAuth } from '../hooks/useAuth'
import * as dashboardApi from '../lib/api/dashboard'
import Dashboard from './Dashboard'

const mockProfile = { full_name: 'Jason Reid', tenant_id: 't1', role: 'supervisor' }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile: mockProfile } as never)
  })

  it('shows a greeting with the user first name', async () => {
    vi.mocked(dashboardApi.fetchDashboardStats).mockResolvedValue({
      overdue_count: 0, due_within_30: 0, due_within_90: 0,
      standards_expiring_soon: 0, pass_rate_30d: 0,
    })
    vi.mocked(dashboardApi.fetchOverdueAssets).mockResolvedValue([])
    vi.mocked(dashboardApi.fetchDueSoonAssets).mockResolvedValue([])

    renderPage()
    // Greeting uses the first token of full_name
    expect(await screen.findByText(/Jason/)).toBeTruthy()
  })

  it('renders loading skeletons while stats are fetching', () => {
    // Never resolves — keeps component in loading state
    vi.mocked(dashboardApi.fetchDashboardStats).mockReturnValue(new Promise(() => {}))
    vi.mocked(dashboardApi.fetchOverdueAssets).mockReturnValue(new Promise(() => {}))
    vi.mocked(dashboardApi.fetchDueSoonAssets).mockReturnValue(new Promise(() => {}))

    renderPage()
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows error state with retry button when stats fail', async () => {
    vi.mocked(dashboardApi.fetchDashboardStats).mockRejectedValue(new Error('network error'))
    vi.mocked(dashboardApi.fetchOverdueAssets).mockResolvedValue([])
    vi.mocked(dashboardApi.fetchDueSoonAssets).mockResolvedValue([])

    renderPage()
    expect(await screen.findByText(/could not load dashboard data/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })
})
