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
// useUpsertAsset — optimistic mutation
// ---------------------------------------------------------------------------
export function useUpsertAsset() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''

  return useMutation({
    mutationFn: (asset: Omit<LocalAsset, 'updated_at'>) =>
      apiUpsertAsset(asset),

    onMutate: async (newAsset) => {
      // Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: assetKeys.all(tenantId) })

      // Snapshot previous value
      const previous = queryClient.getQueryData<LocalAsset[]>(
        assetKeys.all(tenantId),
      )

      // Optimistically write to Dexie
      const optimistic: LocalAsset = {
        ...newAsset,
        updated_at: new Date().toISOString(),
      }
      await db.assets.put(optimistic)

      // Optimistically update React Query cache
      queryClient.setQueryData<LocalAsset[]>(
        assetKeys.all(tenantId),
        (old = []) => {
          const idx = old.findIndex((a) => a.id === optimistic.id)
          return idx >= 0
            ? old.map((a) => (a.id === optimistic.id ? optimistic : a))
            : [...old, optimistic]
        },
      )

      return { previous }
    },

    onError: (_err, _newAsset, context) => {
      // Roll back
      if (context?.previous) {
        queryClient.setQueryData(assetKeys.all(tenantId), context.previous)
      }
    },

    onSuccess: (saved) => {
      // Update detail cache
      queryClient.setQueryData(assetKeys.detail(tenantId, saved.id), saved)
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: assetKeys.all(tenantId) })
    },
  })
}
