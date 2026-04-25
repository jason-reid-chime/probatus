import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, X, Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useWorkOrder, useUpsertWorkOrder, useTenantProfiles, type WorkOrderWithAssets } from '../../hooks/useWorkOrders'
import { supabase } from '../../lib/supabase'

interface Customer {
  id: string
  name: string
}

interface Asset {
  id: string
  tag_id: string
  serial_number: string | null
  instrument_type: string
}

interface FormValues {
  title: string
  scheduled_date: string
  customer_id: string
  status: 'open' | 'in_progress' | 'completed' | 'cancelled'
  notes: string
}

const emptyForm: FormValues = {
  title: '',
  scheduled_date: '',
  customer_id: '',
  status: 'open',
  notes: '',
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-base'

function toFormValues(wo: WorkOrderWithAssets): FormValues {
  return {
    title: wo.title,
    scheduled_date: wo.scheduled_date,
    customer_id: wo.customer_id ?? '',
    status: wo.status,
    notes: wo.notes ?? '',
  }
}

interface InnerFormProps {
  id: string | undefined
  initialValues: FormValues
  initialAssetIds: string[]
  initialTechnicianIds: string[]
  profile: { tenant_id: string; id: string } | null
  isEdit: boolean
}

function InnerForm({ id, initialValues, initialAssetIds, initialTechnicianIds, profile, isEdit }: InnerFormProps) {
  const navigate = useNavigate()
  const upsert = useUpsertWorkOrder()
  const { data: tenantProfiles = [] } = useTenantProfiles()

  const [values, setValues] = useState<FormValues>(initialValues)
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(initialAssetIds)
  const [selectedTechIds, setSelectedTechIds] = useState<string[]>(initialTechnicianIds)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [loadingData, setLoadingData] = useState(true)

  const [titleError, setTitleError] = useState<string | null>(null)
  const [dateError, setDateError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile?.tenant_id) return
    Promise.all([
      supabase
        .from('customers')
        .select('id, name')
        .eq('tenant_id', profile.tenant_id)
        .order('name'),
      supabase
        .from('assets')
        .select('id, tag_id, serial_number, instrument_type')
        .eq('tenant_id', profile.tenant_id)
        .order('tag_id'),
    ]).then(([{ data: cData }, { data: aData }]) => {
      setCustomers((cData ?? []) as Customer[])
      setAssets((aData ?? []) as Asset[])
      setLoadingData(false)
    })
  }, [profile?.tenant_id])

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) {
    const { name, value } = e.target
    setValues((prev) => ({ ...prev, [name]: value }))
    if (name === 'title' && titleError) setTitleError(null)
    if (name === 'scheduled_date' && dateError) setDateError(null)
  }

  function toggleAsset(assetId: string) {
    setSelectedAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((i) => i !== assetId) : [...prev, assetId],
    )
  }

  function toggleTech(techId: string) {
    setSelectedTechIds((prev) =>
      prev.includes(techId) ? prev.filter((i) => i !== techId) : [...prev, techId],
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    let valid = true

    if (!values.title.trim()) {
      setTitleError('Title is required')
      valid = false
    }
    if (!values.scheduled_date) {
      setDateError('Scheduled date is required')
      valid = false
    }
    if (!valid) return

    try {
      await upsert.mutateAsync({
        workOrder: {
          id,
          title: values.title.trim(),
          scheduled_date: values.scheduled_date,
          customer_id: values.customer_id || null,
          status: values.status,
          notes: values.notes.trim() || null,
        },
        assetIds: selectedAssetIds,
        technicianIds: selectedTechIds,
      })
      navigate('/work-orders')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  if (loadingData) {
    return (
      <div className="space-y-3 max-w-3xl mx-auto px-4 py-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 text-gray-400 hover:text-gray-700 rounded-lg transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-gray-900">
          {isEdit ? 'Edit Work Order' : 'New Work Order'}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Details */}
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Details</h2>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="title"
              value={values.title}
              onChange={handleChange}
              className={inputClass}
              placeholder="Annual calibration run"
              autoFocus
            />
            {titleError && <p className="text-sm text-red-600">{titleError}</p>}
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Scheduled Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="scheduled_date"
              value={values.scheduled_date}
              onChange={handleChange}
              className={inputClass}
            />
            {dateError && <p className="text-sm text-red-600">{dateError}</p>}
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Customer</label>
            <select name="customer_id" value={values.customer_id} onChange={handleChange} className={inputClass}>
              <option value="">No customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Status</label>
            <select name="status" value={values.status} onChange={handleChange} className={inputClass}>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              name="notes"
              value={values.notes}
              onChange={handleChange}
              rows={3}
              className={`${inputClass} resize-none`}
              placeholder="Any additional notes…"
            />
          </div>
        </div>

        {/* Technicians */}
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Assigned Technicians
          </h2>

          {selectedTechIds.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2">
              {selectedTechIds.map((techId) => {
                const tech = tenantProfiles.find((t) => t.id === techId)
                if (!tech) return null
                return (
                  <span
                    key={techId}
                    className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700 border border-indigo-200"
                  >
                    {tech.full_name}
                    <button
                      type="button"
                      onClick={() => toggleTech(techId)}
                      className="ml-0.5 text-indigo-400 hover:text-indigo-700"
                      aria-label={`Remove ${tech.full_name}`}
                    >
                      <X size={14} />
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
            {tenantProfiles.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-400 italic">No team members found</p>
            )}
            {tenantProfiles.map((tech) => {
              const selected = selectedTechIds.includes(tech.id)
              return (
                <button
                  key={tech.id}
                  type="button"
                  onClick={() => toggleTech(tech.id)}
                  className={[
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                    selected ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                      selected ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300 bg-white',
                    ].join(' ')}
                  >
                    {selected && (
                      <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    )}
                  </span>
                  <span>{tech.full_name}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Assets */}
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Assets</h2>

          {selectedAssetIds.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2">
              {selectedAssetIds.map((assetId) => {
                const asset = assets.find((a) => a.id === assetId)
                if (!asset) return null
                return (
                  <span
                    key={assetId}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700 border border-brand-200"
                  >
                    {asset.tag_id}
                    {asset.serial_number ? ` · ${asset.serial_number}` : ''}
                    <button
                      type="button"
                      onClick={() => toggleAsset(assetId)}
                      className="ml-0.5 text-brand-500 hover:text-brand-700"
                      aria-label={`Remove ${asset.tag_id}`}
                    >
                      <X size={14} />
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
            {assets.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-400 italic">No assets available</p>
            )}
            {assets.map((asset) => {
              const selected = selectedAssetIds.includes(asset.id)
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => toggleAsset(asset.id)}
                  className={[
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                    selected ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-50',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                      selected ? 'bg-brand-500 border-brand-500' : 'border-gray-300 bg-white',
                    ].join(' ')}
                  >
                    {selected && (
                      <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    )}
                  </span>
                  <span className="font-mono font-semibold">{asset.tag_id}</span>
                  {asset.serial_number && (
                    <span className="text-gray-500">S/N: {asset.serial_number}</span>
                  )}
                  <span className="ml-auto text-xs text-gray-400 capitalize">
                    {asset.instrument_type.replace(/_/g, ' ')}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {submitError && <p className="text-sm text-red-600">{submitError}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-1 border border-gray-300 text-gray-700 font-semibold py-3 rounded-xl transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={upsert.isPending}
            className="flex-1 bg-brand-500 hover:bg-brand-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors inline-flex items-center justify-center gap-2"
          >
            {upsert.isPending && <Loader2 size={16} className="animate-spin" />}
            {upsert.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Work Order'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function WorkOrderForm() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const isEdit = Boolean(id)

  const { data: existing, isLoading: loadingExisting } = useWorkOrder(id ?? '')

  if (isEdit && loadingExisting) {
    return (
      <div className="space-y-3 max-w-3xl mx-auto px-4 py-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <InnerForm
      key={existing?.id ?? 'new'}
      id={id}
      initialValues={existing ? toFormValues(existing) : emptyForm}
      initialAssetIds={existing?.assets.map((a) => a.id) ?? []}
      initialTechnicianIds={existing?.technicians.map((t) => t.id) ?? []}
      profile={profile}
      isEdit={isEdit}
    />
  )
}
