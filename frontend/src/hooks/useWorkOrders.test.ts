import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

const sb = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  calls: [] as Array<[string, ...unknown[]]>,
  profile: { id: 'u1', tenant_id: 't1', role: 'supervisor' } as Record<string, string> | null,
  customer: null as string | null,
}))

vi.mock('../lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'single']) {
    chain[m] = vi.fn((...args: unknown[]) => { sb.calls.push([m, ...args]); return chain })
  }
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(sb.result).then(res)
  return { supabase: { from: vi.fn((t: string) => { sb.calls.push(['from', t]); return chain }) } }
})
vi.mock('../lib/api/client', () => ({ apiRequest: vi.fn() }))
vi.mock('./useAuth', () => ({ useAuth: () => ({ profile: sb.profile }) }))
vi.mock('./useCustomerFilter', () => ({ useCustomerFilter: () => ({ selectedCustomerId: sb.customer }) }))

import {
  useWorkOrders, useWorkOrder, useUpsertWorkOrder, useDeleteWorkOrder, useUpdateWorkOrderStatus, useTenantProfiles,
} from './useWorkOrders'
import { apiRequest } from '../lib/api/client'

let qc: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: qc }, children)
}
const eqCalls = () => sb.calls.filter((c) => c[0] === 'eq').map((c) => c.slice(1))

beforeEach(() => {
  vi.clearAllMocks()
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  sb.result = { data: null, error: null }
  sb.calls = []
  sb.profile = { id: 'u1', tenant_id: 't1', role: 'supervisor' }
  sb.customer = null
})

describe('useWorkOrders', () => {
  it('lists the tenant work orders newest first', async () => {
    sb.result = { data: [{ id: 'w1', title: 'Annual' }], error: null }
    const { result } = renderHook(() => useWorkOrders(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 'w1', title: 'Annual' }])
    expect(sb.calls).toContainEqual(['from', 'work_orders'])
    expect(sb.calls).toContainEqual(['order', 'scheduled_date', { ascending: false }])
    expect(eqCalls()).toEqual([['tenant_id', 't1']])
  })

  it('narrows to the selected customer and to a technician’s assignments', async () => {
    sb.customer = 'c9'
    sb.profile = { id: 'tech-1', tenant_id: 't1', role: 'technician' }
    sb.result = { data: null, error: null }
    const { result } = renderHook(() => useWorkOrders(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
    expect(eqCalls()).toEqual([
      ['tenant_id', 't1'], ['customer_id', 'c9'], ['work_order_technicians.technician_id', 'tech-1'],
    ])
  })

  it('surfaces query errors', async () => {
    sb.result = { data: null, error: new Error('rls') }
    const { result } = renderHook(() => useWorkOrders(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('rls')
  })

  it('does not query without a tenant', () => {
    sb.profile = null
    const { result } = renderHook(() => useWorkOrders(), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(sb.calls).toEqual([])
  })
})

describe('useWorkOrder', () => {
  it('flattens joined assets and technicians, dropping missing ones', async () => {
    sb.result = {
      data: {
        id: 'w1', title: 'Annual',
        work_order_assets: [{ asset: { id: 'a1', tag_id: 'PT-1' } }, { asset: null }],
        work_order_technicians: [{ technician: { id: 'u2', full_name: 'Tom' } }, { technician: null }],
      },
      error: null,
    }
    const { result } = renderHook(() => useWorkOrder('w1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.assets).toEqual([{ id: 'a1', tag_id: 'PT-1' }])
    expect(result.current.data?.technicians).toEqual([{ id: 'u2', full_name: 'Tom' }])
    expect(eqCalls()).toEqual([['id', 'w1']])
  })

  it('handles a work order with no joins', async () => {
    sb.result = { data: { id: 'w1' }, error: null }
    const { result } = renderHook(() => useWorkOrder('w1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toMatchObject({ id: 'w1', assets: [], technicians: [] })
  })

  it('returns null when not found and surfaces errors', async () => {
    const { result } = renderHook(() => useWorkOrder('w1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()

    sb.result = { data: null, error: new Error('not found') }
    const { result: r2 } = renderHook(() => useWorkOrder('w2'), { wrapper })
    await waitFor(() => expect(r2.current.isError).toBe(true))
  })

  it('does not query without an id', () => {
    const { result } = renderHook(() => useWorkOrder(''), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('work order mutations', () => {
  it('creates a work order (default status open) and invalidates the list', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ id: 'new-wo' })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpsertWorkOrder(), { wrapper })
    let id: string | undefined
    await act(async () => {
      id = await result.current.mutateAsync({
        workOrder: { title: 'Annual', scheduled_date: '2026-11-01', customer_id: 'c1', notes: null },
        assetIds: ['a1'], technicianIds: ['u2'],
      })
    })
    expect(id).toBe('new-wo')
    expect(apiRequest).toHaveBeenCalledWith('POST', '/work-orders', {
      title: 'Annual', notes: null, scheduled_date: '2026-11-01', status: 'open', customer_id: 'c1',
      asset_ids: ['a1'], technician_ids: ['u2'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['work-orders', 't1'] })
  })

  it('updates an existing work order with PUT', async () => {
    vi.mocked(apiRequest).mockResolvedValue(undefined)
    const { result } = renderHook(() => useUpsertWorkOrder(), { wrapper })
    let id: string | undefined
    await act(async () => {
      id = await result.current.mutateAsync({
        workOrder: { id: 'w1', title: 'Annual', scheduled_date: '2026-11-01', status: 'in_progress' },
        assetIds: [], technicianIds: [],
      })
    })
    expect(id).toBe('w1')
    expect(apiRequest).toHaveBeenCalledWith('PUT', '/work-orders/w1', expect.objectContaining({ status: 'in_progress', asset_ids: [] }))
  })

  it('deletes and changes status through the API', async () => {
    vi.mocked(apiRequest).mockResolvedValue(undefined)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const del = renderHook(() => useDeleteWorkOrder(), { wrapper })
    await act(() => del.result.current.mutateAsync('w1'))
    expect(apiRequest).toHaveBeenCalledWith('DELETE', '/work-orders/w1')

    const status = renderHook(() => useUpdateWorkOrderStatus(), { wrapper })
    await act(() => status.result.current.mutateAsync({ id: 'w1', status: 'completed' }))
    expect(apiRequest).toHaveBeenCalledWith('PATCH', '/work-orders/w1/status', { status: 'completed' })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('does not invalidate when the API rejects', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('409 conflict'))
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteWorkOrder(), { wrapper })
    await act(async () => { await expect(result.current.mutateAsync('w1')).rejects.toThrow('409 conflict') })
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useTenantProfiles', () => {
  it('lists tenant profiles by name', async () => {
    sb.result = { data: [{ id: 'u2', full_name: 'Tom' }], error: null }
    const { result } = renderHook(() => useTenantProfiles(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 'u2', full_name: 'Tom' }])
    expect(sb.calls).toContainEqual(['from', 'profiles'])
    expect(sb.calls).toContainEqual(['order', 'full_name'])
  })

  it('surfaces errors', async () => {
    sb.result = { data: null, error: new Error('denied') }
    const { result } = renderHook(() => useTenantProfiles(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
