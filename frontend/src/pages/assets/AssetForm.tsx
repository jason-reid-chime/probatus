import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, QrCode, Loader2, AlertCircle, X } from 'lucide-react'
import { useAsset, useUpsertAsset, useAssets } from '../../hooks/useAssets'
import { useQrScanner } from '../../hooks/useQrScanner'
import { useAuth } from '../../hooks/useAuth'

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------
const assetSchema = z.object({
  tag_id: z.string().min(1, 'Tag ID is required').max(100),
  // Optional string fields — empty string treated as absent
  serial_number: z.string().max(100).optional(),
  manufacturer: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  instrument_type: z.enum([
    'pressure',
    'temperature',
    'ph_conductivity',
    'conductivity',
    'level_4_20ma',
    'flow',
    'transmitter_4_20ma',
    'pressure_switch',
    'temperature_switch',
    'other',
  ]),
  // Numeric range fields: coerce from string input, blank → undefined
  range_min: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().optional(),
  ),
  range_max: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().optional(),
  ),
  range_unit: z.string().max(20).optional(),
  calibration_interval_days: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? 365 : Number(v)),
    z.number().int().min(1, 'Must be at least 1 day'),
  ),
  location: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
})

type AssetFormValues = z.infer<typeof assetSchema>

// ---------------------------------------------------------------------------
// Form field wrappers
// ---------------------------------------------------------------------------
function Label({ htmlFor, children, required }: { htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block text-base font-medium text-gray-700">
      {children}
      {required && <span className="ml-1 text-red-500">*</span>}
    </label>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-sm text-red-600">
      <AlertCircle size={14} />
      {message}
    </p>
  )
}

const inputClass =
  'block w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-base text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-gray-50'

const selectClass =
  'block w-full min-h-[44px] rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-base text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'

// ---------------------------------------------------------------------------
// QR Scanner Modal (inline, for tag ID population)
// ---------------------------------------------------------------------------
function QrTagModal({
  onClose,
  onScan,
}: {
  onClose: () => void
  onScan: (tagId: string) => void
}) {
  const handleScan = useCallback(
    (tagId: string) => {
      onScan(tagId)
      onClose()
    },
    [onScan, onClose],
  )

  const { scannerRef, startScanner, stopScanner, isScanning } =
    useQrScanner(handleScan)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Scan Tag QR / Barcode</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5">
          <div
            ref={scannerRef}
            id="qr-tag-scanner-container"
            className="mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-xl bg-gray-900"
          />
          <div className="mt-5 flex gap-3">
            {!isScanning ? (
              <button
                type="button"
                onClick={startScanner}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 text-base font-medium text-white active:bg-brand-700"
              >
                <QrCode size={20} />
                Start Camera
              </button>
            ) : (
              <button
                type="button"
                onClick={stopScanner}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-base font-medium text-gray-700"
              >
                Stop Camera
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AssetForm page (create at /assets/new, edit at /assets/:id/edit)
// ---------------------------------------------------------------------------
export default function AssetForm() {
  const { id } = useParams<{ id: string }>()
  const isEditing = Boolean(id)
  const navigate = useNavigate()
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''

  const { data: existingAsset, isLoading: loadingAsset } = useAsset(id ?? '')
  const { data: allAssets } = useAssets()
  const { mutateAsync: upsertAsset, isPending: saving } = useUpsertAsset()

  const [scannerOpen, setScannerOpen] = useState(false)
  const [tagDuplicateWarning, setTagDuplicateWarning] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Default unit/range per instrument type (used for new assets)
  const INSTRUMENT_DEFAULTS: Record<
    AssetFormValues['instrument_type'],
    { unit: string; min: number; max: number }
  > = {
    pressure:            { unit: 'psi',   min: 0,  max: 100  },
    temperature:         { unit: '°C',    min: 0,  max: 150  },
    ph_conductivity:     { unit: 'pH',    min: 0,  max: 14   },
    conductivity:        { unit: 'µS/cm', min: 0,  max: 1000 },
    level_4_20ma:        { unit: 'mA',    min: 4,  max: 20   },
    flow:                { unit: 'mA',    min: 4,  max: 20   },
    transmitter_4_20ma:  { unit: 'mA',    min: 4,  max: 20   },
    pressure_switch:     { unit: 'psi',   min: 0,  max: 100  },
    temperature_switch:  { unit: '°C',    min: 0,  max: 150  },
    other:               { unit: '',      min: 0,  max: 100  },
  }

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<AssetFormValues>({
    resolver: zodResolver(assetSchema) as any,
    defaultValues: {
      instrument_type: 'pressure',
      calibration_interval_days: 365,
    },
  })

  // Populate form when editing
  useEffect(() => {
    if (isEditing && existingAsset) {
      reset({
        tag_id: existingAsset.tag_id,
        serial_number: existingAsset.serial_number ?? '',
        manufacturer: existingAsset.manufacturer ?? '',
        model: existingAsset.model ?? '',
        instrument_type: existingAsset.instrument_type as AssetFormValues['instrument_type'],
        range_min: existingAsset.range_min,
        range_max: existingAsset.range_max,
        range_unit: existingAsset.range_unit ?? '',
        calibration_interval_days: existingAsset.calibration_interval_days,
        location: existingAsset.location ?? '',
        notes: existingAsset.notes ?? '',
      })
    }
  }, [isEditing, existingAsset, reset])

  // Auto-fill unit + range when instrument type changes (new assets only)
  const watchedInstrumentType = watch('instrument_type')
  useEffect(() => {
    if (isEditing) return
    const defaults = INSTRUMENT_DEFAULTS[watchedInstrumentType]
    if (!defaults) return
    setValue('range_unit', defaults.unit, { shouldDirty: false })
    setValue('range_min', defaults.min, { shouldDirty: false })
    setValue('range_max', defaults.max, { shouldDirty: false })
  }, [watchedInstrumentType, isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Duplicate tag ID check
  const watchedTagId = watch('tag_id')
  useEffect(() => {
    if (!watchedTagId || !allAssets) {
      setTagDuplicateWarning(false)
      return
    }
    const duplicate = allAssets.some(
      (a) =>
        a.tag_id.toLowerCase() === watchedTagId.toLowerCase() &&
        a.id !== (existingAsset?.id ?? ''),
    )
    setTagDuplicateWarning(duplicate)
  }, [watchedTagId, allAssets, existingAsset])

  const handleQrScan = useCallback(
    (tagId: string) => {
      setValue('tag_id', tagId, { shouldValidate: true })
    },
    [setValue],
  )

  const onSubmit = async (values: AssetFormValues) => {
    setServerError(null)
    try {
      const assetId = existingAsset?.id ?? crypto.randomUUID()
      const saved = await upsertAsset({
        id: assetId,
        tenant_id: tenantId,
        customer_id: existingAsset?.customer_id,
        tag_id: values.tag_id,
        serial_number: values.serial_number || undefined,
        manufacturer: values.manufacturer || undefined,
        model: values.model || undefined,
        instrument_type: values.instrument_type,
        range_min: values.range_min,
        range_max: values.range_max,
        range_unit: values.range_unit || undefined,
        calibration_interval_days: values.calibration_interval_days,
        last_calibrated_at: existingAsset?.last_calibrated_at,
        next_due_at: existingAsset?.next_due_at,
        location: values.location || undefined,
        notes: values.notes || undefined,
      })
      navigate(`/assets/${saved.id}`, { replace: true })
    } catch (err: unknown) {
      const msg = (err as any)?.message ?? (err instanceof Error ? err.message : JSON.stringify(err))
      setServerError(msg || 'Failed to save asset.')
    }
  }

  if (isEditing && loadingAsset) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 size={32} className="animate-spin text-brand-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            {isEditing ? 'Edit Asset' : 'New Asset'}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
          {/* Server error */}
          {serverError && (
            <div className="flex items-center gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              <AlertCircle size={18} className="flex-shrink-0" />
              {serverError}
            </div>
          )}

          {/* ---- Identification ---- */}
          <section className="rounded-2xl border border-gray-100 bg-white px-5 pb-5 shadow-sm">
            <h2 className="pt-5 pb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
              Identification
            </h2>

            {/* Tag ID + QR scan button */}
            <div className="mb-5">
              <Label htmlFor="tag_id" required>Tag ID</Label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="tag_id"
                  {...register('tag_id')}
                  className={`${inputClass} flex-1`}
                  placeholder="e.g. PG-0042"
                  autoCapitalize="characters"
                />
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 active:bg-gray-100"
                  aria-label="Scan QR code for Tag ID"
                >
                  <QrCode size={20} />
                </button>
              </div>
              {tagDuplicateWarning && (
                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-amber-600">
                  <AlertCircle size={14} />
                  This Tag ID already exists for another asset in your tenant.
                </p>
              )}
              <FieldError message={errors.tag_id?.message} />
            </div>

            {/* Serial Number */}
            <div className="mb-5">
              <Label htmlFor="serial_number">Serial Number</Label>
              <input
                id="serial_number"
                {...register('serial_number')}
                className={`mt-1.5 ${inputClass}`}
                placeholder="e.g. SN-123456"
              />
              <FieldError message={errors.serial_number?.message} />
            </div>

            {/* Manufacturer + Model (side by side on tablet) */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="manufacturer">Manufacturer</Label>
                <input
                  id="manufacturer"
                  {...register('manufacturer')}
                  className={`mt-1.5 ${inputClass}`}
                  placeholder="e.g. Omega"
                />
                <FieldError message={errors.manufacturer?.message} />
              </div>
              <div>
                <Label htmlFor="model">Model</Label>
                <input
                  id="model"
                  {...register('model')}
                  className={`mt-1.5 ${inputClass}`}
                  placeholder="e.g. PX-409"
                />
                <FieldError message={errors.model?.message} />
              </div>
            </div>
          </section>

          {/* ---- Instrument details ---- */}
          <section className="rounded-2xl border border-gray-100 bg-white px-5 pb-5 shadow-sm">
            <h2 className="pt-5 pb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
              Instrument Details
            </h2>

            {/* Instrument Type */}
            <div className="mb-5">
              <Label htmlFor="instrument_type" required>Instrument Type</Label>
              <Controller
                control={control}
                name="instrument_type"
                render={({ field }) => (
                  <select id="instrument_type" {...field} className={`mt-1.5 ${selectClass}`}>
                    <option value="pressure">Pressure (Analog)</option>
                    <option value="temperature">Temperature (Analog)</option>
                    <option value="transmitter_4_20ma">Transmitter (PV + 4-20 mA)</option>
                    <option value="level_4_20ma">Level / 4-20 mA</option>
                    <option value="flow">Flow / 4-20 mA</option>
                    <option value="pressure_switch">Pressure Switch</option>
                    <option value="temperature_switch">Temperature Switch</option>
                    <option value="ph_conductivity">pH / Conductivity</option>
                    <option value="conductivity">Conductivity</option>
                    <option value="other">Other</option>
                  </select>
                )}
              />
              <FieldError message={errors.instrument_type?.message} />
            </div>

            {/* Range min / max / unit */}
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div>
                <Label htmlFor="range_min">Range Min</Label>
                <input
                  id="range_min"
                  type="number"
                  step="any"
                  {...register('range_min')}
                  className={`mt-1.5 ${inputClass}`}
                  placeholder="0"
                />
                <FieldError message={errors.range_min?.message} />
              </div>
              <div>
                <Label htmlFor="range_max">Range Max</Label>
                <input
                  id="range_max"
                  type="number"
                  step="any"
                  {...register('range_max')}
                  className={`mt-1.5 ${inputClass}`}
                  placeholder="100"
                />
                <FieldError message={errors.range_max?.message} />
              </div>
              <div>
                <Label htmlFor="range_unit">Unit</Label>
                <input
                  id="range_unit"
                  {...register('range_unit')}
                  className={`mt-1.5 ${inputClass}`}
                  placeholder={INSTRUMENT_DEFAULTS[watchedInstrumentType]?.unit || 'unit'}
                />
                <FieldError message={errors.range_unit?.message} />
              </div>
            </div>

            {/* Calibration Interval */}
            <div>
              <Label htmlFor="calibration_interval_days" required>Calibration Interval (days)</Label>
              <input
                id="calibration_interval_days"
                type="number"
                min={1}
                step={1}
                {...register('calibration_interval_days')}
                className={`mt-1.5 ${inputClass} max-w-[180px]`}
              />
              <FieldError message={errors.calibration_interval_days?.message} />
            </div>
          </section>

          {/* ---- Location & Notes ---- */}
          <section className="rounded-2xl border border-gray-100 bg-white px-5 pb-5 shadow-sm">
            <h2 className="pt-5 pb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
              Location & Notes
            </h2>

            <div className="mb-5">
              <Label htmlFor="location">Location</Label>
              <input
                id="location"
                {...register('location')}
                className={`mt-1.5 ${inputClass}`}
                placeholder="e.g. Plant A – Line 3"
              />
              <FieldError message={errors.location?.message} />
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                {...register('notes')}
                rows={4}
                className="mt-1.5 block w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder="Any additional notes…"
              />
              <FieldError message={errors.notes?.message} />
            </div>
          </section>

          {/* Save button */}
          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-brand-500 py-4 text-lg font-semibold text-white shadow hover:bg-brand-700 active:opacity-80 disabled:opacity-60 transition-colors"
          >
            {saving && <Loader2 size={22} className="animate-spin" />}
            {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Asset'}
          </button>
        </form>
      </main>

      {/* QR scanner modal for tag ID */}
      {scannerOpen && (
        <QrTagModal
          onClose={() => setScannerOpen(false)}
          onScan={handleQrScan}
        />
      )}
    </div>
  )
}
