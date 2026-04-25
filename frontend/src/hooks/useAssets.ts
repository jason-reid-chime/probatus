import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { db } from '../lib/db'
import { isOnline } from '../lib/sync/connectivity'
import type { LocalAsset } from '../lib/db'
import {
  fetchAssets,
  upsertAsset as apiUpsertAsset,
} from '../lib/api/assets'
import { enqueue } from '../lib/sync/outbox'
import { useAuth } from './useAuth'

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const assetKeys = {
  all: (tenantId: string) => ['assets', tenantId] as const,
  detail: (tenantId: string, id: string) => ['assets', tenantId, id] as const,
}

// ---------------------------------------------------------------------------
// useAssets — fetches all assets for the current tenant
// Falls back to Dexie local data when the network call fails
// ---------------------------------------------------------------------------
export function useAssets(): UseQueryResult<LocalAsset[]> {
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''

  return useQuery({
    queryKey: assetKeys.all(tenantId),
    queryFn: async () => {
      if (isOnline()) {
        try {
          return await fetchAssets(tenantId)
        } catch {
          // Network error despite onLine — fall through to Dexie
        }
      }
      return db.assets
        .where('tenant_id')
        .equals(tenantId)
        .sortBy('next_due_at')
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

// ---------------------------------------------------------------------------
// useAsset — single asset by id (looks up from the list query cache first)
// ---------------------------------------------------------------------------
export function useAsset(id: string): UseQueryResult<LocalAsset | undefined> {
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: assetKeys.detail(tenantId, id),
    queryFn: async () => {
      // Try cache first
      const cached = queryClient
        .getQueryData<LocalAsset[]>(assetKeys.all(tenantId))
        ?.find((a) => a.id === id)
      if (cached) return cached

      // Try Dexie
      const local = await db.assets.get(id)
      if (local) return local

      // Fetch from server
      const { data, error } = await import('../lib/supabase').then(
        ({ supabase }) =>
          supabase.from('assets').select('*').eq('id', id).maybeSingle(),
      )
      if (error) throw error
      if (data) {
        await db.assets.put(data as LocalAsset)
        return data as LocalAsset
      }
      return undefined
    },
    enabled: !!tenantId && !!id,
    staleTime: 1000 * 60 * 5,
  })
}

// ---------------------------------------------------------------------------
// useUpsertAsset — offline-first mutation using outbox pattern
// Writes to Dexie immediately so the UI feels instant even offline,
// then attempts an API sync with a 5-second timeout.  If the sync fails
// (or the device is offline), the outbox entry is retried on reconnect.
// ---------------------------------------------------------------------------
export function useUpsertAsset() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''

  return useMutation({
    mutationFn: async (asset: Omit<LocalAsset, 'updated_at'>): Promise<LocalAsset> => {
      const saved: LocalAsset = {
        ...asset,
        updated_at: new Date().toISOString(),
      }

      // 1. Write to Dexie immediately (offline-first)
      await db.assets.put(saved)

      // 2. Enqueue in outbox for guaranteed sync
      await enqueue({
        method: 'PUT',
        url:    `/assets/${saved.id}`,
        body:   saved as unknown as Record<string, unknown>,
      })

      // 3. Opportunistic online sync with 5-second timeout
      //    (airplane mode can keep navigator.onLine true briefly)
      if (isOnline()) {
        try {
          const withTimeout = <T>(p: Promise<T>): Promise<T> =>
            Promise.race([
              p,
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('sync-timeout')), 5000),
              ),
            ])
          const synced = await withTimeout(apiUpsertAsset(asset))
          // Remove the outbox entry — already synced
          const entries = await db.outbox
            .filter((e) => e.url === `/assets/${saved.id}`)
            .toArray()
          if (entries.length > 0) {
            await db.outbox.delete(entries[entries.length - 1].id!)
          }
          return synced
        } catch {
          // Network error or timeout — outbox will retry when back online
        }
      }

      return saved
    },

    onSuccess: (saved) => {
      // Update both list and detail cache
      queryClient.setQueryData<LocalAsset[]>(
        assetKeys.all(tenantId),
        (old = []) => {
          const idx = old.findIndex((a) => a.id === saved.id)
          return idx >= 0
            ? old.map((a) => (a.id === saved.id ? saved : a))
            : [...old, saved]
        },
      )
      queryClient.setQueryData(assetKeys.detail(tenantId, saved.id), saved)
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: assetKeys.all(tenantId) })
    },
  })
}
