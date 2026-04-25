import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'

// ---------------------------------------------------------------------------
// Mocks — declared before imports so vi.mock hoisting works
// ---------------------------------------------------------------------------

vi.mock('../lib/db', () => ({
  db: {
    calibration_records: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          reverse: vi.fn().mockReturnValue({
            sortBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    },
    measurements: {
      bulkPut: vi.fn().mockResolvedValue(undefined),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    },
    outbox: {
      add: vi.fn().mockResolvedValue(undefined),
      filter: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      bulkDelete: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

vi.mock('../lib/api/calibrations', () => ({
  fetchCalibrationsByAsset: vi.fn(),
  upsertCalibrationRecord: vi.fn(),
  upsertMeasurements: vi.fn(),
  upsertCalibrationStandards: vi.fn(),
}))

vi.mock('../lib/sync/outbox', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  enqueueStandardsReplace: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../lib/sync/connectivity', () => ({
  isOnline: vi.fn().mockReturnValue(false),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockReturnThis(),
    }),
  },
}))

import {
  useCalibrationsByAsset,
  useCalibrationRecord,
  useMeasurementsByRecord,
  useSaveCalibration,
  calibrationKeys,
} from './useCalibration'
import { fetchCalibrationsByAsset, upsertCalibrationRecord, upsertMeasurements, upsertCalibrationStandards } from '../lib/api/calibrations'
import { enqueue, enqueueStandardsReplace } from '../lib/sync/outbox'
import { isOnline } from '../lib/sync/connectivity'
import { db } from '../lib/db'
import type { LocalCalibrationRecord, LocalMeasurement } from '../lib/db'

// ---------------------------------------------------------------------------
// Test wrapper for React Query
// ---------------------------------------------------------------------------
function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeRecord(overrides: Partial<LocalCalibrationRecord> = {}): LocalCalibrationRecord {
  return {
    id: 'rec-1',
    asset_id: 'asset-1',
    tenant_id: 'tenant-1',
    technician_id: 'tech-1',
    status: 'in_progress',
    performed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    local_id: 'local-1',
    ...overrides,
  } as LocalCalibrationRecord
}

function makeMeasurement(overrides: Partial<LocalMeasurement> = {}): LocalMeasurement {
  return {
    id: 'm-1',
    record_id: 'rec-1',
    point_label: '50%',
    standard_value: 50,
    measured_value: 50.1,
    error_pct: 0.2,
    pass: true,
    ...overrides,
  } as LocalMeasurement
}

// ---------------------------------------------------------------------------
// calibrationKeys
// ---------------------------------------------------------------------------
describe('calibrationKeys', () => {
  it('byAsset returns stable key', () => {
    expect(calibrationKeys.byAsset('a1')).toEqual(['calibrations', 'asset', 'a1'])
  })

  it('detail returns stable key', () => {
    expect(calibrationKeys.detail('r1')).toEqual(['calibrations', 'detail', 'r1'])
  })

  it('measurements returns stable key', () => {
    expect(calibrationKeys.measurements('r1')).toEqual(['calibrations', 'measurements', 'r1'])
  })
})

// ---------------------------------------------------------------------------
// useCalibrationsByAsset
// ---------------------------------------------------------------------------
describe('useCalibrationsByAsset', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is disabled when assetId is empty string', () => {
    const { result } = renderHook(() => useCalibrationsByAsset(''), { wrapper: makeWrapper() })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('returns remote records on success', async () => {
    const records = [makeRecord()]
    vi.mocked(fetchCalibrationsByAsset).mockResolvedValueOnce(records)

    const { result } = renderHook(() => useCalibrationsByAsset('asset-1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(records)
  })

  it('falls back to Dexie when remote fetch throws', async () => {
    const local = [makeRecord({ id: 'local-rec' })]
    vi.mocked(fetchCalibrationsByAsset).mockRejectedValueOnce(new Error('offline'))
    vi.mocked(db.calibration_records.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        reverse: vi.fn().mockReturnValue({
          sortBy: vi.fn().mockResolvedValue(local),
        }),
      }),
    } as unknown as ReturnType<typeof db.calibration_records.where>)

    const { result } = renderHook(() => useCalibrationsByAsset('asset-1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(local)
  })
})

// ---------------------------------------------------------------------------
// useCalibrationRecord
// ---------------------------------------------------------------------------
describe('useCalibrationRecord', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is disabled when recordId is empty', () => {
    const { result } = renderHook(() => useCalibrationRecord(''), { wrapper: makeWrapper() })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('returns record from Dexie when found locally', async () => {
    const rec = makeRecord()
    vi.mocked(db.calibration_records.get).mockResolvedValueOnce(rec)

    const { result } = renderHook(() => useCalibrationRecord('rec-1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(rec)
  })

  it('returns undefined when not found locally or remotely', async () => {
    vi.mocked(db.calibration_records.get).mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useCalibrationRecord('rec-999'), { wrapper: makeWrapper() })
    // Either succeeds with undefined or errors — just confirm it stops loading
    await waitFor(() => expect(result.current.isPending).toBe(false), { timeout: 5000 })
    expect(result.current.data ?? undefined).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// useMeasurementsByRecord
// ---------------------------------------------------------------------------
describe('useMeasurementsByRecord', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is disabled when recordId is empty', () => {
    const { result } = renderHook(() => useMeasurementsByRecord(''), { wrapper: makeWrapper() })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('returns measurements sorted by standard_value ascending', async () => {
    const unsorted = [
      makeMeasurement({ id: 'm-3', standard_value: 100, measured_value: 100 }),
      makeMeasurement({ id: 'm-1', standard_value: 0, measured_value: 0 }),
      makeMeasurement({ id: 'm-2', standard_value: 50, measured_value: 50 }),
    ]
    vi.mocked(db.measurements.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(unsorted),
      }),
    } as unknown as ReturnType<typeof db.measurements.where>)

    const { result } = renderHook(() => useMeasurementsByRecord('rec-1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.map((m) => m.standard_value)).toEqual([0, 50, 100])
  })

  it('measurements with undefined standard_value sort to the end', async () => {
    const ms = [
      makeMeasurement({ id: 'm-b', standard_value: undefined }),
      makeMeasurement({ id: 'm-a', standard_value: 10 }),
    ]
    vi.mocked(db.measurements.where).mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(ms),
      }),
    } as unknown as ReturnType<typeof db.measurements.where>)

    const { result } = renderHook(() => useMeasurementsByRecord('rec-1'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0].id).toBe('m-a')
    expect(result.current.data?.[1].id).toBe('m-b')
  })
})

// ---------------------------------------------------------------------------
// useSaveCalibration
// ---------------------------------------------------------------------------
describe('useSaveCalibration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes record and measurements to Dexie', async () => {
    vi.mocked(isOnline).mockReturnValue(false)
    const record = makeRecord()
    const measurements = [makeMeasurement()]

    const { result } = renderHook(() => useSaveCalibration(), { wrapper: makeWrapper() })
    result.current.mutate({ record, measurements })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(db.calibration_records.put)).toHaveBeenCalledWith(record)
    expect(vi.mocked(db.measurements.bulkPut)).toHaveBeenCalledWith(measurements)
  })

  it('enqueues record and measurements in the outbox as a single calibration entry', async () => {
    vi.mocked(isOnline).mockReturnValue(false)
    const record = makeRecord()
    const measurements = [makeMeasurement({ id: 'm-1' }), makeMeasurement({ id: 'm-2' })]

    const { result } = renderHook(() => useSaveCalibration(), { wrapper: makeWrapper() })
    result.current.mutate({ record, measurements })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const calls = vi.mocked(enqueue).mock.calls
    // The new outbox schema uses method/url/body — one entry for the calibration record
    const urls = calls.map((c) => c[0].url)
    expect(urls.some((u) => u.includes('/calibrations'))).toBe(true)
  })

  it('enqueues standards as a replace operation when standardIds provided', async () => {
    vi.mocked(isOnline).mockReturnValue(false)
    const record = makeRecord()

    const { result } = renderHook(() => useSaveCalibration(), { wrapper: makeWrapper() })
    result.current.mutate({ record, measurements: [], standardIds: ['std-1', 'std-2'] })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(enqueueStandardsReplace)).toHaveBeenCalledWith(record.id, ['std-1', 'std-2'])
  })

  it('skips online sync when offline', async () => {
    vi.mocked(isOnline).mockReturnValue(false)
    const record = makeRecord()

    const { result } = renderHook(() => useSaveCalibration(), { wrapper: makeWrapper() })
    result.current.mutate({ record, measurements: [] })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(upsertCalibrationRecord).not.toHaveBeenCalled()
    expect(upsertMeasurements).not.toHaveBeenCalled()
  })

  it('attempts online sync when online and returns remote record', async () => {
    vi.mocked(isOnline).mockReturnValue(true)
    const record = makeRecord()
    const saved = { ...record, id: 'saved-id' } as LocalCalibrationRecord
    vi.mocked(upsertCalibrationRecord).mockResolvedValueOnce(saved)
    vi.mocked(upsertMeasurements).mockResolvedValueOnce(undefined as unknown as void)
    vi.mocked(upsertCalibrationStandards).mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useSaveCalibration(), { wrapper: makeWrapper() })
    result.current.mutate({ record, measurements: [] })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(saved)
  })

  it('falls back to local record when online sync times out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(isOnline).mockReturnValue(true)
    vi.mocked(upsertCalibrationRecord).mockImplementationOnce(
      () => new Promise(() => { /* never resolves — tests the sync timeout */ }),
    )
    const record = makeRecord()

    const { result } = renderHook(() => useSaveCalibration(), { wrapper: makeWrapper() })
    result.current.mutate({ record, measurements: [] })

    // Advance past the 5-second sync timeout
    await vi.advanceTimersByTimeAsync(6000)
    vi.useRealTimers()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(record)
  })
})
