import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTemplate, useUpsertTemplate } from '../../hooks/useTemplates'
import type { TemplatePoint } from '../../types'

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------
const pointSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  standard_value: z.union([z.number(), z.null()]),
  unit: z.string(),
})

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  instrument_type: z.enum([
    'pressure',
    'temperature',
    'ph_conductivity',
    'level_4_20ma',
    'other',
  ]),
  tolerance_pct: z
    .number({ invalid_type_error: 'Must be a number' })
    .min(0, 'Must be ≥ 0')
    .max(100, 'Must be ≤ 100'),
  points: z
    .array(pointSchema)
    .min(1, 'At least one test point is required'),
})

type FormValues = z.infer<typeof schema>

// ---------------------------------------------------------------------------
// Default points per instrument type
// ---------------------------------------------------------------------------
function defaultPoints(
  type: FormValues['instrument_type'],
): TemplatePoint[] {
  switch (type) {
    case 'pressure':
    case 'level_4_20ma':
      return [
        { label: '0%', standard_value: 0, unit: '' },
        { label: '25%', standard_value: 25, unit: '' },
        { label: '50%', standard_value: 50, unit: '' },
        { label: '75%', standard_value: 75, unit: '' },
        { label: '100%', standard_value: 100, unit: '' },
      ]
    case 'temperature':
      return [
        { label: 'Low', standard_value: null, unit: '°C' },
        { label: 'Mid', standard_value: null, unit: '°C' },
        { label: 'High', standard_value: null, unit: '°C' },
      ]
    case 'ph_conductivity':
      return [
        { label: 'pH Reading', standard_value: null, unit: 'pH' },
        { label: 'Conductivity', standard_value: null, unit: 'µS/cm' },
      ]
    case 'other':
    default:
      return [{ label: '', standard_value: null, unit: '' }]
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const INSTRUMENT_TYPES: {
  value: FormValues['instrument_type']
  label: string
}[] = [
  { value: 'pressure', label: 'Pressure' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'ph_conductivity', label: 'pH / Conductivity' },
  { value: 'level_4_20ma', label: 'Level (4–20 mA)' },
  { value: 'other', label: 'Other' },
]

export default function TemplateForm() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const existing = useTemplate(id)
  const upsert = useUpsertTemplate()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      description: '',
      instrument_type: 'pressure',
      tolerance_pct: 1.0,
      points: defaultPoints('pressure'),
    },
  })

  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: 'points',
  })

  // Populate from existing template when editing
  useEffect(() => {
    if (existing) {
      reset({
        name: existing.name,
        description: existing.description ?? '',
        instrument_type: existing.instrument_type,
        tolerance_pct: existing.tolerance_pct,
        points: existing.points,
      })
    }
  }, [existing, reset])

  // When instrument type changes (only for new templates), replace points with
  // sensible defaults — but don't overwrite when editing.
  const watchedType = watch('instrument_type')
  useEffect(() => {
    if (!existing) {
      replace(defaultPoints(watchedType))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedType])

  if (profile?.role === 'technician') {
    navigate('/', { replace: true })
    return null
  }

  async function onSubmit(values: FormValues) {
    await upsert.mutateAsync({
      id: existing?.id ?? crypto.randomUUID(),
      tenant_id: profile!.tenant_id,
      name: values.name,
      description: values.description || undefined,
      instrument_type: values.instrument_type,
      tolerance_pct: values.tolerance_pct,
      points: values.points,
      created_by: existing?.created_by ?? profile!.id,
      created_at: existing?.created_at ?? new Date().toISOString(),
    })
    navigate('/templates')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/templates')}
          className="p-2 text-gray-400 hover:text-gray-700 rounded-lg transition-colors"
          aria-label="Back to templates"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-gray-900">
          {existing ? 'Edit Template' : 'New Calibration Template'}
        </h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Basic info */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Template Details
          </h2>

          {/* Name */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              {...register('name')}
              type="text"
              placeholder="e.g. Rosemount 3051 Pressure Transmitter"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            {errors.name && (
              <p className="text-sm text-red-600">{errors.name.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Description{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              {...register('description')}
              rows={2}
              placeholder="Brief description of what this template is for…"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Instrument type */}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Instrument Type <span className="text-red-500">*</span>
              </label>
              <select
                {...register('instrument_type')}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white"
              >
                {INSTRUMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {errors.instrument_type && (
                <p className="text-sm text-red-600">
                  {errors.instrument_type.message}
                </p>
              )}
            </div>

            {/* Tolerance % */}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Tolerance % <span className="text-red-500">*</span>
              </label>
              <input
                {...register('tolerance_pct', { valueAsNumber: true })}
                type="number"
                step="0.1"
                min="0"
                max="100"
                placeholder="1.0"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
              {errors.tolerance_pct && (
                <p className="text-sm text-red-600">
                  {errors.tolerance_pct.message}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Test points */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Test Points
            </h2>
            <button
              type="button"
              onClick={() =>
                append({ label: '', standard_value: null, unit: '' })
              }
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors"
            >
              <Plus size={15} />
              Add Row
            </button>
          </div>

          {errors.points?.root && (
            <p className="text-sm text-red-600">
              {errors.points.root.message}
            </p>
          )}
          {errors.points && !Array.isArray(errors.points) && (
            <p className="text-sm text-red-600">
              At least one test point is required.
            </p>
          )}

          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_1fr_40px] gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
            <span>Label</span>
            <span>Standard Value</span>
            <span>Unit</span>
            <span />
          </div>

          {/* Rows */}
          <div className="space-y-2">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="grid grid-cols-[1fr_1fr_1fr_40px] gap-2 items-center"
              >
                {/* Label */}
                <input
                  {...register(`points.${index}.label`)}
                  type="text"
                  placeholder="e.g. 0%"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />

                {/* Standard value */}
                <input
                  {...register(`points.${index}.standard_value`, {
                    setValueAs: (v) =>
                      v === '' || v === null || v === undefined
                        ? null
                        : Number(v),
                  })}
                  type="number"
                  step="any"
                  placeholder="e.g. 0"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />

                {/* Unit */}
                <input
                  {...register(`points.${index}.unit`)}
                  type="text"
                  placeholder="e.g. psi"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => {
                    if (fields.length > 1) remove(index)
                  }}
                  disabled={fields.length <= 1}
                  className="flex items-center justify-center p-2 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
                  aria-label="Remove row"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* API error */}
        {upsert.isError && (
          <p className="text-sm text-red-600">
            {(upsert.error as Error)?.message ?? 'Failed to save template'}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/templates')}
            className="flex-1 border border-gray-300 text-gray-700 font-semibold py-3 rounded-xl transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {isSubmitting ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </form>
    </div>
  )
}
