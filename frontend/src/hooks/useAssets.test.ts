import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'

vi.mock('../lib/db', () => ({
  db: {
    assets: { put: vi.fn().mockResolvedValue(undefined) },
  },
}))
vi.mock('../lib/api/assets', () => ({
  fetchAssets: vi.fn(),
  upsertAsset: vi.fn(),
}))
vi.mock('../lib/sync/outbox', () => ({
  enqueue: vi.fn().mockResolvedValue(1),
}))
vi.mock('../lib/sync/connectivity', () => ({
  isOnline: vi.fn().mockReturnValue(true),
}))
vi.mock('./useAuth', () => ({
  useAuth: () => ({ profile: { tenant_id: 'tenant-1' } }),
}))

import { useUpsertAsset } from './useAssets'
import { upsertAsset } from '../lib/api/assets'
import { enqueue } from '../lib/sync/outbox'
import { isOnline } from '../lib/sync/connectivity'
import { db } from '../lib/db'
import type { LocalAsset } from '../lib/db'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

const asset = {
  id: 'a-1',
  tenant_id: 'tenant-1',
  tag_id: 'T-1',
  instrument_type: 'pressure',
  calibration_interval_days: 365,
} as Omit<LocalAsset, 'updated_at'>

describe('useUpsertAsset', () => {
  beforeEach(() => vi.clearAllMocks())

  it('online: saves straight to the server without queueing', async () => {
    vi.mocked(isOnline).mockReturnValue(true)
    const saved = { ...asset, updated_at: 'now' } as LocalAsset
    vi.mocked(upsertAsset).mockResolvedValueOnce(saved)

    const { result } = renderHook(() => useUpsertAsset(), { wrapper })
    result.current.mutate(asset)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(saved)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('online: surfaces server validation errors instead of queueing', async () => {
    vi.mocked(isOnline).mockReturnValue(true)
    vi.mocked(upsertAsset).mockRejectedValueOnce(new Error('A asset with this Tag ID already exists.'))

    const { result } = renderHook(() => useUpsertAsset(), { wrapper })
    result.current.mutate(asset)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toMatch(/already exists/)
    expect(enqueue).not.toHaveBeenCalled()
    expect(db.assets.put).not.toHaveBeenCalled()
  })

  it('online but unreachable: falls back to Dexie + outbox', async () => {
    vi.mocked(isOnline).mockReturnValue(true)
    vi.mocked(upsertAsset).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { result } = renderHook(() => useUpsertAsset(), { wrapper })
    result.current.mutate(asset)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(db.assets.put).toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ method: 'PUT', url: '/assets/a-1' }))
  })

  it('offline: writes to Dexie and queues without calling the server', async () => {
    vi.mocked(isOnline).mockReturnValue(false)

    const { result } = renderHook(() => useUpsertAsset(), { wrapper })
    result.current.mutate(asset)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(upsertAsset).not.toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledTimes(1)
  })
})
