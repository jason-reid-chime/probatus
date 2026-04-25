import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../supabase', () => {
  const chain: Record<string, unknown> = {}
  ;['from', 'select', 'lt', 'lte', 'gte', 'order', 'limit'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve)
  return {
    supabase: {
      ...chain,
      auth: { getSession: vi.fn() },
    },
  }
})

vi.mock('./client', () => ({ API_URL: 'http://localhost:8080' }))

import { supabase } from '../supabase'
import { fetchDashboardStats, fetchOverdueAssets, fetchDueSoonAssets } from './dashboard'

describe('dashboard API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('fetchDashboardStats', () => {
    it('returns zero stats when no session', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: null } } as never)
      const stats = await fetchDashboardStats()
      expect(stats.overdue_count).toBe(0)
      expect(stats.pass_rate_30d).toBe(0)
    })

    it('returns zero stats when fetch fails', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'tok' } },
      } as never)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
      const stats = await fetchDashboardStats()
      expect(stats.overdue_count).toBe(0)
      vi.unstubAllGlobals()
    })

    it('returns zero stats when response is not ok', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'tok' } },
      } as never)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
      const stats = await fetchDashboardStats()
      expect(stats.due_within_30).toBe(0)
      vi.unstubAllGlobals()
    })

    it('parses json response on success', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'tok' } },
      } as never)
      const mockStats = { overdue_count: 3, due_within_30: 5, due_within_90: 10, standards_expiring_soon: 1, pass_rate_30d: 92 }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockStats) }))
      const stats = await fetchDashboardStats()
      expect(stats.overdue_count).toBe(3)
      expect(stats.pass_rate_30d).toBe(92)
      vi.unstubAllGlobals()
    })
  })

  describe('fetchOverdueAssets', () => {
    it('returns empty array on error', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          lt: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'err' } }),
            }),
          }),
        }),
      } as never)
      const result = await fetchOverdueAssets()
      expect(result).toEqual([])
    })

    it('returns data on success', async () => {
      const asset = { id: 'a1', tag_id: 'T1', next_due_at: '2025-01-01' }
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          lt: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [asset], error: null }),
            }),
          }),
        }),
      } as never)
      const result = await fetchOverdueAssets()
      expect(result).toHaveLength(1)
      expect(result[0].tag_id).toBe('T1')
    })
  })

  describe('fetchDueSoonAssets', () => {
    it('returns empty array on error', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'err' } }),
              }),
            }),
          }),
        }),
      } as never)
      const result = await fetchDueSoonAssets()
      expect(result).toEqual([])
    })
  })
})
