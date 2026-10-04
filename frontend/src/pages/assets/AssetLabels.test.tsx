import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderPage } from '../../test/render'

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'technician', tenant_id: 't1' } }) }))
vi.mock('../../hooks/useAssets', () => ({
  useAssets: () => ({
    isLoading: false,
    data: [
      { id: 'a1', tag_id: 'PT-1', instrument_type: 'pressure', manufacturer: 'Ashcroft', model: '1009', last_calibrated_at: '2026-01-15', next_due_at: '2027-01-15' },
      { id: 'a2', tag_id: 'TT-2', instrument_type: 'temperature', next_due_at: null },
    ],
  }),
}))
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: { name: 'Acme Cal' } }))
  return { supabase: { from: vi.fn(() => chain) } }
})
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn((text: string) => Promise.resolve(`data:image/png;base64,${btoa(text)}`)) } }))

import AssetLabels from './AssetLabels'
import QRCode from 'qrcode'

describe('AssetLabels', () => {
  it('renders one label per selected asset with a QR that opens it', async () => {
    renderPage(<AssetLabels />, { path: '/assets/labels?ids=a1', route: '/assets/labels' })
    const labels = await screen.findAllByTestId('asset-label')
    expect(labels).toHaveLength(1)
    expect(labels[0].textContent).toMatch(/PT-1/)
    expect(labels[0].textContent).toMatch(/Ashcroft 1009/)
    expect(labels[0].textContent).toMatch(/DUE:/)
    await waitFor(() => expect(screen.getByAltText('QR code for PT-1')).toBeTruthy())
    expect(vi.mocked(QRCode.toDataURL).mock.calls[0][0]).toMatch(/\/assets\/a1$/)
    expect(await screen.findByText('Acme Cal')).toBeTruthy()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    expect(print).toHaveBeenCalled()
  })

  it('labels every asset when none are selected and switches format', async () => {
    renderPage(<AssetLabels />, { path: '/assets/labels', route: '/assets/labels' })
    expect(await screen.findAllByTestId('asset-label')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Label format'), { target: { value: 'sheet' } })
    expect(screen.getByText(/2 labels/)).toBeTruthy()
    expect(screen.getAllByTestId('asset-label')[1].textContent).toMatch(/temperature/)
  })
})
