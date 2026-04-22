import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockNavigate = vi.fn()

vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser:  vi.fn().mockResolvedValue({ data: { user: null } }),
      signUp:   vi.fn(),
    },
    from: vi.fn(),
  },
}))

import { useAuth } from '../hooks/useAuth'
import Login from './Login'

function renderPage() {
  return render(<MemoryRouter><Login /></MemoryRouter>)
}

describe('Login', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ signIn: vi.fn() } as never)
    mockNavigate.mockReset()
  })

  it('renders the login form by default', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /sign in to your account/i })).toBeTruthy()
    expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy()
  })

  it('switches to signup form when sign up is clicked', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create your account/i })).toBeTruthy()
    })
    expect(screen.getByPlaceholderText(/jason reid/i)).toBeTruthy()
  })

  it('shows validation error when email is empty on submit', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeTruthy()
    })
  })
})
