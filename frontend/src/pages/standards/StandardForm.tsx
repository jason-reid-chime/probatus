import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useStandard, useUpsertStandard } from '../../hooks/useStandards'

const schema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    serial_number: z.string().min(1, 'Serial number is required'),
    model: z.string().optional(),
    manufacturer: z.string().optional(),
    certificate_ref: z.string().optional(),
    calibrated_at: z.string().min(1, 'Calibration date is required'),
    due_at: z.string().min(1, 'Due date is required'),
    notes: z.string().optional(),
  })
  .refine((d) => d.due_at > d.calibrated_at, {
    message: 'Due date must be after calibration date',
    path: ['due_at'],
  })

type FormValues = z.infer<typeof schema>

export default function StandardForm() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const existing = useStandard(id)
  const upsert = useUpsertStandard()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (existing) {
      reset({
        name: existing.name,
        serial_number: existing.serial_number,
        model: existing.model ?? '',
        manufacturer: existing.manufacturer ?? '',
        certificate_ref: existing.certificate_ref ?? '',
        calibrated_at: existing.calibrated_at,
        due_at: existing.due_at,
        notes: existing.notes ?? '',
      })
    }
  }, [existing, reset])

  if (profile?.role === 'technician') {
    navigate('/', { replace: true })
    return null
  }

  async function onSubmit(values: FormValues) {
    await upsert.mutateAsync({
      id: existing?.id ?? crypto.randomUUID(),
      tenant_id: profile!.tenant_id,
      name: values.name,
      serial_number: values.serial_number,
      model: values.model || undefined,
      manufacturer: values.manufacturer || undefined,
      certificate_ref: values.certificate_ref || undefined,
      calibrated_at: values.calibrated_at,
      due_at: values.due_at,
      notes: values.notes || undefined,
    })
    navigate('/standards')
  }

  const Field = ({
    label, name, type = 'text', required = false,
  }: {
    label: string
    name: keyof FormValues
    type?: string
    required?: boolean
  }) => (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        {...register(name)}
        type={type}
        className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
      />
      {errors[name] && (
        <p className="text-sm text-red-600">{errors[name]?.message as string}</p>
      )}
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/standards')}
          className="p-2 text-gray-400 hover:text-gray-700 rounded-lg transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-gray-900">
          {existing ? 'Edit Standard' : 'New Master Standard'}
        </h1>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Identification</h2>
          <Field label="Name" name="name" required />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Serial Number" name="serial_number" required />
            <Field label="Model" name="model" />
          </div>
          <Field label="Manufacturer" name="manufacturer" />
          <Field label="Certificate Reference" name="certificate_ref" />
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Calibration Dates</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Calibrated At" name="calibrated_at" type="date" required />
            <Field label="Due At" name="due_at" type="date" required />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Notes</h2>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              {...register('notes')}
              rows={3}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
            />
          </div>
        </div>

        {upsert.isError && (
          <p className="text-sm text-red-600">
            {(upsert.error as Error)?.message ?? 'Failed to save standard'}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/standards')}
            className="flex-1 border border-gray-300 text-gray-700 font-semibold py-3 rounded-xl transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {isSubmitting ? 'Saving…' : 'Save Standard'}
          </button>
        </div>
      </form>
    </div>
  )
}
