import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
    rpc: vi.fn().mockResolvedValue({ error: null }),
  },
}))

import Signup from './Signup'

function renderPage() {
  return render(<MemoryRouter><Signup /></MemoryRouter>)
}

describe('Signup', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders sign up heading', () => {
    renderPage()
    expect(screen.getByText(/create your account/i) ?? screen.getByText(/sign up/i)).toBeTruthy()
  })

  it('renders PROBATUS logo', () => {
    renderPage()
    expect(screen.getByText('PROBATUS')).toBeTruthy()
  })

  it('shows validation error when submitting empty form', async () => {
    renderPage()
    const submitBtn = document.querySelector('button[type="submit"]')
    if (submitBtn) fireEvent.click(submitBtn)
    await waitFor(() => {
      expect(document.querySelector('p[class*="text-red"]') ?? screen.queryByText(/required/i)).toBeTruthy()
    })
  })

  it('has a link back to sign in', () => {
    renderPage()
    expect(screen.getByText(/sign in/i)).toBeTruthy()
  })
})
