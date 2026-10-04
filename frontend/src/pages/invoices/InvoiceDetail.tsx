import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Printer, Trash2, Loader2, Send, CheckCircle2, Ban, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  type Invoice,
  type InvoiceInput,
  type InvoiceLine,
  createInvoice,
  deleteInvoice,
  formatMoney,
  getInvoice,
  invoiceTotals,
  lineAmount,
  setInvoiceStatus,
  updateInvoice,
} from '../../lib/api/invoices'
import { InvoiceStatusBadge } from './InvoiceStatusBadge'

interface CustomerOption { id: string; name: string; email: string | null }

const emptyLine = (): InvoiceLine => ({ description: '', quantity: 1, unit_price: 0, asset_id: null, record_id: null })
const inputClass = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'

function toInput(inv: Invoice): InvoiceInput {
  return {
    customer_id: inv.customer_id,
    work_order_id: inv.work_order_id,
    issue_date: inv.issue_date,
    due_date: inv.due_date,
    currency: inv.currency,
    tax_rate: inv.tax_rate,
    notes: inv.notes,
    lines: inv.lines ?? [],
  }
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { profile } = useAuth()

  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => getInvoice(id!), enabled: !isNew })
  const customers = useQuery({
    queryKey: ['customers', 'options', profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('id, name, email').eq('tenant_id', profile!.tenant_id).order('name')
      if (error) throw error
      return (data ?? []) as CustomerOption[]
    },
  })
  const tenant = useQuery({
    queryKey: ['tenant', profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data } = await supabase.from('tenants').select('name').eq('id', profile!.tenant_id).maybeSingle()
      return (data as { name: string } | null)?.name ?? ''
    },
  })

  const [form, setForm] = useState<InvoiceInput | null>(
    isNew ? { customer_id: null, due_date: null, currency: 'CAD', tax_rate: 0, notes: null, lines: [emptyLine()] } : null,
  )
  const [editing, setEditing] = useState(isNew)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'delete' | 'void'>(null)
  const [emailOnSend, setEmailOnSend] = useState(true)

  useEffect(() => {
    if (invoice.data && !form) setForm(toInput(invoice.data))
  }, [invoice.data, form])

  if (!isNew && invoice.isLoading) return <div className="max-w-4xl mx-auto px-4 py-6"><div className="h-60 animate-pulse rounded-2xl bg-gray-100" /></div>
  if (!isNew && invoice.error) return <div className="max-w-4xl mx-auto px-4 py-6 text-red-600">{(invoice.error as Error).message}</div>
  if (!form) return null

  const inv = invoice.data
  const status = inv?.status ?? 'draft'
  const canEdit = status === 'draft'
  const totals = invoiceTotals(form.lines, form.tax_rate)
  const customer = customers.data?.find((c) => c.id === form.customer_id)

  const patch = (p: Partial<InvoiceInput>) => setForm({ ...form, ...p })
  const patchLine = (i: number, p: Partial<InvoiceLine>) =>
    patch({ lines: form.lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)) })

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^API \w+ \S+: \d+ /, '') : String(err))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const save = () => run(async () => {
    const body = { ...form, lines: form.lines.filter((l) => l.description.trim()) }
    if (isNew) {
      const { id: newId } = await createInvoice(body)
      await qc.invalidateQueries({ queryKey: ['invoices'] })
      navigate(`/invoices/${newId}`, { replace: true })
    } else {
      await updateInvoice(id!, body)
      await qc.invalidateQueries({ queryKey: ['invoice', id] })
      await qc.invalidateQueries({ queryKey: ['invoices'] })
      setForm(null) // reload from server
      setEditing(false)
    }
  })

  const changeStatus = (next: 'sent' | 'paid' | 'void') => run(async () => {
    await setInvoiceStatus(id!, next, next === 'sent' && emailOnSend && !!inv?.customer_email)
    await qc.invalidateQueries({ queryKey: ['invoice', id] })
    await qc.invalidateQueries({ queryKey: ['invoices'] })
  })

  const remove = () => run(async () => {
    await deleteInvoice(id!)
    await qc.invalidateQueries({ queryKey: ['invoices'] })
    navigate('/invoices')
  })

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link to="/invoices" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} aria-hidden /> Invoices</Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!isNew && !editing && (
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <Printer size={16} aria-hidden /> Print / PDF
            </button>
          )}
          {!isNew && canEdit && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <Pencil size={16} aria-hidden /> Edit
            </button>
          )}
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">{error}</p>}

      <article className="rounded-2xl border border-gray-200 bg-white p-6 space-y-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-lg font-black tracking-wide text-brand-700">{tenant.data || 'Invoice'}</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">{isNew ? 'New invoice' : `Invoice #${inv!.number}`}</h1>
            {!isNew && <div className="mt-1 print:hidden"><InvoiceStatusBadge status={status} /></div>}
          </div>
          <div className="grid grid-cols-[auto,auto] gap-x-3 gap-y-1 text-sm">
            <span className="text-gray-500">Issued</span>
            {editing ? <input type="date" aria-label="Issue date" className={inputClass} value={form.issue_date ?? new Date().toISOString().slice(0, 10)} onChange={(e) => patch({ issue_date: e.target.value })} /> : <span>{form.issue_date}</span>}
            <span className="text-gray-500">Due</span>
            {editing ? <input type="date" aria-label="Due date" className={inputClass} value={form.due_date ?? ''} onChange={(e) => patch({ due_date: e.target.value || null })} /> : <span>{form.due_date ?? '—'}</span>}
            {!editing && inv?.paid_at && (<><span className="text-gray-500">Paid</span><span>{new Date(inv.paid_at).toLocaleDateString()}</span></>)}
          </div>
        </header>

        <div className="text-sm">
          <p className="text-gray-500">Bill to</p>
          {editing ? (
            <select aria-label="Customer" className={`${inputClass} mt-1 max-w-sm`} value={form.customer_id ?? ''} onChange={(e) => patch({ customer_id: e.target.value || null })}>
              <option value="">No customer</option>
              {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <p className="font-semibold text-gray-900">{inv?.customer_name ?? customer?.name ?? '—'}{inv?.customer_email && <span className="block font-normal text-gray-500">{inv.customer_email}</span>}</p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left">
              <tr>
                <th className="py-2 pr-2 font-semibold text-gray-700">Description</th>
                <th className="w-20 py-2 px-2 text-right font-semibold text-gray-700">Qty</th>
                <th className="w-28 py-2 px-2 text-right font-semibold text-gray-700">Unit price</th>
                <th className="w-28 py-2 pl-2 text-right font-semibold text-gray-700">Amount</th>
                {editing && <th className="w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {form.lines.map((l, i) => (
                <tr key={l.id ?? i}>
                  <td className="py-2 pr-2">
                    {editing ? <input aria-label={`Line ${i + 1} description`} className={inputClass} value={l.description} onChange={(e) => patchLine(i, { description: e.target.value })} placeholder="Calibration — PT-101" /> : <>{l.description}{l.asset_tag && <Link to={`/assets/${l.asset_id}`} className="ml-2 text-xs text-brand-600 print:hidden">{l.asset_tag}</Link>}</>}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {editing ? <input aria-label={`Line ${i + 1} quantity`} type="number" min={0} step="any" className={`${inputClass} text-right`} value={l.quantity} onChange={(e) => patchLine(i, { quantity: Number(e.target.value) })} /> : l.quantity}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {editing ? <input aria-label={`Line ${i + 1} unit price`} type="number" step="0.01" className={`${inputClass} text-right`} value={l.unit_price} onChange={(e) => patchLine(i, { unit_price: Number(e.target.value) })} /> : formatMoney(l.unit_price, form.currency)}
                  </td>
                  <td className="py-2 pl-2 text-right tabular-nums">{formatMoney(lineAmount(l), form.currency)}</td>
                  {editing && (
                    <td className="py-2 pl-1 text-right">
                      <button type="button" aria-label={`Remove line ${i + 1}`} onClick={() => patch({ lines: form.lines.filter((_, idx) => idx !== i) })} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} aria-hidden /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {editing && (
            <button type="button" onClick={() => patch({ lines: [...form.lines, emptyLine()] })} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
              <Plus size={15} aria-hidden /> Add line
            </button>
          )}
        </div>

        <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="tabular-nums">{formatMoney(totals.subtotal, form.currency)}</span></div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-500">Tax {editing ? '' : `(${form.tax_rate}%)`}</span>
            {editing && (
              <span className="flex items-center gap-1">
                <input aria-label="Tax rate percent" type="number" min={0} max={100} step="0.001" className={`${inputClass} w-20 text-right`} value={form.tax_rate} onChange={(e) => patch({ tax_rate: Number(e.target.value) })} />%
              </span>
            )}
            <span className="tabular-nums">{formatMoney(totals.tax, form.currency)}</span>
          </div>
          <div className="flex justify-between border-t border-gray-200 pt-1 text-base font-bold"><span>Total</span><span className="tabular-nums">{formatMoney(totals.total, form.currency)}</span></div>
          {editing && (
            <label className="flex items-center justify-between gap-2 pt-1 text-gray-500">Currency
              <input aria-label="Currency" maxLength={3} className={`${inputClass} w-20 uppercase`} value={form.currency} onChange={(e) => patch({ currency: e.target.value.toUpperCase() })} />
            </label>
          )}
        </div>

        {editing ? (
          <label className="block text-sm text-gray-500">Notes
            <textarea rows={2} className={`${inputClass} mt-1`} value={form.notes ?? ''} onChange={(e) => patch({ notes: e.target.value || null })} placeholder="Payment terms, PO number…" />
          </label>
        ) : form.notes ? (
          <p className="whitespace-pre-wrap text-sm text-gray-600">{form.notes}</p>
        ) : null}
      </article>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {editing ? (
          <>
            <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
              {busy && <Loader2 size={16} className="animate-spin" aria-hidden />} {isNew ? 'Create draft' : 'Save draft'}
            </button>
            {!isNew && <button type="button" onClick={() => { setForm(toInput(inv!)); setEditing(false) }} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>}
          </>
        ) : (
          <>
            {status === 'draft' && (
              <>
                <button type="button" onClick={() => changeStatus('sent')} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                  <Send size={16} aria-hidden /> Mark as sent
                </button>
                {inv?.customer_email && (
                  <label className="flex items-center gap-1.5 text-sm text-gray-600">
                    <input type="checkbox" checked={emailOnSend} onChange={(e) => setEmailOnSend(e.target.checked)} className="rounded border-gray-300" /> Email to {inv.customer_email}
                  </label>
                )}
              </>
            )}
            {status === 'sent' && (
              <button type="button" onClick={() => changeStatus('paid')} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                <CheckCircle2 size={16} aria-hidden /> Mark as paid
              </button>
            )}
            <span className="ml-auto flex items-center gap-2">
              {confirm ? (
                <>
                  <span className="text-sm text-gray-600">{confirm === 'delete' ? 'Delete this draft?' : 'Void this invoice? It stays on record.'}</span>
                  <button type="button" onClick={confirm === 'delete' ? remove : () => changeStatus('void')} disabled={busy} className="text-sm font-semibold text-red-600 underline">Yes</button>
                  <button type="button" onClick={() => setConfirm(null)} className="text-sm text-gray-500 underline">No</button>
                </>
              ) : status === 'draft' ? (
                <button type="button" onClick={() => setConfirm('delete')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700"><Trash2 size={15} aria-hidden /> Delete draft</button>
              ) : status === 'sent' ? (
                <button type="button" onClick={() => setConfirm('void')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700"><Ban size={15} aria-hidden /> Void</button>
              ) : null}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
