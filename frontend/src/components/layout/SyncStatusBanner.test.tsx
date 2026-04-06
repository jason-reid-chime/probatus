import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SyncStatusBanner from './SyncStatusBanner'

vi.mock('../../hooks/useOutboxCount')
import { useOutboxCount } from '../../hooks/useOutboxCount'

describe('SyncStatusBanner', () => {
  it('renders nothing when outbox is empty', () => {
    vi.mocked(useOutboxCount).mockReturnValue(0)
    const { container } = render(<SyncStatusBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('shows singular message for 1 pending change', () => {
    vi.mocked(useOutboxCount).mockReturnValue(1)
    render(<SyncStatusBanner />)
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 change saved offline — will sync when connected',
    )
  })

  it('shows plural message for multiple pending changes', () => {
    vi.mocked(useOutboxCount).mockReturnValue(5)
    render(<SyncStatusBanner />)
    expect(screen.getByRole('status')).toHaveTextContent(
      '5 changes saved offline — will sync when connected',
    )
  })

  it('has aria-live="polite" for accessibility', () => {
    vi.mocked(useOutboxCount).mockReturnValue(2)
    render(<SyncStatusBanner />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })
})
