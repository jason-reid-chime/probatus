import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import {
  fetchTemplates,
  upsertTemplate,
  deleteTemplate,
} from '../lib/api/templates'
import type { CalibrationTemplate } from '../types'

export function useTemplates(instrumentType?: string) {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['templates', profile?.tenant_id, instrumentType],
    queryFn: () => fetchTemplates(profile!.tenant_id, instrumentType),
    enabled: !!profile?.tenant_id,
  })
}

export function useTemplate(id: string | undefined) {
  const { data: templates } = useTemplates()
  return templates?.find((t) => t.id === id) ?? null
}

export function useUpsertTemplate() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: (t: CalibrationTemplate) =>
      upsertTemplate({ ...t, tenant_id: profile!.tenant_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates', profile?.tenant_id] })
    },
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  return useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates', profile?.tenant_id] })
    },
  })
}
