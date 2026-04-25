import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useCustomerFilter } from './useCustomerFilter'

export interface WorkOrder {
  id: string
  tenant_id: string
  customer_id: string | null
  title: string
  notes: string | null
  scheduled_date: string
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  created_by: string | null
  created_at: string
  updated_at: string
  customer?: { name: string } | null
  work_order_assets?: { count: number }[]
}

export interface WorkOrderWithAssets extends WorkOrder {
  assets: {
    id: string
    tag_id: string
    instrument_type: string
    serial_number: string | null
    manufacturer: string | null
    model: string | null
  }[]
}

const workOrderKeys = {
  all: (tenantId: string) => ['work-orders', tenantId] as const,
  detail: (tenantId: string, id: string) => ['work-orders', tenantId, id] as const,
}

export function useWorkOrders() {
  const { profile } = useAuth()
  const { selectedCustomerId } = useCustomerFilter()
  const tenantId = profile?.tenant_id ?? ''

  return useQuery({
    queryKey: [...workOrderKeys.all(tenantId), selectedCustomerId],
    queryFn: async (): Promise<WorkOrder[]> => {
      let query = supabase
        .from('work_orders')
        .select('*, customer:customers(name), work_order_assets(count)')
        .eq('tenant_id', tenantId)
        .order('scheduled_date', { ascending: false })

      if (selectedCustomerId) {
        query = query.eq('customer_id', selectedCustomerId)
      }

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as WorkOrder[]
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
  })
}

export function useWorkOrder(id: string) {
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''

  return useQuery({
    queryKey: workOrderKeys.detail(tenantId, id),
    queryFn: async (): Promise<WorkOrderWithAssets | null> => {
      const { data, error } = await supabase
        .from('work_orders')
        .select(`
          *,
          customer:customers(name),
          work_order_assets(
            asset:assets(id, tag_id, instrument_type, serial_number, manufacturer, model)
          )
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      if (!data) return null

      type AssetRow = WorkOrderWithAssets['assets'][number]
      const rawJoin = (data as unknown as { work_order_assets: { asset: AssetRow | null }[] }).work_order_assets ?? []
      const assets = rawJoin.map((woa) => woa.asset).filter((a): a is AssetRow => a !== null)

      return { ...data, assets } as WorkOrderWithAssets
    },
    enabled: !!tenantId && !!id,
    staleTime: 1000 * 60 * 5,
  })
}

export function useUpsertWorkOrder() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''

  return useMutation({
    mutationFn: async ({
      workOrder,
      assetIds,
    }: {
      workOrder: Partial<WorkOrder> & { title: string; scheduled_date: string }
      assetIds: string[]
    }) => {
      const id = workOrder.id ?? crypto.randomUUID()

      const record = {
        id,
        tenant_id: tenantId,
        customer_id: workOrder.customer_id ?? null,
        title: workOrder.title,
        notes: workOrder.notes ?? null,
        scheduled_date: workOrder.scheduled_date,
        status: workOrder.status ?? 'open',
        created_by: profile?.id ?? null,
      }

      const { error: upsertError } = await supabase.from('work_orders').upsert(record)
      if (upsertError) throw upsertError

      const { error: deleteError } = await supabase
        .from('work_order_assets')
        .delete()
        .eq('work_order_id', id)
      if (deleteError) throw deleteError

      if (assetIds.length > 0) {
        const rows = assetIds.map((assetId) => ({ work_order_id: id, asset_id: assetId }))
        const { error: insertError } = await supabase.from('work_order_assets').insert(rows)
        if (insertError) throw insertError
      }

      return id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workOrderKeys.all(tenantId) })
    },
  })
}

export function useDeleteWorkOrder() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''

  return useMutation({
    mutationFn: async (id: string) => {
      const { error: deleteAssetsError } = await supabase
        .from('work_order_assets')
        .delete()
        .eq('work_order_id', id)
      if (deleteAssetsError) throw deleteAssetsError

      const { error } = await supabase.from('work_orders').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workOrderKeys.all(tenantId) })
    },
  })
}
