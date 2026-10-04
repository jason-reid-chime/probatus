import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Receipt } from 'lucide-react'
import { listInvoices, formatMoney, type InvoiceStatus } from '../../lib/api/invoices'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'

const FILTERS: { value: InvoiceStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
]

export default function InvoicesList() {
  const [status, setStatus] = useState<InvoiceStatus | ''>('')
  const { data, isLoading, error } = useQuery({
    queryKey: ['invoices', status],
    queryFn: () => listInvoices(status || undefined),
  })
  const outstanding = (data ?? []).filter((i) => i.status === 'sent')
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">
            {status === '' && outstanding.length > 0
              ? `${outstanding.length} outstanding · ${outstanding.filter((i) => i.due_date && i.due_date < today).length} past due`
              : 'Bill customers for completed calibration work.'}
          </p>
        </div>
        <Link to="/invoices/new" className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors">
          <Plus size={16} aria-hidden /> New invoice
        </Link>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={status === f.value}
            onClick={() => setStatus(f.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${status === f.value ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{(error as Error).message}</div>
      ) : !data || data.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <Receipt size={48} className="mb-4 text-gray-300" aria-hidden />
          <h2 className="mb-1 text-xl font-semibold text-gray-700">No invoices{status ? ` marked ${status}` : ' yet'}</h2>
          <p className="text-gray-500">Create one here, or from a completed work order.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-700">Number</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Customer</th>
                <th className="px-4 py-3 font-semibold text-gray-700 hidden sm:table-cell">Issued</th>
                <th className="px-4 py-3 font-semibold text-gray-700 hidden md:table-cell">Due</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Total</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><Link to={`/invoices/${inv.id}`} className="font-semibold text-gray-900 hover:text-brand-600">#{inv.number}</Link></td>
                  <td className="px-4 py-3 text-gray-700">{inv.customer_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{inv.issue_date}</td>
                  <td className={`px-4 py-3 hidden md:table-cell ${inv.status === 'sent' && inv.due_date && inv.due_date < today ? 'font-semibold text-red-700' : 'text-gray-600'}`}>{inv.due_date ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{formatMoney(inv.total, inv.currency)}</td>
                  <td className="px-4 py-3"><InvoiceStatusBadge status={inv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
