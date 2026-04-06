import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../hooks/useStandards', () => ({
  useStandard:       vi.fn().mockReturnValue(null),
  useUpsertStandard: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isError: false }),
}))

import { useAuth } from '../../hooks/useAuth'
import { useStandard } from '../../hooks/useStandards'
import StandardForm from './StandardForm'

const supervisor = { id: 'u1', role: 'supervisor', tenant_id: 't1', full_name: 'Sue' }
const technician = { ...supervisor, role: 'technician' }

function renderPage(path = '/standards/new') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/standards/new"    element={<StandardForm />} />
          <Route path="/standards/:id/edit" element={<StandardForm />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('StandardForm', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ profile: supervisor } as never)
    vi.mocked(useStandard).mockReturnValue(null)
    mockNavigate.mockReset()
  })

  it('shows "New Master Standard" heading for a new standard', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /new master standard/i })).toBeTruthy()
  })

  it('renders all required form fields', () => {
    renderPage()
    // Labels don't carry htmlFor, so check by visible text
    expect(screen.getByText('Name', { exact: true })).toBeTruthy()
    expect(screen.getByText('Serial Number', { exact: true })).toBeTruthy()
    expect(screen.getByText('Calibrated At', { exact: true })).toBeTruthy()
    expect(screen.getByText('Due At', { exact: true })).toBeTruthy()
  })

  it('shows validation errors on empty submit', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(screen.getByText(/name is required/i)).toBeTruthy()
    })
    expect(screen.getByText(/serial number is required/i)).toBeTruthy()
  })

  it('redirects technicians away', () => {
    vi.mocked(useAuth).mockReturnValue({ profile: technician } as never)
    renderPage()
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('shows "Edit Standard" heading when editing an existing standard', () => {
    vi.mocked(useStandard).mockReturnValue({
      id: 's1', name: 'Ref Gauge', serial_number: 'SN-1',
      calibrated_at: '2024-01-01', due_at: '2026-01-01',
      model: '', manufacturer: '', certificate_ref: '', notes: '',
    } as never)
    renderPage('/standards/s1/edit')
    expect(screen.getByRole('heading', { name: /edit standard/i })).toBeTruthy()
  })
})
