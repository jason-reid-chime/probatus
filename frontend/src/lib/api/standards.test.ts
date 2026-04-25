import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../supabase', () => {
  const chain: Record<string, unknown> = {}
  ;['from', 'select', 'eq', 'order', 'upsert', 'delete', 'insert', 'single'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  chain['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve)
  return { supabase: chain }
})

import { supabase } from '../supabase'
import { fetchStandards, upsertStandard, deleteStandard } from './standards'

const mockStandard = {
  id: 's1', tenant_id: 't1', name: 'Deadweight Tester',
  serial_number: 'SN-001', model: 'DWT-100', manufacturer: 'Fluke',
  certificate_ref: 'CERT-001', calibrated_at: '2024-01-01', due_at: '2025-01-01',
}

function makeChain(result: { data?: unknown; error?: unknown }) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const c: Record<string, unknown> = {}
  ;['from', 'select', 'eq', 'order', 'upsert', 'delete', 'insert', 'single'].forEach((m) => {
    c[m] = vi.fn().mockReturnValue(c)
  })
  c['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(resolved).then(resolve)
  return c
}

describe('standards API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('fetchStandards', () => {
    it('returns standards list', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain({ data: [mockStandard] }) as never)
      const result = await fetchStandards('t1')
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Deadweight Tester')
    })

    it('throws on error', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain({ error: { message: 'db error' } }) as never)
      await expect(fetchStandards('t1')).rejects.toThrow('db error')
    })

    it('returns empty array when data is null', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain({ data: null }) as never)
      const result = await fetchStandards('t1')
      expect(result).toEqual([])
    })
  })

  describe('upsertStandard', () => {
    it('returns saved standard', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain({ data: mockStandard }) as never)
      const result = await upsertStandard(mockStandard as never)
      expect(result).toEqual(mockStandard)
    })

    it('throws on error', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain({ error: { message: 'conflict' } }) as never)
      await expect(upsertStandard(mockStandard as never)).rejects.toThrow('conflict')
    })
  })

  describe('deleteStandard', () => {
    it('resolves without error on success', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain({ data: null }) as never)
      await expect(deleteStandard('s1')).resolves.toBeUndefined()
    })

    it('throws on error', async () => {
      vi.mocked(supabase.from).mockReturnValue(makeChain({ error: { message: 'not found' } }) as never)
      await expect(deleteStandard('s1')).rejects.toThrow('not found')
    })
  })
})
