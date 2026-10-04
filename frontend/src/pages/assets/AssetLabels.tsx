import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { ArrowLeft, Printer } from 'lucide-react'
import { useAssets } from '../../hooks/useAssets'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { assetLabelUrl } from '../../lib/labels'
import type { LocalAsset } from '../../lib/db'

type Format = 'thermal' | 'sheet'

const FORMATS: Record<Format, { label: string; page: string; labelStyle: React.CSSProperties; container: string }> = {
  thermal: {
    label: 'Thermal label 2.25 × 1.25 in (one per label)',
    page: '@page { size: 2.25in 1.25in; margin: 0; }',
    labelStyle: { width: '2.25in', height: '1.25in', breakAfter: 'page' },
    container: 'flex flex-col items-start gap-4 print:gap-0',
  },
  sheet: {
    label: 'Letter sheet — Avery 5160 (30 per page)',
    page: '@page { size: letter; margin: 0.5in 0.1875in; }',
    labelStyle: { width: '2.625in', height: '1in' },
    container: 'grid grid-cols-[repeat(3,2.625in)] gap-x-[0.125in] gap-y-0 print:gap-x-[0.125in]',
  },
}

function fmtDate(d?: string | null) {
  return d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
}

function Label({ asset, qr, company, format }: { asset: LocalAsset; qr?: string; company: string; format: Format }) {
  const compact = format === 'sheet'
  return (
    <div
      className="flex items-center gap-2 overflow-hidden border border-dashed border-gray-300 bg-white px-2 text-black print:border-0"
      style={FORMATS[format].labelStyle}
      data-testid="asset-label"
    >
      {qr ? <img src={qr} alt={`QR code for ${asset.tag_id}`} className={compact ? 'h-[0.85in] w-[0.85in]' : 'h-[1.05in] w-[1.05in]'} /> : <div className="h-[0.85in] w-[0.85in] bg-gray-100" />}
      <div className="min-w-0 leading-tight">
        <p className={`font-black ${compact ? 'text-[11pt]' : 'text-[13pt]'} truncate`}>{asset.tag_id}</p>
        <p className="truncate text-[7pt]">{[asset.manufacturer, asset.model].filter(Boolean).join(' ') || asset.instrument_type.replace(/_/g, ' ')}</p>
        <p className="text-[7pt]">Cal: {fmtDate(asset.last_calibrated_at)}</p>
        <p className="text-[8pt] font-bold">DUE: {fmtDate(asset.next_due_at)}</p>
        {company && <p className="truncate text-[6pt]">{company}</p>}
      </div>
    </div>
  )
}

export default function AssetLabels() {
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const { data: assets = [], isLoading } = useAssets()
  const [format, setFormat] = useState<Format>(() => (params.get('format') === 'sheet' ? 'sheet' : 'thermal'))
  const [qrs, setQrs] = useState<Record<string, string>>({})

  const ids = useMemo(() => (params.get('ids') ?? '').split(',').filter(Boolean), [params])
  const selected = useMemo(
    () => (ids.length ? ids.map((id) => assets.find((a) => a.id === id)).filter((a): a is LocalAsset => !!a) : assets),
    [ids, assets],
  )

  const company = useQuery({
    queryKey: ['tenant', profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data } = await supabase.from('tenants').select('name').eq('id', profile!.tenant_id).maybeSingle()
      return (data as { name: string } | null)?.name ?? ''
    },
  })

  useEffect(() => {
    let cancelled = false
    Promise.all(
      selected.map(async (a) => [a.id, await QRCode.toDataURL(assetLabelUrl(a.id), { margin: 0, width: 240, errorCorrectionLevel: 'M' })] as const),
    ).then((pairs) => { if (!cancelled) setQrs(Object.fromEntries(pairs)) })
      .catch(console.error)
    return () => { cancelled = true }
  }, [selected])

  const ready = selected.length > 0 && selected.every((a) => qrs[a.id])

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-5 print:p-0">
      <style>{`@media print { ${FORMATS[format].page} }`}</style>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link to="/assets" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} aria-hidden /> Assets</Link>
        <h1 className="text-2xl font-bold text-gray-900">Print labels</h1>
        <span className="text-sm text-gray-500">{selected.length} label{selected.length === 1 ? '' : 's'}</span>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="label-format" className="sr-only">Label format</label>
          <select id="label-format" value={format} onChange={(e) => setFormat(e.target.value as Format)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
            {(Object.keys(FORMATS) as Format[]).map((f) => <option key={f} value={f}>{FORMATS[f].label}</option>)}
          </select>
          <button type="button" onClick={() => window.print()} disabled={!ready} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            <Printer size={16} aria-hidden /> Print
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 print:hidden">Scan a label with the app’s scanner (or any phone camera) to open that instrument. Set your printer to 100% scale / “actual size”.</p>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading assets…</p>
      ) : selected.length === 0 ? (
        <p className="text-sm text-gray-500">No assets selected. Choose assets from the asset list.</p>
      ) : (
        <div className={FORMATS[format].container}>
          {selected.map((a) => <Label key={a.id} asset={a} qr={qrs[a.id]} company={company.data ?? ''} format={format} />)}
        </div>
      )}
    </div>
  )
}
