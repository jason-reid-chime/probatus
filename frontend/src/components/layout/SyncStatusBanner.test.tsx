import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SyncStatusBanner from './SyncStatusBanner'

vi.mock('../../hooks/useOutboxCount')
vi.mock('../../lib/sync/outbox', () => ({ retryFailed: vi.fn(), flushOutbox: vi.fn().mockResolvedValue(undefined) }))

import { useOutboxCount } from '../../hooks/useOutboxCount'
import { retryFailed } from '../../lib/sync/outbox'

const empty  = { pending: 0, failed: 0 }
const onePending = { pending: 1, failed: 0 }
const fivePending = { pending: 5, failed: 0 }
const twoPending  = { pending: 2, failed: 0 }
const oneFailed   = { pending: 0, failed: 1 }
const threeFailed = { pending: 0, failed: 3 }

describe('SyncStatusBanner', () => {
  it('renders nothing when outbox is empty', () => {
    vi.mocked(useOutboxCount).mockReturnValue(empty)
    const { container } = render(<SyncStatusBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('shows singular pending message', () => {
    vi.mocked(useOutboxCount).mockReturnValue(onePending)
    render(<SyncStatusBanner />)
    expect(screen.getByRole('status')).toHaveTextContent('1 change pending sync')
  })

  it('shows plural pending message', () => {
    vi.mocked(useOutboxCount).mockReturnValue(fivePending)
    render(<SyncStatusBanner />)
    expect(screen.getByRole('status')).toHaveTextContent('5 changes pending sync')
  })

  it('pending banner has aria-live="polite"', () => {
    vi.mocked(useOutboxCount).mockReturnValue(twoPending)
    render(<SyncStatusBanner />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('shows failed banner when entries exceed retry limit', () => {
    vi.mocked(useOutboxCount).mockReturnValue(oneFailed)
    render(<SyncStatusBanner />)
    expect(screen.getByRole('alert')).toHaveTextContent('1 change failed to sync')
  })

  it('shows plural failed message', () => {
    vi.mocked(useOutboxCount).mockReturnValue(threeFailed)
    render(<SyncStatusBanner />)
    expect(screen.getByRole('alert')).toHaveTextContent('3 changes failed to sync')
  })

  it('retry button calls retryFailed', async () => {
    vi.mocked(useOutboxCount).mockReturnValue(oneFailed)
    render(<SyncStatusBanner />)
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(retryFailed).toHaveBeenCalled()
  })
})
