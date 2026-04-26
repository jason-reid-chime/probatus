import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn().mockReturnValue({ profile: { id: 'u1', tenant_id: 't1', role: 'technician', full_name: 'Tech' } }),
}))

const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null })
const mockEq = vi.fn().mockReturnValue({ order: mockOrder })
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect })

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}))
vi.mock('../../lib/api/client', () => ({ apiRequest: vi.fn().mockResolvedValue({ id: 'cal1' }) }))

import BatchSession from './BatchSession'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BatchSession />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const SAMPLE_ASSETS = [
  { id: 'a1', tag_id: 'TAG-001', instrument_type: 'pressure', serial_number: 'SN1', manufacturer: 'Acme', model: 'X100', customers: { name: 'Cust A' } },
  { id: 'a2', tag_id: 'TAG-002', instrument_type: 'temperature', serial_number: null, manufacturer: null, model: null, customers: null },
]

describe('BatchSession empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOrder.mockResolvedValue({ data: [], error: null })
  })

  it('renders page heading', () => {
    renderPage()
    expect(screen.getByText(/batch calibration session/i)).toBeTruthy()
  })

  it('renders the page without crashing', () => {
    const { container } = renderPage()
    expect(container.firstChild).toBeTruthy()
  })

  it('renders step indicator text', () => {
    renderPage()
    expect(screen.queryAllByText(/select assets/i).length).toBeGreaterThan(0)
  })

  it('renders step 1 and step 2 indicators', () => {
    renderPage()
    expect(screen.getByText(/1\. Select Assets/i)).toBeTruthy()
    expect(screen.getByText(/2\. Configure/i)).toBeTruthy()
  })

  it('renders Configure Session button disabled when no assets selected', async () => {
    renderPage()
    await waitFor(() => {
      const configBtn = screen.getByText(/configure session/i).closest('button')
      expect(configBtn?.disabled).toBe(true)
    })
  })

  it('renders back button', () => {
    renderPage()
    const backBtn = document.querySelector('[aria-label="Go back"]')
    expect(backBtn).toBeTruthy()
  })

  it('renders search input', async () => {
    renderPage()
    await waitFor(() => {
      const searchInput = document.querySelector('input[type="search"]')
      expect(searchInput).toBeTruthy()
    })
  })

  it('renders Select All Visible button', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/select all visible/i)).toBeTruthy()
    })
  })

  it('shows assets selected label in assets selected area', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/assets selected/i)).toBeTruthy()
    })
  })
})

describe('BatchSession with assets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOrder.mockResolvedValue({ data: SAMPLE_ASSETS, error: null })
  })

  it('renders assets after loading', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('TAG-001')).toBeTruthy()
    })
  })

  it('can select an asset and enable the configure button', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    const checkboxes = document.querySelectorAll('input[type="checkbox"]')
    fireEvent.click(checkboxes[0])
    const configBtn = screen.getByText(/configure session/i).closest('button')
    expect(configBtn?.disabled).toBe(false)
  })

  it('can search and filter assets', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement
    fireEvent.change(searchInput, { target: { value: 'TAG-002' } })
    expect(screen.queryByText('TAG-001')).toBeFalsy()
    expect(screen.queryByText('TAG-002')).toBeTruthy()
  })

  it('can clear search', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement
    fireEvent.change(searchInput, { target: { value: 'TAG-002' } })
    const clearBtn = document.querySelector('[aria-label="Clear search"]')
    expect(clearBtn).toBeTruthy()
    fireEvent.click(clearBtn!)
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
  })

  it('advances to configure step after selecting asset', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    const checkboxes = document.querySelectorAll('input[type="checkbox"]')
    fireEvent.click(checkboxes[0])
    const configBtn = screen.getByText(/configure session/i).closest('button')!
    fireEvent.click(configBtn)
    await waitFor(() => {
      expect(screen.getByText('Session Details')).toBeTruthy()
    })
  })

  it('configure step shows Back and Create Session buttons', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    const checkboxes = document.querySelectorAll('input[type="checkbox"]')
    fireEvent.click(checkboxes[0])
    fireEvent.click(screen.getByText(/configure session/i).closest('button')!)
    await waitFor(() => expect(screen.getByText('Session Details')).toBeTruthy())
    expect(screen.getByText('Back')).toBeTruthy()
    expect(screen.getByText('Create Session')).toBeTruthy()
  })

  it('back button on configure step returns to select step', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    const checkboxes = document.querySelectorAll('input[type="checkbox"]')
    fireEvent.click(checkboxes[0])
    fireEvent.click(screen.getByText(/configure session/i).closest('button')!)
    await waitFor(() => expect(screen.getByText('Back')).toBeTruthy())
    fireEvent.click(screen.getByText('Back'))
    await waitFor(() => expect(screen.getByText(/select all visible/i)).toBeTruthy())
  })

  it('shows no assets match when search has no results', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement
    fireEvent.change(searchInput, { target: { value: 'NOMATCH99999' } })
    expect(screen.getByText(/no assets match your search/i)).toBeTruthy()
  })

  it('select all visible toggles all assets', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    fireEvent.click(screen.getByText(/select all visible/i).closest('button')!)
    // Both assets should now be selected - badge should show 2
    const badge = document.querySelector('.rounded-full.bg-brand-500')
    expect(badge?.textContent).toBe('2')
  })

  it('shows asset manufacturer and model info', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Acme · X100')).toBeTruthy()
    })
  })

  it('shows customer name for assets with customer', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Cust A')).toBeTruthy()
    })
  })

  it('renders instrument badge with correct label', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('pressure')).toBeTruthy()
    })
  })
})
