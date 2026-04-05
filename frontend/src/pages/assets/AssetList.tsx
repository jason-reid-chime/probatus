import { useState, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { QrCode, Plus, Search, X, Loader2, ClipboardList } from 'lucide-react'
import { useAssets } from '../../hooks/useAssets'
import { useQrScanner } from '../../hooks/useQrScanner'
import type { LocalAsset } from '../../lib/db'

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------
type CalibrationStatus = 'overdue' | 'due-soon' | 'due-ok' | 'unknown'

function getStatus(nextDueAt: string | undefined): CalibrationStatus {
  if (!nextDueAt) return 'unknown'
  const now = Date.now()
  const due = new Date(nextDueAt).getTime()
  const diffDays = (due - now) / (1000 * 60 * 60 * 24)
  if (diffDays < 0) return 'overdue'
  if (diffDays <= 30) return 'due-soon'
  if (diffDays <= 90) return 'due-ok'
  return 'unknown'
}

const STATUS_CONFIG: Record<
  CalibrationStatus,
  { label: string; className: string }
> = {
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-600 border border-red-200' },
  'due-soon': { label: 'Due Soon', className: 'bg-amber-100 text-amber-500 border border-amber-200' },
  'due-ok': { label: 'Due 90d', className: 'bg-yellow-100 text-yellow-500 border border-yellow-200' },
  unknown: { label: 'OK', className: 'bg-green-100 text-green-600 border border-green-200' },
}

function StatusBadge({ nextDueAt }: { nextDueAt: string | undefined }) {
  const status = getStatus(nextDueAt)
  const { label, className } = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-sm font-medium ${className}`}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Instrument type display map
// ---------------------------------------------------------------------------
const INSTRUMENT_LABELS: Record<string, string> = {
  pressure: 'Pressure',
  temperature: 'Temperature',
  ph_conductivity: 'pH / Conductivity',
  level_4_20ma: 'Level / 4-20 mA',
  other: 'Other',
}

// ---------------------------------------------------------------------------
// Skeleton row
// ---------------------------------------------------------------------------
function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-gray-100 bg-white px-4 py-4 shadow-sm animate-pulse">
      <div className="h-5 w-24 rounded bg-gray-200" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-40 rounded bg-gray-200" />
        <div className="h-3 w-28 rounded bg-gray-100" />
      </div>
      <div className="h-6 w-20 rounded-full bg-gray-200" />
      <div className="h-4 w-24 rounded bg-gray-100" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// QR Scanner Modal
// ---------------------------------------------------------------------------
function QrScannerModal({
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
          <h2 className="text-lg font-semibold text-gray-900">Scan QR / Barcode</h2>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200"
            aria-label="Close scanner"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5">
          {/* Scanner container — html5-qrcode renders inside this div */}
          <div
            ref={scannerRef}
            id="qr-scanner-container"
            className="mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-xl bg-gray-900"
          />

          <div className="mt-5 flex gap-3">
            {!isScanning ? (
              <button
                onClick={startScanner}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 text-base font-medium text-white active:bg-brand-700"
              >
                <QrCode size={20} />
                Start Camera
              </button>
            ) : (
              <button
                onClick={stopScanner}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-base font-medium text-gray-700 active:bg-gray-100"
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
// Asset row
// ---------------------------------------------------------------------------
function AssetRow({ asset }: { asset: LocalAsset }) {
  const navigate = useNavigate()

  return (
    <button
      className="flex w-full items-center gap-4 rounded-xl border border-gray-100 bg-white px-4 py-4 shadow-sm transition-colors hover:bg-gray-50 active:bg-gray-100 text-left"
      onClick={() => navigate(`/assets/${asset.id}`)}
      aria-label={`View asset ${asset.tag_id}`}
    >
      {/* Tag ID */}
      <div className="min-w-0 w-28 flex-shrink-0">
        <span className="font-mono text-sm font-semibold text-gray-900 truncate block">
          {asset.tag_id}
        </span>
        <span className="mt-0.5 text-xs text-gray-500 block">
          {INSTRUMENT_LABELS[asset.instrument_type] ?? asset.instrument_type}
        </span>
      </div>

      {/* Make / Model */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium text-gray-800">
          {[asset.manufacturer, asset.model].filter(Boolean).join(' ') || (
            <span className="text-gray-400 italic">No make/model</span>
          )}
        </p>
        {asset.location && (
          <p className="truncate text-sm text-gray-500">{asset.location}</p>
        )}
      </div>

      {/* Status badge */}
      <StatusBadge nextDueAt={asset.next_due_at} />

      {/* Next due date */}
      <div className="hidden sm:block w-24 flex-shrink-0 text-right">
        <span className="text-sm text-gray-600">
          {asset.next_due_at
            ? new Date(asset.next_due_at).toLocaleDateString()
            : '—'}
        </span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// AssetList page
// ---------------------------------------------------------------------------
export default function AssetList() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialSearch = searchParams.get('tag') ?? ''
  const [search, setSearch] = useState(initialSearch)
  const [scannerOpen, setScannerOpen] = useState(false)

  const { data: assets, isLoading, isError } = useAssets()

  const handleSearch = (value: string) => {
    setSearch(value)
    if (value) {
      setSearchParams({ tag: value })
    } else {
      setSearchParams({})
    }
  }

  const handleQrScan = useCallback(
    (tagId: string) => {
      navigate(`/assets?tag=${encodeURIComponent(tagId)}`)
      setSearch(tagId)
    },
    [navigate],
  )

  const filtered = (assets ?? []).filter((a) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      a.tag_id.toLowerCase().includes(q) ||
      (a.manufacturer ?? '').toLowerCase().includes(q) ||
      (a.model ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Assets</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setScannerOpen(true)}
              className="flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 active:bg-gray-100"
              aria-label="Open QR scanner"
            >
              <QrCode size={20} />
              <span className="hidden sm:inline">Scan QR</span>
            </button>
            <Link
              to="/assets/new"
              className="flex h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 text-base font-medium text-white shadow-sm hover:bg-brand-700 active:opacity-80"
            >
              <Plus size={20} />
              <span className="hidden sm:inline">New Asset</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {/* Search */}
        <div className="relative mb-6">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="search"
            placeholder="Search by tag ID, manufacturer, or model…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="h-12 w-full rounded-xl border border-gray-200 bg-white pl-11 pr-4 text-base text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          {search && (
            <button
              onClick={() => handleSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Loading skeletons */}
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && !isLoading && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            Failed to load assets from server — showing cached data.
          </div>
        )}

        {/* Asset list */}
        {!isLoading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((asset) => (
              <AssetRow key={asset.id} asset={asset} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && assets !== undefined && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
            <ClipboardList size={48} className="mb-4 text-gray-300" />
            <h2 className="mb-1 text-xl font-semibold text-gray-700">
              {search ? 'No assets match your search' : 'No assets yet'}
            </h2>
            <p className="mb-6 text-base text-gray-500">
              {search
                ? 'Try a different tag ID, manufacturer, or model name.'
                : 'Add your first asset to start tracking calibrations.'}
            </p>
            {!search && (
              <Link
                to="/assets/new"
                className="flex h-11 items-center gap-2 rounded-xl bg-brand-500 px-6 text-base font-medium text-white hover:bg-brand-700 active:opacity-80"
              >
                <Plus size={20} />
                Add First Asset
              </Link>
            )}
          </div>
        )}
      </main>

      {/* QR Scanner modal */}
      {scannerOpen && (
        <QrScannerModal
          onClose={() => setScannerOpen(false)}
          onScan={handleQrScan}
        />
      )}
    </div>
  )
}
