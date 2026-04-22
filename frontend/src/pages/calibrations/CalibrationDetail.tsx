import { useMemo, useRef, useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, Clock, RefreshCw, Wifi, WifiOff, FileDown, ExternalLink, Upload, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useCalibrationRecord, useMeasurementsByRecord, calibrationKeys } from '../../hooks/useCalibration'
import { API_URL } from '../../lib/api/client'
import { useAuth } from '../../hooks/useAuth'
import { db, type LocalCalibrationRecord } from '../../lib/db'
import { enqueue } from '../../lib/sync/outbox'
import { overallResult } from '../../utils/calibrationMath'
import type { LocalMeasurement } from '../../lib/db'

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
const STATUS_STYLES: Record<string, string> = {
  in_progress: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  pending_approval: 'bg-blue-100 text-blue-800 border-blue-300',
  approved: 'bg-green-100 text-green-800 border-green-300',
  rejected: 'bg-red-100 text-red-800 border-red-300',
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In Progress',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700 border-gray-300'}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Overall result banner (read-only)
// ---------------------------------------------------------------------------
function ResultBanner({ result }: { result: 'PASS' | 'FAIL' | 'INCOMPLETE' }) {
  if (result === 'INCOMPLETE') {
    return (
      <div className="flex items-center gap-3 px-5 py-4 rounded-xl border bg-gray-50 border-gray-300 text-gray-500 text-lg font-semibold">
        <Clock size={24} />
        <span>Incomplete — awaiting all measurements</span>
      </div>
    )
  }
  if (result === 'PASS') {
    return (
      <div className="flex items-center gap-3 px-5 py-4 rounded-xl border-2 bg-green-50 border-green-500 text-green-700 text-lg font-bold">
        <CheckCircle size={28} />
        <span>PASS</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 px-5 py-4 rounded-xl border-2 bg-red-50 border-red-500 text-red-700 text-lg font-bold">
      <XCircle size={28} />
      <span>FAIL</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Read-only measurement table
// ---------------------------------------------------------------------------
function MeasurementsTable({
  measurements,
}: {
  measurements: LocalMeasurement[]
}) {
  if (measurements.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">No measurements recorded.</p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="px-3 py-2 font-semibold text-gray-700">Point</th>
            <th className="px-3 py-2 font-semibold text-gray-700">Standard</th>
            <th className="px-3 py-2 font-semibold text-gray-700">Measured</th>
            <th className="px-3 py-2 font-semibold text-gray-700 text-center">
              Error %
            </th>
            <th className="px-3 py-2 font-semibold text-gray-700 text-center">
              Pass/Fail
            </th>
          </tr>
        </thead>
        <tbody>
          {measurements.map((m) => (
            <tr key={m.id} className="border-t border-gray-200">
              <td className="px-3 py-2 font-medium text-gray-700">
                {m.point_label}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {m.standard_value !== undefined
                  ? `${m.standard_value}${m.unit ? ` ${m.unit}` : ''}`
                  : '—'}
              </td>
              <td className="px-3 py-2 text-gray-800">
                {m.measured_value !== undefined
                  ? `${m.measured_value}${m.unit ? ` ${m.unit}` : ''}`
                  : '—'}
              </td>
              <td className="px-3 py-2 text-center font-mono font-semibold">
                {m.error_pct != null && isFinite(m.error_pct) ? (
                  <span
                    className={m.pass ? 'text-green-600' : 'text-red-600'}
                  >
                    {m.error_pct.toFixed(3)}%
                  </span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-center">
                {m.pass === true && (
                  <CheckCircle
                    className="inline-block text-green-600"
                    size={20}
                  />
                )}
                {m.pass === false && (
                  <XCircle className="inline-block text-red-600" size={20} />
                )}
                {(m.pass === undefined || m.pass === null) && (
                  <span className="text-gray-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sync status indicator
// ---------------------------------------------------------------------------
function useSyncStatus(recordId: string) {
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  useEffect(() => {
    db.outbox
      .filter((e) => {
        const payload = e.payload as Record<string, unknown>
        return e.table === 'calibration_records' && payload['id'] === recordId
      })
      .count()
      .then(setPendingCount)
  }, [recordId])

  return pendingCount
}

// ---------------------------------------------------------------------------
// Standards used for this calibration record
// ---------------------------------------------------------------------------
interface StandardSummary {
  id: string
  name: string
  serial_number: string
  manufacturer: string | null
  due_at: string
}

function useStandardsUsed(recordId: string) {
  const [standards, setStandards] = useState<StandardSummary[]>([])

  useEffect(() => {
    if (!recordId) return
    supabase
      .from('calibration_standards_used')
      .select('standard_id, master_standards(id, name, serial_number, manufacturer, due_at)')
      .eq('record_id', recordId)
      .then(({ data }) => {
        if (!data) return
        setStandards(
          data
            .map((row) => row.master_standards as unknown as StandardSummary)
            .filter(Boolean)
        )
      })
  }, [recordId])

  return standards
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function CalibrationDetail() {
  const { recordId } = useParams<{ recordId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const {
    data: record,
    isLoading: recordLoading,
  } = useCalibrationRecord(recordId ?? '')

  const {
    data: measurements = [],
    isLoading: measLoading,
  } = useMeasurementsByRecord(recordId ?? '')

  const queryClient = useQueryClient()
  const pendingCount = useSyncStatus(recordId ?? '')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [emailRecipient, setEmailRecipient] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)

  const standardsUsed = useStandardsUsed(recordId ?? '')

  const result = useMemo(() => {
    if (!record) return 'INCOMPLETE' as const
    const type = (record as unknown as { instrument_type?: string }).instrument_type?.toLowerCase() ?? ''
    if (type.includes('ph') || type.includes('conductivity')) {
      return 'INCOMPLETE' as const
    }
    return overallResult(measurements)
  }, [record, measurements])

  async function handleSubmitForApproval() {
    if (!record || !profile) return
    setSubmitting(true)
    setSubmitError(null)

    try {
      const updated = {
        ...record,
        status: 'pending_approval' as const,
        updated_at: new Date().toISOString(),
      }

      // Write to Dexie
      await db.calibration_records.put(updated)

      // Enqueue in outbox
      await enqueue({
        table: 'calibration_records',
        operation: 'upsert',
        payload: updated as unknown as Record<string, unknown>,
      })

      // Attempt online update
      try {
        const { supabase } = await import('../../lib/supabase')
        await supabase
          .from('calibration_records')
          .update({ status: 'pending_approval', updated_at: updated.updated_at })
          .eq('id', record.id)
      } catch {
        // Offline — outbox will sync when connectivity returns
      }

      queryClient.setQueryData(calibrationKeys.detail(record.id), updated)
    } catch (err) {
      setSubmitError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (recordLoading || measLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Loading…
      </div>
    )
  }

  if (!record) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        Calibration record not found.
      </div>
    )
  }

  const performedAt = new Date(record.performed_at).toLocaleString()
  const canSubmit = record.status === 'in_progress'
  const canApprove = record.status === 'pending_approval' && (profile?.role === 'supervisor' || profile?.role === 'admin')
  const canGeneratePdf = record.status === 'approved'

  async function handleApprove() {
    if (!recordId || !profile) return
    setApproving(true)
    setApproveError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const res = await fetch(`${API_URL}/calibrations/${recordId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ supervisor_signature: profile.full_name }),
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      // Update Dexie so status persists on next visit
      await db.calibration_records.update(recordId, { status: 'approved' })
      queryClient.setQueryData(calibrationKeys.detail(recordId), (old: LocalCalibrationRecord | undefined) =>
        old ? { ...old, status: 'approved' } : old
      )
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setApproving(false)
    }
  }

  async function handleGeneratePdf() {
    if (!recordId) return
    setGeneratingPdf(true)
    setPdfError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const res = await fetch(`${API_URL}/calibrations/${recordId}/certificate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `certificate-${recordId.slice(0, 8)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Failed to generate certificate')
    } finally {
      setGeneratingPdf(false)
    }
  }

  async function handleSendEmail() {
    if (!recordId || !emailRecipient) return
    setSendingEmail(true)
    setEmailError(null)
    setEmailSent(false)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const res = await fetch(`${API_URL}/calibrations/${recordId}/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailRecipient }),
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      setEmailSent(true)
      setEmailRecipient('')
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send email')
    } finally {
      setSendingEmail(false)
    }
  }

  async function handleCertificateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !record || !profile) return
    setUploading(true)
    setUploadError(null)
    try {
      const path = `${record.tenant_id}/${record.id}.pdf`
      const { error: uploadErr } = await supabase.storage
        .from('certificates')
        .upload(path, file, { upsert: true, contentType: 'application/pdf' })
      if (uploadErr) throw uploadErr

      const { data: urlData } = supabase.storage
        .from('certificates')
        .getPublicUrl(path)
      const publicUrl = urlData.publicUrl

      const updated: LocalCalibrationRecord = {
        ...record,
        certificate_url: publicUrl,
        updated_at: new Date().toISOString(),
      }

      await db.calibration_records.put(updated)

      await supabase
        .from('calibration_records')
        .update({ certificate_url: publicUrl, updated_at: updated.updated_at })
        .eq('id', record.id)

      queryClient.setQueryData(
        calibrationKeys.detail(record.id),
        updated,
      )
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            Calibration Record
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{performedAt}</p>
          <button
            type="button"
            onClick={() => navigate(`/assets/${record.asset_id}`)}
            className="mt-1 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 hover:underline"
          >
            <ExternalLink size={13} />
            View Asset
          </button>
        </div>
        <StatusBadge status={record.status} />
      </div>

      {/* Sync indicator */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        {pendingCount === null || pendingCount === 0 ? (
          <>
            <Wifi size={15} className="text-green-500" />
            <span>Synced</span>
          </>
        ) : (
          <>
            <WifiOff size={15} className="text-amber-500" />
            <RefreshCw size={14} className="animate-spin text-amber-500" />
            <span>Saved locally • Syncing…</span>
          </>
        )}
      </div>

      {/* Result banner */}
      <ResultBanner result={result} />

      {/* Record details */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-3">
        <h2 className="text-base font-semibold text-gray-800">Details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {record.sales_number && (
            <>
              <dt className="text-gray-500">Sales #</dt>
              <dd className="text-gray-800">{record.sales_number}</dd>
            </>
          )}
          {record.flag_number && (
            <>
              <dt className="text-gray-500">Flag #</dt>
              <dd className="text-gray-800">{record.flag_number}</dd>
            </>
          )}
          {record.notes && (
            <>
              <dt className="text-gray-500">Notes</dt>
              <dd className="text-gray-800 col-span-1">{record.notes}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Measurements */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-800">Measurements</h2>
        <MeasurementsTable measurements={measurements} />
      </div>

      {/* Standards used */}
      {standardsUsed.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-3">
          <h2 className="text-base font-semibold text-gray-800">Master Standards Used</h2>
          <ul className="divide-y divide-gray-100">
            {standardsUsed.map((s) => {
              const due = new Date(s.due_at)
              const overdue = due < new Date()
              return (
                <li key={s.id} className="py-2.5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-500">
                      S/N: {s.serial_number}{s.manufacturer ? ` · ${s.manufacturer}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${overdue ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                    {overdue ? 'Overdue' : `Due ${due.toLocaleDateString()}`}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Continue editing */}
      {record.status === 'in_progress' && (
        <button
          type="button"
          onClick={() => navigate(`/calibrations/${record.asset_id}/edit/${recordId}`)}
          className="w-full inline-flex items-center justify-center gap-2 bg-white border border-brand-500 text-brand-600 hover:bg-brand-50 font-semibold text-base rounded-xl min-h-[52px] px-6 py-3 transition-colors"
        >
          Continue Calibration
        </button>
      )}

      {/* Submit for approval */}
      {canSubmit && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleSubmitForApproval}
            disabled={submitting}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl min-h-[52px] px-6 py-3 transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit for Approval'}
          </button>
          {submitError && (
            <p className="text-sm text-red-600 text-center">{submitError}</p>
          )}
        </div>
      )}

      {/* Approve */}
      {canApprove && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleApprove}
            disabled={approving}
            className="w-full inline-flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl min-h-[52px] px-6 py-3 transition-colors"
          >
            {approving ? 'Approving…' : 'Approve Calibration'}
          </button>
          {approveError && <p className="text-sm text-red-600 text-center">{approveError}</p>}
        </div>
      )}

      {/* Generate certificate */}
      {canGeneratePdf && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleGeneratePdf}
            disabled={generatingPdf}
            className="w-full inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl min-h-[52px] px-6 py-3 transition-colors"
          >
            <FileDown size={20} />
            {generatingPdf ? 'Generating…' : 'Download Certificate (PDF)'}
          </button>
          {pdfError && (
            <p className="text-sm text-red-600 text-center">{pdfError}</p>
          )}
        </div>
      )}

      {/* Send certificate by email */}
      {canGeneratePdf && (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-3">
          <h2 className="text-base font-semibold text-gray-800">Send Certificate by Email</h2>
          <div className="flex gap-2">
            <input
              type="email"
              value={emailRecipient}
              onChange={(e) => { setEmailRecipient(e.target.value); setEmailSent(false); setEmailError(null) }}
              placeholder="recipient@example.com"
              className="flex-1 text-sm px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={handleSendEmail}
              disabled={sendingEmail || !emailRecipient}
              className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              <Send size={15} />
              {sendingEmail ? 'Sending…' : 'Send'}
            </button>
          </div>
          {emailSent && <p className="text-sm text-green-600">Certificate sent successfully.</p>}
          {emailError && <p className="text-sm text-red-600">{emailError}</p>}
        </div>
      )}

      {/* External certificate upload / view */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 space-y-3">
        <h2 className="text-base font-semibold text-gray-800">External Certificate</h2>
        {record.certificate_url ? (
          <div className="space-y-3">
            <embed
              src={record.certificate_url}
              type="application/pdf"
              className="w-full rounded-lg border border-gray-200"
              style={{ height: '600px' }}
            />
            <a
              href={record.certificate_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 font-medium text-sm underline underline-offset-2"
            >
              <ExternalLink size={16} />
              Open in new tab
            </a>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-500">Attach a PDF certificate from an external calibration lab.</p>
            <label className={`w-full inline-flex items-center justify-center gap-2 border border-dashed border-gray-300 hover:border-brand-400 bg-gray-50 hover:bg-brand-50 text-gray-600 hover:text-brand-700 font-medium text-sm rounded-xl min-h-[48px] px-4 py-3 cursor-pointer transition-colors ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
              <Upload size={16} />
              {uploading ? 'Uploading…' : 'Upload Certificate PDF'}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="sr-only"
                onChange={handleCertificateUpload}
                disabled={uploading}
              />
            </label>
            {uploadError && (
              <p className="text-sm text-red-600">{uploadError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
