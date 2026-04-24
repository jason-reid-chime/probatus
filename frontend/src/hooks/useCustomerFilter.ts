import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const STORAGE_KEY = 'probatus_customer_filter'

interface Customer {
  id: string
  name: string
}

interface UseCustomerFilterReturn {
  customers: Customer[]
  selectedCustomerId: string | null
  setSelectedCustomerId: (id: string | null) => void
}

export function useCustomerFilter(): UseCustomerFilterReturn {
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''

  const [selectedCustomerId, setSelectedCustomerIdState] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY) || null
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', 'list', tenantId],
    queryFn: async (): Promise<Customer[]> => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .order('name')
      if (error) throw error
      return (data ?? []) as Customer[]
    },
    enabled: !!tenantId,
    staleTime: 1000 * 60 * 5,
  })

  // If the persisted customer no longer exists in the fetched list, clear it
  useEffect(() => {
    if (
      selectedCustomerId &&
      customers.length > 0 &&
      !customers.find((c) => c.id === selectedCustomerId)
    ) {
      setSelectedCustomerId(null)
    }
  }, [customers, selectedCustomerId])

  const setSelectedCustomerId = (id: string | null) => {
    setSelectedCustomerIdState(id)
    if (id) {
      localStorage.setItem(STORAGE_KEY, id)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  return { customers, selectedCustomerId, setSelectedCustomerId }
}
