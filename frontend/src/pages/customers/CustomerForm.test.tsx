import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import CustomerForm from './CustomerForm'

const profile = { id: 'u1', tenant_id: 't1', role: 'admin', full_name: 'Admin' }

function makeChain(result: { data?: unknown; error?: unknown } = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const chain: Record<string, unknown> = {}
  ;['select', 'eq', 'maybeSingle', 'upsert', 'insert'].forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(resolved).then(resolve)
  return chain
}

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/customers/new']}>
      <Routes>
        <Route path="/customers/new" element={<CustomerForm />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CustomerForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({ profile } as never)
  })

  it('renders the name field', () => {
    renderNew()
    expect(document.querySelector('input[name="name"]')).toBeTruthy()
  })

  it('shows validation error when name is empty on submit', async () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain() as never)
    renderNew()
    fireEvent.click(screen.getByText(/create customer/i))
    await waitFor(() => expect(screen.getByText(/name is required/i)).toBeTruthy())
  })

  it('navigates to /customers on successful save', async () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain({ data: { id: 'c1', name: 'Acme' } }) as never)
    renderNew()
    fireEvent.change(document.querySelector('input[name="name"]')!, { target: { value: 'Acme Corp' } })
    fireEvent.click(screen.getByText(/create customer/i))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/customers'))
  })

  it('back button navigates back', () => {
    renderNew()
    fireEvent.click(screen.getByLabelText(/go back/i))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })
})
