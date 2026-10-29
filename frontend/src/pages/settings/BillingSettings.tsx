import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Receipt } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { type BillingSettings as Settings, saveBillingSettings, useBillingSettings } from '../../lib/api/billing'

const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500'

export default function BillingSettings() {
  const settings = useBillingSettings()
  if (settings.isLoading || !settings.data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        {settings.error
          ? <p role="alert" className="text-sm text-red-600">{(settings.error as Error).message}</p>
          : <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />}
      </div>
    )
  }
  return <BillingSettingsForm initial={settings.data} />
}

function BillingSettingsForm({ initial }: { initial: Settings }) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const [taxNumber, setTaxNumber] = useState(initial.tax_number ?? '')
  const [taxLabel, setTaxLabel] = useState(initial.tax_label)
  const [rate, setRate] = useState(String(initial.default_tax_rate))
  const [saved, setSaved] = useState(false)

  const rateNum = Number(rate)
  const rateValid = rate.trim() !== '' && Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100

  const save = useMutation({
    mutationFn: (s: Settings) => saveBillingSettings(profile!.tenant_id, s),
    onSuccess: (s) => {
      qc.setQueryData(['billing-settings', profile?.tenant_id], s)
      setSaved(true)
    },
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!rateValid) return
    save.mutate({ tax_number: taxNumber, tax_label: taxLabel, default_tax_rate: rateNum })
  }

  const change = <T,>(set: (v: T) => void) => (v: T) => { setSaved(false); set(v) }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-2">
        <Receipt className="text-brand-600" size={22} />
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white px-5 py-5 space-y-4 shadow-sm">
        <label className="block text-sm">
          <span className="font-medium text-gray-700">HST / GST registration number</span>
          <input className={`${inputClass} mt-1`} value={taxNumber} onChange={(e) => change(setTaxNumber)(e.target.value)} placeholder="123456789 RT0001" />
          <span className="mt-1 block text-xs text-gray-500">Printed on every invoice. Leave blank if you aren't registered.</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Tax name on invoices</span>
            <input className={`${inputClass} mt-1`} value={taxLabel} onChange={(e) => change(setTaxLabel)(e.target.value)} placeholder="HST" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-gray-700">Default tax rate (%)</span>
            <input aria-label="Default tax rate percent" type="number" min={0} max={100} step="0.001" className={`${inputClass} mt-1`} value={rate} onChange={(e) => change(setRate)(e.target.value)} />
            {!rateValid && <span role="alert" className="mt-1 block text-xs text-red-600">Enter a rate between 0 and 100.</span>}
          </label>
        </div>
        <p className="text-xs text-gray-500">New invoices start with this rate. Existing invoices keep the rate they were created with.</p>

        {save.error && <p role="alert" className="text-sm text-red-600">{(save.error as Error).message}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={save.isPending || !rateValid} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
            {save.isPending && <Loader2 size={16} className="animate-spin" />}
            Save
          </button>
          {saved && <span className="text-sm text-green-700">Saved</span>}
        </div>
      </form>
    </div>
  )
}
