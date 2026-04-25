import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Building2, Pencil, Trash2, Loader2, Search, X } from 'lucide-react'
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
  const [search, setSearch] = useState('')

  // Delete modal state
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile?.tenant_id) return
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

  const filteredCustomers = search
    ? customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : customers

  function openDeleteModal(customer: Customer) {
    setDeletingCustomer(customer)
    setDeleteError(null)
  }

  function closeDeleteModal() {
    if (deleteLoading) return
    setDeletingCustomer(null)
    setDeleteError(null)
  }

  async function handleConfirmDelete() {
    if (!deletingCustomer) return
    setDeleteLoading(true)
    setDeleteError(null)

    // Step 1: unlink profiles (portal users) that reference this customer
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ customer_id: null })
      .eq('customer_id', deletingCustomer.id)

    if (profileErr) {
      setDeleteError(profileErr.message)
      setDeleteLoading(false)
      return
    }

    // Step 2: unlink assets
    const { error: unlinkErr } = await supabase
      .from('assets')
      .update({ customer_id: null })
      .eq('customer_id', deletingCustomer.id)

    if (unlinkErr) {
      setDeleteError(unlinkErr.message)
      setDeleteLoading(false)
      return
    }

    // Step 3: delete the customer
    const { error: deleteErr } = await supabase
      .from('customers')
      .delete()
      .eq('id', deletingCustomer.id)

    if (deleteErr) {
      setDeleteError(deleteErr.message)
      setDeleteLoading(false)
      return
    }

    // Remove from local state and close
    setCustomers((prev) => prev.filter((c) => c.id !== deletingCustomer.id))
    setDeleteLoading(false)
    setDeletingCustomer(null)
  }

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

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="search"
          placeholder="Search customers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
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
      {!loading && !error && filteredCustomers.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <Building2 size={48} className="mb-4 text-gray-300" />
          <h2 className="mb-1 text-xl font-semibold text-gray-700">
            {search ? 'No customers match your search' : 'No customers yet'}
          </h2>
          <p className="mb-6 text-base text-gray-500">
            {search ? 'Try a different name.' : 'Add your first customer to associate them with assets.'}
          </p>
          {!search && (
            <Link
              to="/customers/new"
              className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
            >
              <Plus size={16} /> Add First Customer
            </Link>
          )}
        </div>
      )}

      {/* Table */}
      {!loading && !error && filteredCustomers.length > 0 && (
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
              {filteredCustomers.map((c) => {
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
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/customers/${c.id}/edit`}
                          className="p-2 text-gray-400 hover:text-brand-500 rounded-lg transition-colors"
                          aria-label={`Edit ${c.name}`}
                        >
                          <Pencil size={16} />
                        </Link>
                        <button
                          type="button"
                          onClick={() => openDeleteModal(c)}
                          className="p-2 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
                          aria-label={`Delete ${c.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletingCustomer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 space-y-4">
            <h2 id="delete-modal-title" className="text-lg font-bold text-gray-900">
              Delete Customer?
            </h2>
            <p className="text-sm text-gray-600">
              Deleting <strong>{deletingCustomer.name}</strong> will unlink all their assets (assets
              will not be deleted). This cannot be undone.
            </p>

            {deleteError && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleteLoading}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteLoading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-60"
              >
                {deleteLoading && <Loader2 size={14} className="animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
