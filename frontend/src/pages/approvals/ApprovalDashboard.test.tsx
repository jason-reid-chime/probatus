import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockNavigate = vi.fn()

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}))
vi.mock('../../lib/db', () => ({
  db: { calibration_records: { update: vi.fn() } },
}))
vi.mock('../../lib/api/client', () => ({ API_URL: 'http://localhost:8080' }))

import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import ApprovalDashboard from './ApprovalDashboard'

const supervisor = { id: '1', role: 'supervisor', tenant_id: 't1', full_name: 'Sue' }

function mockFrom(data: unknown[] = [], error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
    in: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
  vi.mocked(supabase.from).mockReturnValue(chain as never)
}

function renderPage() {
  return render(<MemoryRouter><ApprovalDashboard /></MemoryRouter>)
}

describe('ApprovalDashboard', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile: supervisor } as never)
    mockNavigate.mockReset()
  })

  it('shows loading skeletons initially', () => {
    mockFrom()
    renderPage()
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows empty state when no pending records', async () => {
    mockFrom([])
    renderPage()
    expect(await screen.findByText('All caught up')).toBeTruthy()
  })

  it('shows error with retry button on fetch failure', async () => {
    mockFrom([], { message: 'permission denied' })
    renderPage()
    expect(await screen.findByText('Failed to load approvals')).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('renders nothing for technician role', () => {
    vi.mocked(useAuth).mockReturnValue({
      profile: { ...supervisor, role: 'technician' },
    } as never)
    mockFrom()
    const { container } = renderPage()
    expect(container.firstChild).toBeNull()
  })
})
