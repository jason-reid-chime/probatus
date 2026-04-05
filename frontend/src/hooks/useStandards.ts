import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { fetchStandards, upsertStandard, deleteStandard } from '../lib/api/standards'
import type { MasterStandard } from '../types'

export function useStandards() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['standards', profile?.tenant_id],
    queryFn: () => fetchStandards(profile!.tenant_id),
    enabled: !!profile?.tenant_id,
  })
}

export function useStandard(id: string | undefined) {
  const { data: standards } = useStandards()
  return standards?.find((s) => s.id === id) ?? null
}

export function useUpsertStandard() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: (standard: MasterStandard) =>
      upsertStandard({ ...standard, tenant_id: profile!.tenant_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['standards', profile?.tenant_id] })
    },
  })
}

export function useDeleteStandard() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: deleteStandard,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['standards', profile?.tenant_id] })
    },
  })
}
