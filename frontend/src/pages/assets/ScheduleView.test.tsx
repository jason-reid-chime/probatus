import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn().mockReturnValue({ profile: { id: 'u1', tenant_id: 't1', role: 'admin', full_name: 'Admin' } }),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
}))

const mockApiRequest = vi.fn().mockResolvedValue([])

vi.mock('../../lib/api/client', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}))

import ScheduleView from './ScheduleView'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScheduleView />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const SAMPLE_ASSETS = [
  {
    id: 'a1',
    tag_id: 'TAG-001',
    instrument_type: 'pressure',
    serial_number: 'SN1',
    manufacturer: 'Acme',
    model: 'X100',
    next_due_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    customer_name: 'Cust A',
  },
  {
    id: 'a2',
    tag_id: 'TAG-002',
    instrument_type: 'temperature',
    serial_number: null,
    manufacturer: 'Beta',
    model: 'Y200',
    next_due_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    customer_name: null,
  },
]

describe('ScheduleView empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiRequest.mockResolvedValue([])
  })

  it('renders page heading', () => {
    renderPage()
    expect(screen.getByText(/upcoming schedule/i)).toBeTruthy()
  })

  it('renders day filter buttons', () => {
    renderPage()
    expect(screen.getByText('30d')).toBeTruthy()
    expect(screen.getByText('60d')).toBeTruthy()
  })

  it('renders all day filter options', () => {
    renderPage()
    expect(screen.getByText('14d')).toBeTruthy()
    expect(screen.getByText('30d')).toBeTruthy()
    expect(screen.getByText('60d')).toBeTruthy()
    expect(screen.getByText('90d')).toBeTruthy()
  })

  it('shows empty state when no assets', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByText(/all caught up/i).length).toBeGreaterThan(0)
    })
  })

  it('shows no assets due message', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getAllByText(/no assets due within the next/i).length).toBeGreaterThan(0)
    })
  })
})

describe('ScheduleView with assets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiRequest.mockResolvedValue(SAMPLE_ASSETS)
  })

  it('renders asset tag IDs', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('TAG-001')).toBeTruthy()
      expect(screen.getByText('TAG-002')).toBeTruthy()
    })
  })

  it('renders manufacturer and model', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Acme X100')).toBeTruthy()
    })
  })

  it('renders customer name', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Cust A')).toBeTruthy()
    })
  })

  it('shows Select All checkbox row', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/select all/i)).toBeTruthy()
    })
  })

  it('selecting an asset shows the action bar', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    // Click on the first asset row (role=checkbox)
    const checkboxRows = document.querySelectorAll('[role="checkbox"]')
    // Second one is an asset row (first is select all)
    fireEvent.click(checkboxRows[1])
    await waitFor(() => {
      expect(screen.getByText(/asset selected/i)).toBeTruthy()
    })
  })

  it('Create Work Order button appears when asset selected', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    const checkboxRows = document.querySelectorAll('[role="checkbox"]')
    fireEvent.click(checkboxRows[1])
    await waitFor(() => {
      expect(screen.getByText(/create work order/i)).toBeTruthy()
    })
  })

  it('toggling same asset deselects it', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    const checkboxRows = document.querySelectorAll('[role="checkbox"]')
    fireEvent.click(checkboxRows[1])
    await waitFor(() => expect(screen.queryByText(/asset selected/i)).toBeTruthy())
    fireEvent.click(checkboxRows[1])
    await waitFor(() => {
      expect(screen.queryByText(/asset selected/i)).toBeFalsy()
    })
  })

  it('select all selects all assets', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    const selectAllRow = document.querySelectorAll('[role="checkbox"]')[0]
    fireEvent.click(selectAllRow)
    await waitFor(() => {
      expect(screen.getByText('2 assets selected')).toBeTruthy()
    })
  })

  it('changing day filter updates the query', async () => {
    renderPage()
    await waitFor(() => expect(screen.queryByText('TAG-001')).toBeTruthy())
    fireEvent.click(screen.getByText('60d'))
    expect(mockApiRequest).toHaveBeenCalledWith('GET', '/assets/schedule?days=60')
  })

  it('clicking 14d filter changes state', async () => {
    renderPage()
    fireEvent.click(screen.getByText('14d'))
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('GET', '/assets/schedule?days=14')
    })
  })

  it('renders Pressure instrument label', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Pressure')).toBeTruthy()
    })
  })

  it('renders Temperature instrument label', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Temperature')).toBeTruthy()
    })
  })
})
