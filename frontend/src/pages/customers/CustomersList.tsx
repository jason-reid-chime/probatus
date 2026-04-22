import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Building2, Pencil } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

interface Customer {
  id: string
  tenant_id: string
  name: string
  address: string | null
  contact: string | null
  created_at: string
  assets: { count: number }[]
}

export default function CustomersList() {
  const { profile } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile?.tenant_id) return
    setLoading(true)
    supabase
      .from('customers')
      .select('*, assets(count)')
      .eq('tenant_id', profile.tenant_id)
      .order('name')
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
        } else {
          setCustomers((data as Customer[]) ?? [])
        }
        setLoading(false)
      })
  }, [profile?.tenant_id])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage the customers associated with your assets
          </p>
        </div>
        <Link
          to="/customers/new"
          className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors"
        >
          <Plus size={16} /> Add Customer
        </Link>
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          Failed to load customers: {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && customers.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <Building2 size={48} className="mb-4 text-gray-300" />
          <h2 className="mb-1 text-xl font-semibold text-gray-700">No customers yet</h2>
          <p className="mb-6 text-base text-gray-500">
            Add your first customer to associate them with assets.
          </p>
          <Link
            to="/customers/new"
            className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Plus size={16} /> Add First Customer
          </Link>
        </div>
      )}

      {/* Table */}
      {!loading && !error && customers.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-700">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-700 hidden sm:table-cell">Address</th>
                <th className="px-4 py-3 font-semibold text-gray-700 hidden md:table-cell">Contact</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Assets</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const assetCount = c.assets?.[0]?.count ?? 0
                return (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">
                      {c.address ?? <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                      {c.contact ?? <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                        {assetCount} asset{assetCount !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end">
                        <Link
                          to={`/customers/${c.id}/edit`}
                          className="p-2 text-gray-400 hover:text-brand-500 rounded-lg transition-colors"
                          aria-label={`Edit ${c.name}`}
                        >
                          <Pencil size={16} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
