import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OutboxEntry } from '../db/index'

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported
// ---------------------------------------------------------------------------

vi.mock('../db/index', () => ({
  db: {
    outbox: {
      add:     vi.fn(),
      orderBy: vi.fn(),
      filter:  vi.fn(),
      delete:  vi.fn(),
      update:  vi.fn(),
    },
  },
}))

vi.mock('../supabase/index', () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}))

import { db } from '../db/index'
import { supabase } from '../supabase/index'
import { enqueue, flushOutbox, retryFailed } from './outbox'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 1,
    table: 'assets',
    operation: 'upsert',
    payload: { id: 'asset-1' },
    created_at: '2026-01-01T00:00:00.000Z',
    retries: 0,
    ...overrides,
  }
}

/** Build a chainable Supabase stub that resolves to { data, error }. */
function makeSupabaseChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain = {
    select: vi.fn(),
    upsert: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    eq:     vi.fn(),
    order:  vi.fn(),
    single: vi.fn(),
  }
  // Every method returns the same chain so calls can be chained arbitrarily
  Object.keys(chain).forEach((k) => {
    ;(chain as Record<string, ReturnType<typeof vi.fn>>)[k].mockReturnValue(chain)
  })
  // The final await resolves to the provided result
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(chain as any)[Symbol.iterator] = undefined
  Object.assign(chain, {
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve),
  })
  return chain
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
    await enqueue({ table: 'assets', operation: 'upsert', payload: { id: 'a1' } })
    const after = Date.now()

    expect(db.outbox.add).toHaveBeenCalledOnce()
    const arg = vi.mocked(db.outbox.add).mock.calls[0][0] as OutboxEntry

    expect(arg.retries).toBe(0)
    expect(arg.table).toBe('assets')
    expect(arg.operation).toBe('upsert')
    expect(arg.payload).toEqual({ id: 'a1' })

    // created_at should be a valid ISO string within the test window
    const ts = new Date(arg.created_at).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('does not include an id field in the payload passed to add', async () => {
    await enqueue({ table: 'calibration_records', operation: 'delete', payload: { id: 'r1' } })
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
    expect(supabase.from).not.toHaveBeenCalled()
    expect(db.outbox.delete).not.toHaveBeenCalled()
  })

  it('processes entries in FIFO order and deletes successful ones', async () => {
    const entries = [
      makeEntry({ id: 1, operation: 'upsert', table: 'assets' }),
      makeEntry({ id: 2, operation: 'upsert', table: 'assets' }),
    ]
    const orderByChain = { toArray: vi.fn().mockResolvedValue(entries) }
    vi.mocked(db.outbox.orderBy).mockReturnValue(orderByChain as never)

    const supabaseChain = makeSupabaseChain({ error: null })
    vi.mocked(supabase.from).mockReturnValue(supabaseChain as never)

    await flushOutbox()

    // Both entries processed (upsert called twice)
    expect(supabase.from).toHaveBeenCalledTimes(2)

    // Both successfully deleted
    expect(db.outbox.delete).toHaveBeenCalledTimes(2)
    expect(db.outbox.delete).toHaveBeenNthCalledWith(1, 1)
    expect(db.outbox.delete).toHaveBeenNthCalledWith(2, 2)
  })

  it('increments retries on failure instead of deleting', async () => {
    const entry = makeEntry({ id: 3, retries: 1 })
    const orderByChain = { toArray: vi.fn().mockResolvedValue([entry]) }
    vi.mocked(db.outbox.orderBy).mockReturnValue(orderByChain as never)

    const supabaseChain = makeSupabaseChain({ error: { message: 'network error' } })
    vi.mocked(supabase.from).mockReturnValue(supabaseChain as never)

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

    await flushOutbox()

    expect(supabase.from).not.toHaveBeenCalled()
    expect(db.outbox.delete).not.toHaveBeenCalled()
    expect(db.outbox.update).not.toHaveBeenCalled()
  })

  it('handles a delete operation correctly', async () => {
    const entry = makeEntry({ id: 5, operation: 'delete', table: 'assets', payload: { id: 'a-del' } })
    const orderByChain = { toArray: vi.fn().mockResolvedValue([entry]) }
    vi.mocked(db.outbox.orderBy).mockReturnValue(orderByChain as never)

    const eqChain = { eq: vi.fn().mockResolvedValue({ error: null }) }
    const deleteChain = { delete: vi.fn().mockReturnValue(eqChain) }
    vi.mocked(supabase.from).mockReturnValue(deleteChain as never)

    await flushOutbox()

    expect(supabase.from).toHaveBeenCalledWith('assets')
    expect(eqChain.eq).toHaveBeenCalledWith('id', 'a-del')
    expect(db.outbox.delete).toHaveBeenCalledWith(5)
  })

  it('continues processing remaining entries after one fails', async () => {
    const entry1 = makeEntry({ id: 11, retries: 0 })
    const entry2 = makeEntry({ id: 12, retries: 0 })
    const orderByChain = { toArray: vi.fn().mockResolvedValue([entry1, entry2]) }
    vi.mocked(db.outbox.orderBy).mockReturnValue(orderByChain as never)

    const errorChain = makeSupabaseChain({ error: { message: 'fail' } })
    const successChain = makeSupabaseChain({ error: null })
    vi.mocked(supabase.from)
      .mockReturnValueOnce(errorChain as never)
      .mockReturnValueOnce(successChain as never)

    await flushOutbox()

    // entry1 fails → retries incremented
    expect(db.outbox.update).toHaveBeenCalledWith(11, { retries: 1, last_error: expect.any(String) })
    // entry2 succeeds → deleted
    expect(db.outbox.delete).toHaveBeenCalledWith(12)
  })
})

// ---------------------------------------------------------------------------
// retryFailed
// ---------------------------------------------------------------------------

describe('retryFailed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.outbox.update).mockResolvedValue(1)
  })

  it('resets retries to 0 for all dead entries (retries >= 5)', async () => {
    const dead1 = makeEntry({ id: 20, retries: 5, last_error: 'err' })
    const dead2 = makeEntry({ id: 21, retries: 7, last_error: 'err2' })

    const filterChain = { toArray: vi.fn().mockResolvedValue([dead1, dead2]) }
    vi.mocked(db.outbox.filter).mockReturnValue(filterChain as never)

    await retryFailed()

    expect(db.outbox.update).toHaveBeenCalledTimes(2)
    expect(db.outbox.update).toHaveBeenCalledWith(20, { retries: 0, last_error: undefined })
    expect(db.outbox.update).toHaveBeenCalledWith(21, { retries: 0, last_error: undefined })
  })

  it('does nothing when there are no dead entries', async () => {
    const filterChain = { toArray: vi.fn().mockResolvedValue([]) }
    vi.mocked(db.outbox.filter).mockReturnValue(filterChain as never)

    await retryFailed()

    expect(db.outbox.update).not.toHaveBeenCalled()
  })

  it('uses filter with a predicate that checks retries >= 5', async () => {
    const filterChain = { toArray: vi.fn().mockResolvedValue([]) }
    vi.mocked(db.outbox.filter).mockReturnValue(filterChain as never)

    await retryFailed()

    // The filter callback should return true for retries >= 5
    const filterFn = vi.mocked(db.outbox.filter).mock.calls[0][0] as (e: OutboxEntry) => boolean
    expect(filterFn(makeEntry({ retries: 5 }))).toBe(true)
    expect(filterFn(makeEntry({ retries: 6 }))).toBe(true)
    expect(filterFn(makeEntry({ retries: 4 }))).toBe(false)
    expect(filterFn(makeEntry({ retries: 0 }))).toBe(false)
  })
})
