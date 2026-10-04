import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Upload, Trash2, ExternalLink, Loader2, Paperclip } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { isOnline } from '../../lib/sync/connectivity'
import {
  DOCUMENT_KINDS,
  type CalibrationDocument,
  type DocumentKind,
  deleteDocument,
  formatBytes,
  listDocuments,
  openDocumentUrl,
  uploadDocument,
} from '../../lib/api/documents'

interface Props {
  /** Attach to a calibration record (documents also show on its asset). */
  recordId?: string
  /** Asset page: list every document for the asset; uploads attach to the asset. */
  assetId?: string
  readOnly?: boolean
}

/** Multiple files per calibration record or asset, in private storage. */
export default function DocumentsPanel({ recordId, assetId, readOnly = false }: Props) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<DocumentKind>('certificate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const queryKey = ['documents', recordId ?? '', assetId ?? '']
  const { data: docs = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => listDocuments(recordId ? { recordId } : { assetId }),
    enabled: !!(recordId || assetId),
  })

  const canManage = !readOnly && profile && profile.role !== 'customer'
  const canDelete = (d: CalibrationDocument) =>
    canManage && (profile!.role === 'supervisor' || profile!.role === 'admin' || d.uploaded_by === profile!.id)

  async function handleFiles(files: FileList | null) {
    if (!files?.length || !profile) return
    if (!isOnline()) {
      setError('Uploading needs a connection — try again when you’re back online.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        await uploadDocument({ tenantId: profile.tenant_id, recordId, assetId: recordId ? undefined : assetId, file, kind })
      }
      await qc.invalidateQueries({ queryKey: ['documents'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function handleOpen(d: CalibrationDocument) {
    setError(null)
    try {
      window.open(await openDocumentUrl(d), '_blank', 'noopener')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open document')
    }
  }

  async function handleDelete(d: CalibrationDocument) {
    setBusy(true)
    setError(null)
    try {
      await deleteDocument(d)
      await qc.invalidateQueries({ queryKey: ['documents'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
      setConfirmDelete(null)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900">
          <Paperclip size={18} className="text-gray-400" aria-hidden /> Documents
          {docs.length > 0 && <span className="text-sm font-normal text-gray-500">({docs.length})</span>}
        </h2>
        {canManage && (
          <div className="ml-auto flex items-center gap-2">
            <label className="sr-only" htmlFor={`doc-kind-${recordId ?? assetId}`}>Document type</label>
            <select
              id={`doc-kind-${recordId ?? assetId}`}
              value={kind}
              onChange={(e) => setKind(e.target.value as DocumentKind)}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
            >
              {DOCUMENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Upload size={14} aria-hidden />}
              Upload
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              data-testid="document-input"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.csv,.txt,.xlsx,.xls,.docx,.doc"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-gray-500">No documents attached{canManage ? ' — upload certificates, reports or photos (up to 25 MB each).' : '.'}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2.5 text-sm">
              <FileText size={18} className="shrink-0 text-gray-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => handleOpen(d)} className="block max-w-full truncate text-left font-medium text-gray-900 hover:text-brand-600">
                  {d.file_name}
                </button>
                <p className="text-xs text-gray-500">
                  {DOCUMENT_KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}
                  {d.size_bytes ? ` · ${formatBytes(d.size_bytes)}` : ''}
                  {' · '}{new Date(d.created_at).toLocaleDateString()}
                </p>
              </div>
              <button type="button" onClick={() => handleOpen(d)} aria-label={`Open ${d.file_name}`} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                <ExternalLink size={16} aria-hidden />
              </button>
              {canDelete(d) && (
                confirmDelete === d.id ? (
                  <span className="flex items-center gap-2 text-xs">
                    <button type="button" onClick={() => handleDelete(d)} disabled={busy} className="font-semibold text-red-600 underline">Delete</button>
                    <button type="button" onClick={() => setConfirmDelete(null)} className="text-gray-500 underline">Cancel</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(d.id)} aria-label={`Delete ${d.file_name}`} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 size={16} aria-hidden />
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
