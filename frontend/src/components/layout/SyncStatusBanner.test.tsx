import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SyncStatusBanner from './SyncStatusBanner'

vi.mock('../../hooks/useOutboxCount')
vi.mock('../../lib/sync/outbox', () => ({
  retryFailed: vi.fn().mockResolvedValue(undefined),
  flushOutbox: vi.fn().mockResolvedValue(undefined),
  clearFailed: vi.fn().mockResolvedValue(undefined),
  clearAllOutbox: vi.fn().mockResolvedValue(undefined),
}))

import { useOutboxCount } from '../../hooks/useOutboxCount'
import { retryFailed, clearFailed, clearAllOutbox, flushOutbox } from '../../lib/sync/outbox'

const refresh = vi.fn().mockResolvedValue(undefined)
const empty  = { pending: 0, failed: 0, refresh }
const onePending = { pending: 1, failed: 0, refresh }
const fivePending = { pending: 5, failed: 0, refresh }
const twoPending  = { pending: 2, failed: 0, refresh }
const oneFailed   = { pending: 0, failed: 1, refresh }
const threeFailed = { pending: 0, failed: 3, refresh }

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

  it('discard asks for inline confirmation, then calls clearFailed', async () => {
    vi.mocked(useOutboxCount).mockReturnValue(oneFailed)
    render(<SyncStatusBanner />)
    await userEvent.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(clearFailed).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /yes, discard/i }))
    expect(clearFailed).toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
  })

  it('cancel on the inline confirmation discards nothing', async () => {
    vi.mocked(useOutboxCount).mockReturnValue(onePending)
    render(<SyncStatusBanner />)
    await userEvent.click(screen.getByRole('button', { name: /discard all/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(clearAllOutbox).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /sync now/i })).toBeTruthy()
  })

  it('sync now flushes and refreshes the counts', async () => {
    vi.mocked(useOutboxCount).mockReturnValue(onePending)
    render(<SyncStatusBanner />)
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }))
    expect(flushOutbox).toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the last error on the failed banner', () => {
    vi.mocked(useOutboxCount).mockReturnValue({ ...oneFailed, lastError: 'Error: 409: calibration is approved' })
    render(<SyncStatusBanner />)
    expect(screen.getByRole('alert')).toHaveTextContent('409: calibration is approved')
  })

  it('shows sync now and discard all when pending', () => {
    vi.mocked(useOutboxCount).mockReturnValue(onePending)
    render(<SyncStatusBanner />)
    expect(screen.getByRole('button', { name: /sync now/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /discard all/i })).toBeTruthy()
  })
})
