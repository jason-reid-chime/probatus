import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Receipt, Loader2 } from 'lucide-react'
import { invoiceFromWorkOrder } from '../../lib/api/invoices'

const inputClass = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'

/** Create a draft invoice from a work order: one line per instrument. */
export default function CreateInvoicePanel({ workOrderId, assetCount }: { workOrderId: string; assetCount: number }) {
  const navigate = useNavigate()
  const [unitPrice, setUnitPrice] = useState('')
  const [taxRate, setTaxRate] = useState('13')
  const [currency, setCurrency] = useState('CAD')
  const [dueDays, setDueDays] = useState('30')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { id } = await invoiceFromWorkOrder(workOrderId, {
        unit_price: Number(unitPrice) || 0,
        tax_rate: Number(taxRate) || 0,
        currency: currency.trim().toUpperCase() || 'CAD',
        due_days: Number(dueDays) || 0,
      })
      navigate(`/invoices/${id}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const existing = msg.match(/"id":"([0-9a-f-]{36})"/)
      if (msg.includes(' 409 ') && existing) {
        navigate(`/invoices/${existing[1]}`)
        return
      }
      setError(msg.replace(/^API \w+ \S+: \d+ /, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={create} className="rounded-2xl border border-gray-200 bg-white px-5 py-5 space-y-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Receipt size={18} className="text-gray-400" aria-hidden />
        <h2 className="font-semibold text-gray-900">Invoice this work order</h2>
      </div>
      <p className="text-sm text-gray-500">Creates a draft with one line per instrument ({assetCount}), linked to its latest approved calibration. You can edit it before sending.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-xs font-medium text-gray-600">Price per instrument
          <input type="number" min={0} step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0.00" className={`${inputClass} mt-1`} />
        </label>
        <label className="text-xs font-medium text-gray-600">Tax %
          <input type="number" min={0} max={100} step="0.001" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-xs font-medium text-gray-600">Currency
          <input maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${inputClass} mt-1 uppercase`} />
        </label>
        <label className="text-xs font-medium text-gray-600">Due in (days)
          <input type="number" min={0} value={dueDays} onChange={(e) => setDueDays(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
        {busy && <Loader2 size={16} className="animate-spin" aria-hidden />} Create draft invoice
      </button>
    </form>
  )
}
