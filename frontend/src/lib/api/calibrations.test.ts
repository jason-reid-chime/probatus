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
      where:   vi.fn(),
    },
    measurements: {
      bulkPut: vi.fn(),
    },
  },
}))

vi.mock('../sync/outbox', () => ({
  pendingRecordIds: vi.fn().mockResolvedValue(new Set()),
}))

vi.mock('../supabase/index', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { db } from '../db/index'
import { supabase } from '../supabase/index'
import { pendingRecordIds } from '../sync/outbox'
import {
  fetchCalibrationsByAsset,
  buildCalibrationPayload,
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

describe('fetchCalibrationsByAsset with unsynced local edits', () => {
  it('keeps the local version of records that have pending outbox entries', async () => {
    vi.clearAllMocks()
    const serverOld = makeRecord({ id: 'rec-1', notes: 'server' })
    const serverOther = makeRecord({ id: 'rec-2', performed_at: '2025-12-01T00:00:00.000Z' })
    const localEdited = makeRecord({ id: 'rec-1', notes: 'edited offline' })
    const localOnly = makeRecord({ id: 'rec-3', performed_at: '2026-02-01T00:00:00.000Z' })

    vi.mocked(supabase.from).mockReturnValue(makeChain({ data: [serverOld, serverOther] }) as never)
    vi.mocked(pendingRecordIds).mockResolvedValueOnce(new Set(['rec-1', 'rec-3']))
    vi.mocked(db.calibration_records.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        filter: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([localEdited, localOnly]) }),
      }),
    } as never)

    const result = await fetchCalibrationsByAsset('asset-1')

    // The server copy of rec-1 must not overwrite the unsynced local edit
    expect(db.calibration_records.bulkPut).toHaveBeenCalledWith([serverOther])
    expect(result.map((r) => r.id)).toEqual(['rec-3', 'rec-1', 'rec-2'])
    expect(result.find((r) => r.id === 'rec-1')?.notes).toBe('edited offline')
  })
})

// ---------------------------------------------------------------------------
// buildCalibrationPayload
// ---------------------------------------------------------------------------

describe('buildCalibrationPayload', () => {
  it('includes the client id and asset_id so a PUT can be replayed as a POST', () => {
    const body = buildCalibrationPayload(makeRecord(), [], [])
    expect(body.id).toBe('rec-1')
    expect(body.asset_id).toBe('asset-1')
    expect(body.status).toBe('in_progress')
  })

  it('passes standard ids through', () => {
    const body = buildCalibrationPayload(makeRecord(), [], ['std-a', 'std-b'])
    expect(body.standard_ids).toEqual(['std-a', 'std-b'])
  })

  it('keeps as-found, uncertainty and null values instead of collapsing to 0', () => {
    const body = buildCalibrationPayload(makeRecord(), [{
      id: 'm-1',
      record_id: 'rec-1',
      point_label: '50%',
      standard_value: 50,
      as_found_value: 49.2,
      measured_value: undefined,
      uncertainty_pct: 0.1,
      confidence_level: '95',
    }], [])
    expect(body.measurements).toEqual([expect.objectContaining({
      standard_value: 50,
      as_found_value: 49.2,
      measured_value: null,
      pass: null,
      uncertainty_pct: 0.1,
      confidence_level: '95',
    })])
  })
})
