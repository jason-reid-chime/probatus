import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import CustomersList from './CustomersList'

const profile = { id: 'u1', tenant_id: 't1', role: 'admin', full_name: 'Admin' }

function makeChain(result: { data?: unknown; error?: unknown } = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const chain: Record<string, unknown> = {}
  ;['select', 'eq', 'order'].forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(resolved).then(resolve)
  return chain
}

function renderPage() {
  return render(<MemoryRouter><CustomersList /></MemoryRouter>)
}

describe('CustomersList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({ profile } as never)
  })

  it('shows loading state initially', () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain() as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('renders customer rows', async () => {
    const customers = [
      { id: 'c1', name: 'Acme Corp', address: '123 Main St', contact: 'John', created_at: '', assets: [{ count: 3 }] },
    ]
    vi.mocked(supabase.from).mockReturnValue(makeChain({ data: customers }) as never)
    renderPage()
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeTruthy())
    expect(screen.getByText('3 assets')).toBeTruthy()
  })

  it('shows empty state when no customers', async () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain({ data: [] }) as never)
    renderPage()
    await waitFor(() => expect(screen.getByText(/no customers/i)).toBeTruthy())
  })

  it('shows error when fetch fails', async () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain({ error: { message: 'db error' } }) as never)
    renderPage()
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeTruthy())
  })

  it('renders Add Customer link', async () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain({ data: [] }) as never)
    renderPage()
    await waitFor(() => expect(screen.getByText(/add customer/i)).toBeTruthy())
  })
})
