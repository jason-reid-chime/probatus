import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OutboxEntry } from '../db/index'

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported
// ---------------------------------------------------------------------------

vi.mock('../db/index', () => ({
  db: {
    outbox: {
      add:        vi.fn(),
      orderBy:    vi.fn(),
      filter:     vi.fn(),
      delete:     vi.fn(),
      update:     vi.fn(),
      bulkDelete: vi.fn(),
    },
  },
}))

vi.mock('../supabase/index', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'user-1' } } } }),
    },
  },
}))

import { db } from '../db/index'
import { enqueue, flushOutbox, retryFailed, clearAllOutbox, OUTBOX_FLUSHED_EVENT } from './outbox'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 1,
    method: 'POST',
    url: '/calibrations',
    body: { id: 'asset-1' },
    created_at: '2026-01-01T00:00:00.000Z',
    retries: 0,
    user_id: 'user-1',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

describe('enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.outbox.add).mockResolvedValue(1)
  })

  it('calls db.outbox.add with retries=0 and a created_at timestamp', async () => {
    const before = Date.now()
    await enqueue({ method: 'POST', url: '/calibrations', body: { id: 'a1' } })
    const after = Date.now()

    expect(db.outbox.add).toHaveBeenCalledOnce()
    const arg = vi.mocked(db.outbox.add).mock.calls[0][0] as OutboxEntry

    expect(arg.retries).toBe(0)
    expect(arg.user_id).toBe('user-1')
    expect(arg.method).toBe('POST')
    expect(arg.url).toBe('/calibrations')
    expect(arg.body).toEqual({ id: 'a1' })

    // created_at should be a valid ISO string within the test window
    const ts = new Date(arg.created_at).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('does not include an id field in the payload passed to add', async () => {
    await enqueue({ method: 'DELETE', url: '/calibrations/r1' })
    const arg = vi.mocked(db.outbox.add).mock.calls[0][0] as OutboxEntry
    expect(arg.id).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// flushOutbox
// ---------------------------------------------------------------------------

describe('flushOutbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.outbox.delete).mockResolvedValue(undefined)
    vi.mocked(db.outbox.update).mockResolvedValue(1)
  })

  it('does nothing when the outbox is empty', async () => {
    const orderByChain = { toArray: vi.fn().mockResolvedValue([]) }
    vi.mocked(db.outbox.orderBy).mockReturnValue(orderByChain as never)

    await flushOutbox()

    expect(db.outbox.orderBy).toHaveBeenCalledWith('id')
    expect(db.outbox.delete).not.toHaveBeenCalled()
  })

  it('processes entries in FIFO order and deletes successful ones', async () => {
    const entries = [
      makeEntry({ id: 1, method: 'POST', url: '/calibrations' }),
      makeEntry({ id: 2, method: 'PUT',  url: '/calibrations/abc' }),
    ]
    const orderByChain = { toArray: vi.fn().mockResolvedValue(entries) }
    vi.mocked(db.outbox.orderBy).mockReturnValue(orderByChain as never)

    // Mock global fetch to succeed
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response)

    await flushOutbox()

    // Both successfully deleted
    expect(db.outbox.delete).toHaveBeenCalledTimes(2)
    expect(db.outbox.delete).toHaveBeenNthCalledWith(1, 1)
    expect(db.outbox.delete).toHaveBeenNthCalledWith(2, 2)
  })

  it('increments retries on failure instead of deleting', async () => {
    const entry = makeEntry({ id: 3, retries: 1 })
    const orderByChain = { toArray: vi.fn().mockResolvedValue([entry]) }
    vi.mocked(db.outbox.orderBy).mockReturnValue(orderByChain as never)

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: vi.fn().mockResolvedValue('network error'),
    } as unknown as Response)

    await flushOutbox()

    expect(db.outbox.delete).not.toHaveBeenCalled()
    expect(db.outbox.update).toHaveBeenCalledWith(3, {
      retries: 2,
      last_error: expect.stringContaining('network error'),
    })
  })

  it('skips entries that have reached MAX_RETRIES (5)', async () => {
    const deadEntry = makeEntry({ id: 10, retries: 5 })
    const orderByChain = { toArray: vi.fn().mockResolvedValue([deadEntry]) }
    vi.mocked(db.outbox.orderBy).mockReturnValue(orderByChain as never)

    globalThis.fetch = vi.fn()

    await flushOutbox()

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(db.outbox.delete).not.toHaveBeenCalled()
    expect(db.outbox.update).not.toHaveBeenCalled()
  })

  it('handles a DELETE operation correctly', async () => {
    const entry = makeEntry({ id: 5, method: 'DELETE', url: '/calibrations/a-del' })
    const orderByChain = { toArray: vi.fn().mockResolvedValue([entry]) }
    vi.mocked(db.outbox.orderBy).mockReturnValue(orderByChain as never)

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response)

    await flushOutbox()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/calibrations/a-del'),
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(db.outbox.delete).toHaveBeenCalledWith(5)
  })

  it('continues processing remaining entries after one fails', async () => {
    const entry1 = makeEntry({ id: 11, retries: 0 })
    const entry2 = makeEntry({ id: 12, retries: 0 })
    const orderByChain = { toArray: vi.fn().mockResolvedValue([entry1, entry2]) }
    vi.mocked(db.outbox.orderBy).mockReturnValue(orderByChain as never)

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'fail',
        text: vi.fn().mockResolvedValue('fail'),
      } as unknown as Response)
      .mockResolvedValueOnce({ ok: true } as Response)

    await flushOutbox()

    // entry1 fails → retries incremented
    expect(db.outbox.update).toHaveBeenCalledWith(11, { retries: 1, last_error: expect.any(String) })
    // entry2 succeeds → deleted
    expect(db.outbox.delete).toHaveBeenCalledWith(12)
  })
})

// ---------------------------------------------------------------------------
// flushOutbox — sync guarantees
// ---------------------------------------------------------------------------

describe('flushOutbox guarantees', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.outbox.delete).mockResolvedValue(undefined)
    vi.mocked(db.outbox.update).mockResolvedValue(1)
  })

  function queue(entries: OutboxEntry[]) {
    vi.mocked(db.outbox.orderBy).mockReturnValue({ toArray: vi.fn().mockResolvedValue(entries) } as never)
  }

  it("never replays another user's or an ownerless entry", async () => {
    queue([
      makeEntry({ id: 1, user_id: 'someone-else' }),
      makeEntry({ id: 2, user_id: undefined }),
      makeEntry({ id: 3 }),
    ])
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true } as Response)

    await flushOutbox()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(db.outbox.delete).toHaveBeenCalledWith(3)
    expect(db.outbox.delete).not.toHaveBeenCalledWith(1)
    expect(db.outbox.delete).not.toHaveBeenCalledWith(2)
  })

  it('aborts on a network error without burning retries', async () => {
    queue([makeEntry({ id: 1 }), makeEntry({ id: 2 })])
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    await flushOutbox()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(db.outbox.update).not.toHaveBeenCalled()
    expect(db.outbox.delete).not.toHaveBeenCalled()
  })

  it('fails a refused change (409) immediately instead of retrying 5 times', async () => {
    queue([makeEntry({ id: 7, retries: 0 })])
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 409, statusText: 'Conflict',
      text: vi.fn().mockResolvedValue('calibration is approved and can no longer be edited'),
    } as unknown as Response)

    await flushOutbox()

    expect(db.outbox.update).toHaveBeenCalledWith(7, {
      retries: 5,
      last_error: expect.stringContaining('409'),
    })
  })

  it('aborts on 401 without burning retries', async () => {
    queue([makeEntry({ id: 8 })])
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized', text: vi.fn().mockResolvedValue('expired'),
    } as unknown as Response)

    await flushOutbox()

    expect(db.outbox.update).not.toHaveBeenCalled()
  })

  it('replays a 404 PUT on an asset as a POST create', async () => {
    queue([makeEntry({ id: 9, method: 'PUT', url: '/assets/a-1', body: { id: 'a-1', tag_id: 'T1' } })])
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: vi.fn().mockResolvedValue('') } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 201 } as Response)

    await flushOutbox()

    expect(globalThis.fetch).toHaveBeenNthCalledWith(2,
      expect.stringMatching(/\/assets$/),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(db.outbox.delete).toHaveBeenCalledWith(9)
  })

  it('shares one in-flight flush between concurrent callers', async () => {
    queue([makeEntry({ id: 1 })])
    let release!: () => void
    globalThis.fetch = vi.fn().mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ ok: true } as Response) }),
    )

    const a = flushOutbox()
    const b = flushOutbox()
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    release()
    await Promise.all([a, b])

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(db.outbox.delete).toHaveBeenCalledTimes(1)
  })

  it('announces completion so caches can refresh', async () => {
    queue([])
    const listener = vi.fn()
    window.addEventListener(OUTBOX_FLUSHED_EVENT, listener)
    await flushOutbox()
    window.removeEventListener(OUTBOX_FLUSHED_EVENT, listener)
    expect(listener).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// retryFailed
// ---------------------------------------------------------------------------

describe('retryFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.outbox.update).mockResolvedValue(1)
    vi.mocked(db.outbox.orderBy).mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) } as never)
  })

  it("resets retries on the user's dead entries, then flushes", async () => {
    const dead1 = makeEntry({ id: 20, retries: 5, last_error: 'err' })
    const dead2 = makeEntry({ id: 21, retries: 7, last_error: 'err2' })
    const live  = makeEntry({ id: 22, retries: 1 })
    vi.mocked(db.outbox.filter).mockReturnValue({ toArray: vi.fn().mockResolvedValue([dead1, dead2, live]) } as never)

    await retryFailed()

    expect(db.outbox.update).toHaveBeenCalledTimes(2)
    expect(db.outbox.update).toHaveBeenCalledWith(20, { retries: 0, last_error: undefined })
    expect(db.outbox.update).toHaveBeenCalledWith(21, { retries: 0, last_error: undefined })
    expect(db.outbox.orderBy).toHaveBeenCalled()  // flushed
  })

  it('only selects entries owned by the signed-in user', async () => {
    vi.mocked(db.outbox.filter).mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) } as never)

    await retryFailed()

    const filterFn = vi.mocked(db.outbox.filter).mock.calls[0][0] as (e: OutboxEntry) => boolean
    expect(filterFn(makeEntry())).toBe(true)
    expect(filterFn(makeEntry({ user_id: 'someone-else' }))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// clearAllOutbox
// ---------------------------------------------------------------------------

describe('clearAllOutbox', () => {
  it("deletes the user's entries and orphans, never another user's", async () => {
    vi.clearAllMocks()
    const all = [
      makeEntry({ id: 1 }),
      makeEntry({ id: 2, user_id: 'someone-else' }),
      makeEntry({ id: 3, user_id: undefined }),
    ]
    vi.mocked(db.outbox.filter).mockImplementation(((fn: (e: OutboxEntry) => boolean) =>
      ({ toArray: vi.fn().mockResolvedValue(all.filter(fn)) })) as never)
    vi.mocked(db.outbox.bulkDelete).mockResolvedValue(undefined)

    await clearAllOutbox()

    expect(db.outbox.bulkDelete).toHaveBeenCalledWith([1, 3])
  })
})
