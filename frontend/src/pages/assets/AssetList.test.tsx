import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))
vi.mock('../../hooks/useAssets', () => ({ useAssets: vi.fn() }))
vi.mock('../../hooks/useCustomerFilter', () => ({
  useCustomerFilter: vi.fn().mockReturnValue({ customers: [], selectedCustomerId: null, setSelectedCustomerId: vi.fn() }),
}))
vi.mock('../../hooks/useQrScanner', () => ({
  useQrScanner: vi.fn().mockReturnValue({
    scannerRef: { current: null },
    startScanner: vi.fn(),
    stopScanner: vi.fn(),
    isScanning: false,
  }),
}))

import { useAssets } from '../../hooks/useAssets'
import AssetList from './AssetList'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AssetList />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const sampleAssets = [
  { id: 'a1', tag_id: 'TAG-001', manufacturer: 'Acme', model: 'M1', instrument_type: 'pressure', location: 'Plant A', next_due_at: undefined },
  { id: 'a2', tag_id: 'TAG-002', manufacturer: 'Beta', model: 'M2', instrument_type: 'temperature', location: 'Plant B', next_due_at: undefined },
]

describe('AssetList', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
  })

  it('renders the page heading', () => {
    vi.mocked(useAssets).mockReturnValue({ data: [], isLoading: false, isError: false } as never)
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: /^assets$/i })).toBeTruthy()
  })

  it('shows loading skeletons while fetching', () => {
    vi.mocked(useAssets).mockReturnValue({ data: undefined, isLoading: true, isError: false } as never)
    renderPage()
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows empty state when no assets exist', () => {
    vi.mocked(useAssets).mockReturnValue({ data: [], isLoading: false, isError: false } as never)
    renderPage()
    expect(screen.getByText(/no assets yet/i)).toBeTruthy()
  })

  it('renders asset rows when assets exist', () => {
    vi.mocked(useAssets).mockReturnValue({ data: sampleAssets, isLoading: false, isError: false } as never)
    renderPage()
    expect(screen.getByText('TAG-001')).toBeTruthy()
    expect(screen.getByText('TAG-002')).toBeTruthy()
  })

  it('filters assets by search query', () => {
    vi.mocked(useAssets).mockReturnValue({ data: sampleAssets, isLoading: false, isError: false } as never)
    renderPage()
    const input = screen.getByPlaceholderText(/search by tag id/i)
    fireEvent.change(input, { target: { value: 'TAG-001' } })
    expect(screen.getByText('TAG-001')).toBeTruthy()
    expect(screen.queryByText('TAG-002')).toBeNull()
  })
})
