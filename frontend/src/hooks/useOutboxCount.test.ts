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

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }),
    },
  },
}))

import { db } from '../lib/db'

function entry(retries: number, user_id: string | undefined = 'user-1', last_error?: string): OutboxEntry {
  return { method: 'PUT', url: '/assets/a', created_at: '', retries, user_id, last_error }
}

function makeEntries(pending: number, failed: number): OutboxEntry[] {
  return [
    ...Array.from({ length: pending }, () => entry(0)),
    ...Array.from({ length: failed }, () => entry(5)),
  ]
}

// getSession + toArray resolve over several microtasks
async function settle() {
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
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
    expect(result.current).toMatchObject({ pending: 0, failed: 0 })
  })

  it('reads pending and failed counts after mount', async () => {
    vi.mocked(db.outbox.toArray).mockResolvedValue(makeEntries(2, 1))
    const { result } = renderHook(() => useOutboxCount())
    await settle()
    expect(result.current).toMatchObject({ pending: 2, failed: 1 })
  })

  it("ignores other users' entries and counts orphans as failed", async () => {
    vi.mocked(db.outbox.toArray).mockResolvedValue([
      entry(0),
      entry(0, 'someone-else'),
      entry(5, 'someone-else'),
      { ...entry(0), user_id: undefined },   // legacy entry with no owner
    ])
    const { result } = renderHook(() => useOutboxCount())
    await settle()
    expect(result.current).toMatchObject({ pending: 1, failed: 1 })
  })

  it('exposes the latest failure message', async () => {
    vi.mocked(db.outbox.toArray).mockResolvedValue([entry(5, 'user-1', 'Error: 409: locked')])
    const { result } = renderHook(() => useOutboxCount())
    await settle()
    expect(result.current.lastError).toBe('Error: 409: locked')
  })

  it('polls every 3 seconds', async () => {
    vi.mocked(db.outbox.toArray)
      .mockResolvedValueOnce(makeEntries(1, 0))
      .mockResolvedValueOnce(makeEntries(0, 1))

    const { result } = renderHook(() => useOutboxCount())
    await settle()
    expect(result.current).toMatchObject({ pending: 1, failed: 0 })

    await act(async () => { vi.advanceTimersByTime(3000) })
    await settle()
    expect(result.current).toMatchObject({ pending: 0, failed: 1 })
  })

  it('clears the interval on unmount', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = renderHook(() => useOutboxCount())
    await settle()
    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
