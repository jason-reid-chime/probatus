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
  ;['select', 'eq', 'maybeSingle', 'upsert', 'insert', 'single'].forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain) })
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

function renderEdit(id = 'c1') {
  return render(
    <MemoryRouter initialEntries={[`/customers/${id}/edit`]}>
      <Routes>
        <Route path="/customers/:id/edit" element={<CustomerForm />} />
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

  it('cancel button navigates back', () => {
    renderNew()
    fireEvent.click(screen.getByText(/cancel/i))
    expect(mockNavigate).toHaveBeenCalledWith(-1)
  })

  it('shows submit error when upsert fails', async () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain({ error: { message: 'db error' } }) as never)
    renderNew()
    fireEvent.change(document.querySelector('input[name="name"]')!, { target: { value: 'Acme Corp' } })
    fireEvent.click(screen.getByText(/create customer/i))
    await waitFor(() => expect(screen.getByText(/db error/i)).toBeTruthy())
  })

  it('shows loading skeleton in edit mode', async () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain({ data: { id: 'c1', name: 'Acme', address: '123 Main', contact: 'Jane' } }) as never)
    renderEdit()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.animate-pulse')).toBeFalsy())
  })

  it('pre-fills form fields in edit mode', async () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain({ data: { id: 'c1', name: 'Acme', address: '123 Main', contact: 'Jane' } }) as never)
    renderEdit()
    await waitFor(() => expect((document.querySelector('input[name="name"]') as HTMLInputElement)?.value).toBe('Acme'))
    expect((document.querySelector('input[name="contact"]') as HTMLInputElement)?.value).toBe('Jane')
  })

  it('shows Save Changes button in edit mode', async () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain({ data: { id: 'c1', name: 'Acme', address: '', contact: '' } }) as never)
    renderEdit()
    await waitFor(() => expect(screen.getByText(/save changes/i)).toBeTruthy())
  })
})
