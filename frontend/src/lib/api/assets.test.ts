import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LocalAsset } from '../db'

const sb = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  calls: [] as Array<[string, ...unknown[]]>,
}))
const local = vi.hoisted(() => ({ assets: [] as Array<{ id: string; tenant_id: string }> }))

vi.mock('../supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'upsert', 'delete', 'single', 'maybeSingle']) {
    chain[m] = vi.fn((...args: unknown[]) => { sb.calls.push([m, ...args]); return chain })
  }
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(sb.result).then(res)
  return { supabase: { from: vi.fn((t: string) => { sb.calls.push(['from', t]); return chain }) } }
})
vi.mock('../db', () => ({
  db: {
    assets: {
      bulkPut: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      where: vi.fn(() => ({
        equals: vi.fn((tenant: string) => ({
          filter: vi.fn((pred: (a: { id: string }) => boolean) => ({
            toArray: vi.fn(async () => local.assets.filter((a) => a.tenant_id === tenant && pred(a))),
          })),
        })),
      })),
    },
  },
}))
vi.mock('../sync/outbox', () => ({ pendingRecordIds: vi.fn(async () => new Set<string>()) }))

import { fetchAssets, fetchAssetByTagId, upsertAsset, deleteAsset } from './assets'
import { db } from '../db'
import { pendingRecordIds } from '../sync/outbox'

const asset = (id: string, tag_id: string, extra: Partial<LocalAsset> = {}) =>
  ({ id, tenant_id: 't1', tag_id, instrument_type: 'pressure', calibration_interval_days: 365, updated_at: 'x', ...extra }) as LocalAsset

beforeEach(() => {
  vi.clearAllMocks()
  sb.result = { data: null, error: null }
  sb.calls = []
  local.assets = []
  vi.mocked(pendingRecordIds).mockResolvedValue(new Set())
})

describe('fetchAssets', () => {
  it('returns server assets ordered by due date and caches them all when nothing is pending', async () => {
    const server = [asset('a1', 'PT-1'), asset('a2', 'PT-2')]
    sb.result = { data: server, error: null }
    expect(await fetchAssets('t1')).toEqual(server)
    expect(sb.calls).toContainEqual(['eq', 'tenant_id', 't1'])
    expect(sb.calls).toContainEqual(['order', 'next_due_at', { ascending: true, nullsFirst: false }])
    expect(db.assets.bulkPut).toHaveBeenCalledWith(server)
  })

  it('keeps unsynced local edits and offline-created assets over the server copy', async () => {
    sb.result = { data: [asset('a1', 'PT-1', { location: 'server' }), asset('a2', 'PT-2')], error: null }
    vi.mocked(pendingRecordIds).mockResolvedValue(new Set(['a1', 'a-new', 'a-t2']))
    const localA1 = asset('a1', 'PT-1', { location: 'edited offline' })
    const offline = asset('a-new', 'PT-NEW')
    local.assets = [localA1, offline, asset('a2', 'PT-2'), asset('a-t2', 'OTHER-TENANT', { tenant_id: 't2' })]

    const result = await fetchAssets('t1')
    expect(db.assets.bulkPut).toHaveBeenCalledWith([expect.objectContaining({ id: 'a2' })])
    expect(result.map((a) => [a.id, a.location])).toEqual([['a2', undefined], ['a1', 'edited offline'], ['a-new', undefined]])
  })

  it('treats a null response as no assets', async () => {
    expect(await fetchAssets('t1')).toEqual([])
  })

  it('throws query errors without touching the cache', async () => {
    sb.result = { data: null, error: { message: 'jwt expired' } }
    await expect(fetchAssets('t1')).rejects.toEqual({ message: 'jwt expired' })
    expect(db.assets.bulkPut).not.toHaveBeenCalled()
  })
})

describe('fetchAssetByTagId', () => {
  it('finds and caches the asset by tenant and tag', async () => {
    sb.result = { data: asset('a1', 'PT-1'), error: null }
    expect(await fetchAssetByTagId('t1', 'PT-1')).toMatchObject({ id: 'a1' })
    expect(sb.calls).toContainEqual(['eq', 'tag_id', 'PT-1'])
    expect(db.assets.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }))
  })

  it('returns null when no asset has the tag', async () => {
    expect(await fetchAssetByTagId('t1', 'NOPE')).toBeNull()
    expect(db.assets.put).not.toHaveBeenCalled()
  })

  it('throws query errors', async () => {
    sb.result = { data: null, error: new Error('boom') }
    await expect(fetchAssetByTagId('t1', 'PT-1')).rejects.toThrow('boom')
  })
})

describe('upsertAsset', () => {
  it('stamps updated_at, upserts on id and caches the saved row', async () => {
    const saved = asset('a1', 'PT-1', { updated_at: '2026-10-29T00:00:00Z' })
    sb.result = { data: saved, error: null }
    const { updated_at: _ignored, ...input } = asset('a1', 'PT-1')
    void _ignored
    expect(await upsertAsset(input)).toEqual(saved)
    const upsertCall = sb.calls.find((c) => c[0] === 'upsert')!
    expect(upsertCall[1]).toMatchObject({ id: 'a1', tag_id: 'PT-1' })
    expect(typeof (upsertCall[1] as LocalAsset).updated_at).toBe('string')
    expect(upsertCall[2]).toEqual({ onConflict: 'id' })
    expect(db.assets.put).toHaveBeenCalledWith(saved)
  })

  it('explains a duplicate tag ID (unique violation)', async () => {
    sb.result = { data: null, error: { code: '23505', message: 'duplicate key' } }
    await expect(upsertAsset(asset('a1', 'PT-1'))).rejects.toThrow(/Tag ID already exists/)
    expect(db.assets.put).not.toHaveBeenCalled()
  })

  it('rethrows other errors as-is', async () => {
    const err = { code: '42501', message: 'rls' }
    sb.result = { data: null, error: err }
    await expect(upsertAsset(asset('a1', 'PT-1'))).rejects.toBe(err)
  })
})

describe('deleteAsset', () => {
  it('deletes on the server then from the local cache', async () => {
    await deleteAsset('a1')
    expect(sb.calls).toContainEqual(['eq', 'id', 'a1'])
    expect(db.assets.delete).toHaveBeenCalledWith('a1')
  })

  it('keeps the local copy when the server delete fails', async () => {
    sb.result = { data: null, error: new Error('fk violation') }
    await expect(deleteAsset('a1')).rejects.toThrow('fk violation')
    expect(db.assets.delete).not.toHaveBeenCalled()
  })
})
