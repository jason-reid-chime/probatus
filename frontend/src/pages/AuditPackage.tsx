import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FileCheck, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { generateAuditPackage } from '../lib/api/audit'

interface Customer { id: string; name: string }

const schema = z.object({
  start_date: z.string().min(1, 'Start date is required'),
  end_date:   z.string().min(1, 'End date is required'),
  customer_id: z.string().optional(),
}).refine(d => d.end_date >= d.start_date, {
  message: 'End date must be on or after start date',
  path: ['end_date'],
})

type FormValues = z.infer<typeof schema>

const INCLUDED = [
  'Executive summary with pass/fail statistics',
  'Master standards with NRC/NIST traceability chain',
  'Full calibration records with measurement tables',
  'Asset register with current calibration status',
  'Formatted for ISO/IEC 17025:2017 audit review',
]

export default function AuditPackage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  if (profile?.role === 'technician') {
    navigate('/', { replace: true })
    return null
  }

  useEffect(() => {
    supabase.from('customers').select('id, name').order('name').then(({ data }) => {
      if (data) setCustomers(data)
    })
  }, [])

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      start_date: new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10),
      end_date:   new Date().toISOString().slice(0, 10),
    },
  })

  async function onSubmit(values: FormValues) {
    setGenerating(true)
    setError(null)
    setSuccess(false)
    try {
      const blob = await generateAuditPackage({
        start_date:  values.start_date,
        end_date:    values.end_date,
        customer_id: values.customer_id || undefined,
      })
      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href     = url
      a.download = `audit-package-${new Date().toISOString().slice(0, 10)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate package')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-3 bg-brand-50 rounded-xl">
          <FileCheck size={28} className="text-brand-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Package Generator</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generate a complete ISO/IEC 17025 audit package for any date range — ready to hand to your assessor.
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Date Range</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Start Date <span className="text-red-500">*</span>
              </label>
              <input
                {...register('start_date')}
                type="date"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {errors.start_date && (
                <p className="text-xs text-red-600">{errors.start_date.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                End Date <span className="text-red-500">*</span>
              </label>
              <input
                {...register('end_date')}
                type="date"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {errors.end_date && (
                <p className="text-xs text-red-600">{errors.end_date.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Customer <span className="text-gray-400 font-normal">(optional — leave blank for all customers)</span>
            </label>
            <select
              {...register('customer_id')}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white"
            >
              <option value="">All customers</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* What's included */}
        <div className="bg-gray-50 rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-600 mb-3">What's included</h2>
          <ul className="space-y-2">
            {INCLUDED.map(item => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                <CheckCircle size={16} className="text-green-500 shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">Failed to generate package</p>
              <p className="text-sm text-red-600 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Success */}
        {success && !generating && (
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
            <CheckCircle size={18} className="text-green-600" />
            <p className="text-sm font-semibold text-green-700">Package downloaded successfully.</p>
          </div>
        )}

        <button
          type="submit"
          disabled={generating}
          className="w-full inline-flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl min-h-[56px] px-6 py-3 transition-colors"
        >
          {generating ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Generating… this may take a few seconds
            </>
          ) : (
            <>
              <FileCheck size={20} />
              Generate Audit Package (PDF)
            </>
          )}
        </button>
      </form>
    </div>
  )
}
