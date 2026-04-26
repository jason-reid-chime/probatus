import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { apiRequest } from '../lib/api/client'
import { useAuth } from './useAuth'
import { useCustomerFilter } from './useCustomerFilter'

export interface Technician {
  id: string
  full_name: string
}

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
  work_order_technicians?: { count: number }[]
  technicians?: Technician[]
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
  technicians: Technician[]
}

const workOrderKeys = {
  all: (tenantId: string) => ['work-orders', tenantId] as const,
  detail: (tenantId: string, id: string) => ['work-orders', tenantId, id] as const,
}

export function useWorkOrders() {
  const { profile } = useAuth()
  const { selectedCustomerId } = useCustomerFilter()
  const tenantId = profile?.tenant_id ?? ''
  const userId = profile?.id ?? ''
  const role = profile?.role ?? ''

  return useQuery({
    queryKey: [...workOrderKeys.all(tenantId), selectedCustomerId, userId],
    queryFn: async (): Promise<WorkOrder[]> => {
      let query = supabase
        .from('work_orders')
        .select('*, customer:customers(name), work_order_assets(count), work_order_technicians(count)')
        .eq('tenant_id', tenantId)
        .order('scheduled_date', { ascending: false })

      if (selectedCustomerId) {
        query = query.eq('customer_id', selectedCustomerId)
      }

      // Technicians only see work orders they're assigned to
      if (role === 'technician') {
        query = query.eq('work_order_technicians.technician_id', userId)
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
          ),
          work_order_technicians(
            technician:profiles(id, full_name)
          )
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      if (!data) return null

      type AssetRow = WorkOrderWithAssets['assets'][number]
      const rawAssets = (data as unknown as { work_order_assets: { asset: AssetRow | null }[] }).work_order_assets ?? []
      const assets = rawAssets.map((woa) => woa.asset).filter((a): a is AssetRow => a !== null)

      const rawTechs = (data as unknown as { work_order_technicians: { technician: Technician | null }[] }).work_order_technicians ?? []
      const technicians = rawTechs.map((wot) => wot.technician).filter((t): t is Technician => t !== null)

      return { ...data, assets, technicians } as WorkOrderWithAssets
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
      technicianIds,
    }: {
      workOrder: Partial<WorkOrder> & { title: string; scheduled_date: string }
      assetIds: string[]
      technicianIds: string[]
    }) => {
      if (workOrder.id) {
        // update
        await apiRequest('PUT', `/work-orders/${workOrder.id}`, {
          title: workOrder.title,
          notes: workOrder.notes,
          scheduled_date: workOrder.scheduled_date,
          status: workOrder.status,
          customer_id: workOrder.customer_id,
          asset_ids: assetIds,
          technician_ids: technicianIds,
        })
        return workOrder.id
      } else {
        // create
        const result = await apiRequest<{ id: string }>('POST', '/work-orders', {
          title: workOrder.title,
          notes: workOrder.notes,
          scheduled_date: workOrder.scheduled_date,
          status: workOrder.status ?? 'open',
          customer_id: workOrder.customer_id,
          asset_ids: assetIds,
          technician_ids: technicianIds,
        })
        return result.id
      }
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
      await apiRequest('DELETE', `/work-orders/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workOrderKeys.all(tenantId) })
    },
  })
}

export function useUpdateWorkOrderStatus() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest('PATCH', `/work-orders/${id}/status`, { status })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workOrderKeys.all(tenantId) })
    },
  })
}

export function useTenantProfiles() {
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''

  return useQuery({
    queryKey: ['profiles', tenantId],
    queryFn: async (): Promise<Technician[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('tenant_id', tenantId)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as Technician[]
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 10,
  })
}
