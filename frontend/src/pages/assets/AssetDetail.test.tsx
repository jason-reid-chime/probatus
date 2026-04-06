import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}))
vi.mock('../../hooks/useAssets', () => ({ useAsset: vi.fn() }))

import { useAsset } from '../../hooks/useAssets'
import AssetDetail from './AssetDetail'

const sampleAsset = {
  id: 'a1', tag_id: 'TAG-007', tenant_id: 't1',
  manufacturer: 'Acme', model: 'X100', instrument_type: 'pressure',
  serial_number: 'SN-XYZ', location: 'Pump Room', notes: 'Handle with care',
  range_min: 0, range_max: 100, range_unit: 'psi',
  calibration_interval_days: 365,
  next_due_at: undefined, last_calibrated_at: undefined,
}

function renderPage(id = 'a1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/assets/${id}`]}>
        <Routes>
          <Route path="/assets/:id" element={<AssetDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AssetDetail', () => {
  beforeEach(() => mockNavigate.mockReset())

  it('shows loading spinner while fetching', () => {
    vi.mocked(useAsset).mockReturnValue({ data: undefined, isLoading: true, isError: false } as never)
    renderPage()
    expect(document.querySelector('.animate-spin')).toBeTruthy()
  })

  it('shows not-found state when asset is null', () => {
    vi.mocked(useAsset).mockReturnValue({ data: undefined, isLoading: false, isError: true } as never)
    renderPage()
    expect(screen.getByRole('heading', { name: /asset not found/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /back to assets/i })).toBeTruthy()
  })

  it('renders the asset tag_id as the page heading', () => {
    vi.mocked(useAsset).mockReturnValue({ data: sampleAsset, isLoading: false, isError: false } as never)
    renderPage()
    expect(screen.getByRole('heading', { name: 'TAG-007' })).toBeTruthy()
  })

  it('shows the instrument type label', () => {
    vi.mocked(useAsset).mockReturnValue({ data: sampleAsset, isLoading: false, isError: false } as never)
    renderPage()
    expect(screen.getAllByText(/pressure/i).length).toBeGreaterThan(0)
  })

  it('shows the location detail row', () => {
    vi.mocked(useAsset).mockReturnValue({ data: sampleAsset, isLoading: false, isError: false } as never)
    renderPage()
    expect(screen.getByText('Pump Room')).toBeTruthy()
  })
})
