import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOutboxCount } from './useOutboxCount'

// Mock the db module
vi.mock('../lib/db', () => ({
  db: {
    outbox: {
      count: vi.fn(),
    },
  },
}))

import { db } from '../lib/db'

describe('useOutboxCount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(db.outbox.count).mockResolvedValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('initialises to 0', () => {
    const { result } = renderHook(() => useOutboxCount())
    expect(result.current).toBe(0)
  })

  it('updates after initial async read', async () => {
    vi.mocked(db.outbox.count).mockResolvedValue(3)
    const { result } = renderHook(() => useOutboxCount())
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current).toBe(3)
  })

  it('polls every 3 seconds', async () => {
    vi.mocked(db.outbox.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)

    const { result } = renderHook(() => useOutboxCount())

    await act(async () => { await Promise.resolve() })
    expect(result.current).toBe(1)

    await act(async () => {
      vi.advanceTimersByTime(3000)
      await Promise.resolve()
    })
    expect(result.current).toBe(2)
  })

  it('clears the interval on unmount', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = renderHook(() => useOutboxCount())
    await act(async () => { await Promise.resolve() })
    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
