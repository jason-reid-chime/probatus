import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LocalCalibrationRecord } from '../db/index'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../db/index', () => ({
  db: {
    calibration_records: {
      bulkPut: vi.fn(),
      put:     vi.fn(),
    },
    measurements: {
      bulkPut: vi.fn(),
    },
  },
}))

vi.mock('../supabase/index', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { db } from '../db/index'
import { supabase } from '../supabase/index'
import {
  fetchCalibrationsByAsset,
  upsertCalibrationStandards,
} from './calibrations'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<LocalCalibrationRecord> = {}): LocalCalibrationRecord {
  return {
    id: 'rec-1',
    local_id: 'local-1',
    tenant_id: 'tenant-1',
    asset_id: 'asset-1',
    technician_id: 'tech-1',
    status: 'in_progress',
    performed_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Build a chainable Supabase query stub.
 * Each method returns the chain itself so calls can be freely composed.
 * The chain is also thenable — it resolves to `result` when awaited.
 */
function makeChain(result: { data?: unknown; error?: unknown } = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'upsert', 'insert', 'delete', 'eq', 'order', 'single']
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  // Make it awaitable
  chain['then'] = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(resolved).then(resolve, reject)
  return chain
}

// ---------------------------------------------------------------------------
// fetchCalibrationsByAsset
// ---------------------------------------------------------------------------

describe('fetchCalibrationsByAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.calibration_records.bulkPut).mockResolvedValue(undefined as unknown as string)
  })

  it('queries supabase with the correct table, filter, and order', async () => {
    const chain = makeChain({ data: [], error: null })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    await fetchCalibrationsByAsset('asset-42')

    expect(supabase.from).toHaveBeenCalledWith('calibration_records')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('asset_id', 'asset-42')
    expect(chain.order).toHaveBeenCalledWith('performed_at', { ascending: false })
  })

  it('caches records in Dexie via bulkPut', async () => {
    const records = [makeRecord(), makeRecord({ id: 'rec-2', local_id: 'local-2' })]
    const chain = makeChain({ data: records, error: null })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    await fetchCalibrationsByAsset('asset-1')

    expect(db.calibration_records.bulkPut).toHaveBeenCalledWith(records)
  })

  it('returns the records from supabase', async () => {
    const records = [makeRecord(), makeRecord({ id: 'rec-2', local_id: 'local-2' })]
    const chain = makeChain({ data: records, error: null })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const result = await fetchCalibrationsByAsset('asset-1')

    expect(result).toEqual(records)
  })

  it('returns an empty array and caches nothing meaningful when supabase returns null data', async () => {
    const chain = makeChain({ data: null, error: null })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    const result = await fetchCalibrationsByAsset('asset-1')

    expect(result).toEqual([])
    expect(db.calibration_records.bulkPut).toHaveBeenCalledWith([])
  })

  it('throws when supabase returns an error', async () => {
    const supabaseError = { message: 'permission denied', code: '42501' }
    const chain = makeChain({ data: null, error: supabaseError })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    await expect(fetchCalibrationsByAsset('asset-bad')).rejects.toEqual(supabaseError)
  })

  it('does not cache records when supabase errors', async () => {
    const chain = makeChain({ error: { message: 'fail' } })
    vi.mocked(supabase.from).mockReturnValue(chain as never)

    await expect(fetchCalibrationsByAsset('asset-bad')).rejects.toBeTruthy()
    expect(db.calibration_records.bulkPut).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// upsertCalibrationStandards
// ---------------------------------------------------------------------------

describe('upsertCalibrationStandards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes existing links for the record before inserting new ones', async () => {
    const deleteEqChain = { eq: vi.fn().mockResolvedValue({ error: null }) }
    const deleteChain   = { delete: vi.fn().mockReturnValue(deleteEqChain) }
    const insertChain   = makeChain({ error: null })

    vi.mocked(supabase.from)
      .mockReturnValueOnce(deleteChain as never)   // delete call
      .mockReturnValueOnce(insertChain as never)   // insert call

    await upsertCalibrationStandards('rec-1', ['std-a', 'std-b'])

    expect(supabase.from).toHaveBeenNthCalledWith(1, 'calibration_standards_used')
    expect(deleteChain.delete).toHaveBeenCalled()
    expect(deleteEqChain.eq).toHaveBeenCalledWith('record_id', 'rec-1')
  })

  it('inserts correct rows when standardIds is non-empty', async () => {
    const deleteEqChain = { eq: vi.fn().mockResolvedValue({ error: null }) }
    const deleteChain   = { delete: vi.fn().mockReturnValue(deleteEqChain) }
    const insertChain   = makeChain({ error: null })

    vi.mocked(supabase.from)
      .mockReturnValueOnce(deleteChain as never)
      .mockReturnValueOnce(insertChain as never)

    await upsertCalibrationStandards('rec-1', ['std-a', 'std-b'])

    expect(supabase.from).toHaveBeenNthCalledWith(2, 'calibration_standards_used')
    expect(insertChain.insert).toHaveBeenCalledWith([
      { record_id: 'rec-1', standard_id: 'std-a' },
      { record_id: 'rec-1', standard_id: 'std-b' },
    ])
  })

  it('skips the insert step when standardIds is empty', async () => {
    const deleteEqChain = { eq: vi.fn().mockResolvedValue({ error: null }) }
    const deleteChain   = { delete: vi.fn().mockReturnValue(deleteEqChain) }

    vi.mocked(supabase.from).mockReturnValueOnce(deleteChain as never)

    await upsertCalibrationStandards('rec-empty', [])

    // Only one call to supabase.from (for delete), none for insert
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('throws when the insert returns an error', async () => {
    const deleteEqChain = { eq: vi.fn().mockResolvedValue({ error: null }) }
    const deleteChain   = { delete: vi.fn().mockReturnValue(deleteEqChain) }
    const insertChain   = makeChain({ error: { message: 'insert failed' } })

    vi.mocked(supabase.from)
      .mockReturnValueOnce(deleteChain as never)
      .mockReturnValueOnce(insertChain as never)

    await expect(upsertCalibrationStandards('rec-1', ['std-x'])).rejects.toEqual(
      expect.objectContaining({ message: 'insert failed' }),
    )
  })
})
