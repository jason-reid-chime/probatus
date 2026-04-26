import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Search,
  X,
  CheckSquare,
  Square,
  ChevronRight,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { apiRequest } from '../../lib/api/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Asset {
  id: string
  tag_id: string
  instrument_type: string
  serial_number: string | null
  manufacturer: string | null
  model: string | null
  customers: { name: string } | null
}

interface CreatedRecord {
  id: string
  asset_id: string
  tag_id: string
}

interface FailedRecord {
  asset_id: string
  tag_id: string
  error: string
}

type Step = 'select' | 'configure' | 'creating' | 'summary'

// ---------------------------------------------------------------------------
// Asset fetch
// ---------------------------------------------------------------------------
function useAssets(tenantId: string) {
  return useQuery({
    queryKey: ['batch-session-assets', tenantId],
    queryFn: async (): Promise<Asset[]> => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, tag_id, instrument_type, serial_number, manufacturer, model, customer_id, customers(name)')
        .eq('tenant_id', tenantId)
        .order('tag_id')
      if (error) throw error
      return (data ?? []) as unknown as Asset[]
    },
    enabled: !!tenantId,
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function InstrumentBadge({ type }: { type: string }) {
  const label = type.replace(/_/g, ' ')
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-600 border-gray-200 shrink-0 capitalize">
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Asset selection
// ---------------------------------------------------------------------------
interface SelectionStepProps {
  assets: Asset[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: (visible: Asset[]) => void
  onNext: () => void
}

function SelectionStep({ assets, selected, onToggle, onToggleAll, onNext }: SelectionStepProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return assets
    const q = search.toLowerCase()
    return assets.filter(
      (a) =>
        a.tag_id.toLowerCase().includes(q) ||
        (a.manufacturer ?? '').toLowerCase().includes(q) ||
        (a.model ?? '').toLowerCase().includes(q),
    )
  }, [assets, search])

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((a) => selected.has(a.id))

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="search"
          placeholder="Search by tag ID, manufacturer or model…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-10 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Select all visible */}
      <div className="flex items-center gap-3 px-1">
        <button
          type="button"
          onClick={() => onToggleAll(filtered)}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-brand-600 transition-colors"
          aria-label={allVisibleSelected ? 'Deselect all visible' : 'Select all visible'}
        >
          {allVisibleSelected ? (
            <CheckSquare size={18} className="text-brand-500" />
          ) : (
            <Square size={18} className="text-gray-400" />
          )}
          <span className="font-medium">Select All Visible</span>
        </button>
        {filtered.length !== assets.length && (
          <span className="text-xs text-gray-400">({filtered.length} of {assets.length} shown)</span>
        )}
      </div>

      {/* Asset list */}
      {filtered.length === 0 && (
        <div className="text-center text-gray-400 py-12 text-sm">No assets match your search.</div>
      )}

      <ul className="space-y-2">
        {filtered.map((asset) => {
          const isChecked = selected.has(asset.id)
          const makeModel = [asset.manufacturer, asset.model].filter(Boolean).join(' · ')
          return (
            <li key={asset.id}>
              <label className="flex items-center gap-3 min-h-[52px] bg-white rounded-xl border border-gray-200 px-4 py-3 cursor-pointer hover:border-brand-400 hover:shadow-sm transition-all">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggle(asset.id)}
                  className="h-5 w-5 rounded border-gray-300 text-brand-500 focus:ring-brand-500 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm">{asset.tag_id}</span>
                    <InstrumentBadge type={asset.instrument_type} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-gray-500">
                    {makeModel && <span>{makeModel}</span>}
                    {asset.customers?.name && (
                      <span className="text-gray-400">{asset.customers.name}</span>
                    )}
                  </div>
                </div>
              </label>
            </li>
          )
        })}
      </ul>

      {/* Sticky bottom bar */}
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg rounded-b-xl -mx-4 px-4 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-2 rounded-full bg-brand-500 text-white text-xs font-bold">
            {selected.size}
          </span>
          <span className="text-sm text-gray-600 font-medium">
            {selected.size === 1 ? 'asset selected' : 'assets selected'}
          </span>
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={selected.size === 0}
          className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors"
        >
          Configure Session
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Session configuration
// ---------------------------------------------------------------------------
interface ConfigureStepProps {
  selectedCount: number
  performedAt: string
  sessionNote: string
  onPerformedAtChange: (v: string) => void
  onSessionNoteChange: (v: string) => void
  onBack: () => void
  onSubmit: () => void
  submitting: boolean
}

function ConfigureStep({
  selectedCount,
  performedAt,
  sessionNote,
  onPerformedAtChange,
  onSessionNoteChange,
  onBack,
  onSubmit,
  submitting,
}: ConfigureStepProps) {
  return (
    <div className="space-y-6">
      {/* Summary card */}
      <div className="bg-brand-50 border border-brand-200 rounded-xl px-5 py-4">
        <p className="text-sm font-medium text-brand-800">
          Creating calibration records for{' '}
          <span className="font-bold">{selectedCount} {selectedCount === 1 ? 'asset' : 'assets'}</span>
        </p>
      </div>

      {/* Config form */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-5">
        <h2 className="text-base font-semibold text-gray-800">Session Details</h2>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Performed At
          </label>
          <input
            type="date"
            value={performedAt}
            onChange={(e) => onPerformedAtChange(e.target.value)}
            className="w-full min-h-[48px] px-3 py-2 border border-gray-300 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Technician Note / Session Name{' '}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={sessionNote}
            onChange={(e) => onSessionNoteChange(e.target.value)}
            placeholder="e.g. Annual shutdown calibration run — Plant A"
            className="w-full min-h-[48px] px-3 py-2 border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 border border-gray-300 text-gray-700 hover:bg-gray-50 font-semibold text-sm px-5 py-3 rounded-xl transition-colors disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="flex-[2] inline-flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-3 rounded-xl transition-colors"
        >
          {submitting && <Loader2 size={16} className="animate-spin" />}
          Create Session
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Creating progress
// ---------------------------------------------------------------------------
function CreatingStep({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-6">
      <Loader2 size={40} className="animate-spin text-brand-500" />
      <div className="text-center space-y-1">
        <p className="text-base font-semibold text-gray-800">
          Creating {current} of {total}…
        </p>
        <p className="text-sm text-gray-500">Please keep this page open.</p>
      </div>
      <div className="w-full max-w-xs bg-gray-200 rounded-full h-2">
        <div
          className="bg-brand-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Summary
// ---------------------------------------------------------------------------
interface SummaryStepProps {
  created: CreatedRecord[]
  failed: FailedRecord[]
  onDone: () => void
}

function SummaryStep({ created, failed, onDone }: SummaryStepProps) {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      {/* Counts */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-4 text-center">
          <CheckCircle size={24} className="mx-auto text-green-600 mb-1" />
          <p className="text-2xl font-bold text-green-700">{created.length}</p>
          <p className="text-xs text-green-600 font-medium mt-0.5">Created</p>
        </div>
        <div className={`border rounded-xl px-4 py-4 text-center ${failed.length > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
          <XCircle size={24} className={`mx-auto mb-1 ${failed.length > 0 ? 'text-red-500' : 'text-gray-300'}`} />
          <p className={`text-2xl font-bold ${failed.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>{failed.length}</p>
          <p className={`text-xs font-medium mt-0.5 ${failed.length > 0 ? 'text-red-500' : 'text-gray-400'}`}>Failed</p>
        </div>
      </div>

      {/* Failures */}
      {failed.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 space-y-2">
          <h3 className="text-sm font-semibold text-red-700">Failures</h3>
          <ul className="space-y-1">
            {failed.map((f) => (
              <li key={f.asset_id} className="text-sm text-red-600">
                <span className="font-medium">{f.tag_id}</span>: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Created records list */}
      {created.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700 px-1">Created Records</h3>
          <ul className="space-y-2">
            {created.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/calibrations/${r.id}`)}
                  className="w-full flex items-center gap-3 bg-white rounded-xl border border-gray-200 hover:border-brand-400 hover:shadow-sm transition-all px-4 py-3 min-h-[52px] text-left"
                >
                  <CheckCircle size={16} className="text-green-500 shrink-0" />
                  <span className="flex-1 text-sm font-semibold text-gray-800">{r.tag_id}</span>
                  <ChevronRight size={16} className="text-gray-400 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        className="w-full bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm rounded-xl min-h-[52px] px-6 py-3 transition-colors"
      >
        Done
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function BatchSession() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id ?? ''
  const userId = profile?.id ?? ''

  const { data: assets = [], isLoading, isError } = useAssets(tenantId)

  // Step state
  const [step, setStep] = useState<Step>('select')

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Config
  const today = new Date().toISOString().slice(0, 10)
  const [performedAt, setPerformedAt] = useState(today)
  const [sessionNote, setSessionNote] = useState('')

  // Creation progress
  const [creationProgress, setCreationProgress] = useState(0)
  const [created, setCreated] = useState<CreatedRecord[]>([])
  const [failed, setFailed] = useState<FailedRecord[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Derived
  const assetMap = useMemo(
    () => new Map(assets.map((a) => [a.id, a])),
    [assets],
  )

  function toggleAsset(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible(visible: Asset[]) {
    const allChecked = visible.every((a) => selected.has(a.id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allChecked) {
        visible.forEach((a) => next.delete(a.id))
      } else {
        visible.forEach((a) => next.add(a.id))
      }
      return next
    })
  }

  async function handleCreate() {
    if (submitting) return
    setSubmitting(true)
    setStep('creating')
    setCreationProgress(0)

    const selectedAssets = [...selected].map((id) => assetMap.get(id)).filter(Boolean) as Asset[]
    const newCreated: CreatedRecord[] = []
    const newFailed: FailedRecord[] = []

    for (let i = 0; i < selectedAssets.length; i++) {
      const asset = selectedAssets[i]
      setCreationProgress(i + 1)

      try {
        const body = {
          asset_id: asset.id,
          tenant_id: tenantId,
          technician_id: userId,
          performed_at: new Date(performedAt).toISOString(),
          status: 'in_progress',
          notes: sessionNote || null,
          local_id: crypto.randomUUID(),
        }

        const result = await apiRequest<{ id: string }>('POST', '/calibrations', body)
        newCreated.push({ id: result.id, asset_id: asset.id, tag_id: asset.tag_id })
      } catch (err) {
        newFailed.push({
          asset_id: asset.id,
          tag_id: asset.tag_id,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    setCreated(newCreated)
    setFailed(newFailed)
    setSubmitting(false)
    setStep('summary')
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-32 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (step === 'configure') {
              setStep('select')
            } else if (step === 'select' || step === 'summary') {
              navigate(-1)
            }
          }}
          className="p-2 -ml-2 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Batch Calibration Session</h1>
          {step === 'select' && (
            <p className="text-sm text-gray-500 mt-0.5">Select assets to calibrate</p>
          )}
          {step === 'configure' && (
            <p className="text-sm text-gray-500 mt-0.5">Configure session details</p>
          )}
          {step === 'summary' && (
            <p className="text-sm text-gray-500 mt-0.5">Session complete</p>
          )}
        </div>
      </div>

      {/* Step indicator */}
      {step !== 'creating' && step !== 'summary' && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className={`font-semibold ${step === 'select' ? 'text-brand-600' : 'text-gray-400'}`}>
            1. Select Assets
          </span>
          <span>/</span>
          <span className={`font-semibold ${step === 'configure' ? 'text-brand-600' : 'text-gray-400'}`}>
            2. Configure
          </span>
        </div>
      )}

      {/* Loading / error states */}
      {isLoading && step === 'select' && (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Loading assets…</span>
        </div>
      )}

      {isError && step === 'select' && (
        <div className="text-center text-red-500 py-12 text-sm">
          Failed to load assets. Check your connection and try again.
        </div>
      )}

      {/* Step content */}
      {!isLoading && !isError && step === 'select' && (
        <SelectionStep
          assets={assets}
          selected={selected}
          onToggle={toggleAsset}
          onToggleAll={toggleAllVisible}
          onNext={() => setStep('configure')}
        />
      )}

      {step === 'configure' && (
        <ConfigureStep
          selectedCount={selected.size}
          performedAt={performedAt}
          sessionNote={sessionNote}
          onPerformedAtChange={setPerformedAt}
          onSessionNoteChange={setSessionNote}
          onBack={() => setStep('select')}
          onSubmit={handleCreate}
          submitting={submitting}
        />
      )}

      {step === 'creating' && (
        <CreatingStep
          current={creationProgress}
          total={selected.size}
        />
      )}

      {step === 'summary' && (
        <SummaryStep
          created={created}
          failed={failed}
          onDone={() => navigate('/calibrations')}
        />
      )}
    </div>
  )
}
