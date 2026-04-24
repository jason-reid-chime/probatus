import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [] }).then(resolve),
    }),
  },
}))

import { useAuth } from '../../hooks/useAuth'
import CalendarView from './CalendarView'

const profile = { id: 'u1', role: 'supervisor', tenant_id: 't1', full_name: 'Sue' }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalendarView />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CalendarView', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile } as never)
  })

  it('renders the Calendar heading', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /calendar/i })).toBeTruthy()
  })

  it('renders month navigation arrows', () => {
    renderPage()
    expect(screen.getByLabelText(/previous month/i)).toBeTruthy()
    expect(screen.getByLabelText(/next month/i)).toBeTruthy()
  })

  it('renders Today button', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /today/i })).toBeTruthy()
  })

  it('shows empty state message when no assets due this month', async () => {
    renderPage()
    expect(await screen.findByText(/no calibrations due this month/i)).toBeTruthy()
  })

  it('renders legend', () => {
    renderPage()
    expect(screen.getByText(/overdue/i)).toBeTruthy()
    expect(screen.getByText(/due soon/i)).toBeTruthy()
  })
})
