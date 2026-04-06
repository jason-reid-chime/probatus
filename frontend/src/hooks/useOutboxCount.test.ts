import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOutboxCount } from './useOutboxCount'
import type { OutboxEntry } from '../lib/db'

vi.mock('../lib/db', () => ({
  db: {
    outbox: {
      toArray: vi.fn(),
    },
  },
}))

import { db } from '../lib/db'

function makeEntries(pending: number, failed: number): OutboxEntry[] {
  return [
    ...Array(pending).fill({ retries: 0, table: 'assets', operation: 'upsert', payload: {}, created_at: '' }),
    ...Array(failed).fill({ retries: 5, table: 'assets', operation: 'upsert', payload: {}, created_at: '' }),
  ]
}

describe('useOutboxCount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(db.outbox.toArray).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('initialises with zeroes', () => {
    const { result } = renderHook(() => useOutboxCount())
    expect(result.current).toEqual({ pending: 0, failed: 0 })
  })

  it('reads pending and failed counts after mount', async () => {
    vi.mocked(db.outbox.toArray).mockResolvedValue(makeEntries(2, 1))
    const { result } = renderHook(() => useOutboxCount())
    await act(async () => { await Promise.resolve() })
    expect(result.current).toEqual({ pending: 2, failed: 1 })
  })

  it('polls every 3 seconds', async () => {
    vi.mocked(db.outbox.toArray)
      .mockResolvedValueOnce(makeEntries(1, 0))
      .mockResolvedValueOnce(makeEntries(0, 1))

    const { result } = renderHook(() => useOutboxCount())
    await act(async () => { await Promise.resolve() })
    expect(result.current).toEqual({ pending: 1, failed: 0 })

    await act(async () => {
      vi.advanceTimersByTime(3000)
      await Promise.resolve()
    })
    expect(result.current).toEqual({ pending: 0, failed: 1 })
  })

  it('clears the interval on unmount', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = renderHook(() => useOutboxCount())
    await act(async () => { await Promise.resolve() })
    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
