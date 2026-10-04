import { supabase } from '../supabase'

export type DocumentKind = 'certificate' | 'datasheet' | 'photo' | 'report' | 'other'

export interface CalibrationDocument {
  id: string
  tenant_id: string
  record_id: string | null
  asset_id: string | null
  file_path: string
  file_name: string
  content_type: string | null
  size_bytes: number | null
  kind: DocumentKind
  description: string | null
  uploaded_by: string | null
  created_at: string
}

export const DOCUMENT_BUCKET = 'documents'
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
export const DOCUMENT_KINDS: { value: DocumentKind; label: string }[] = [
  { value: 'certificate', label: 'Certificate' },
  { value: 'report', label: 'Report' },
  { value: 'datasheet', label: 'Datasheet' },
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' },
]

export async function listDocuments(filter: { recordId?: string; assetId?: string }): Promise<CalibrationDocument[]> {
  let q = supabase.from('calibration_documents').select('*').order('created_at', { ascending: false })
  if (filter.recordId) q = q.eq('record_id', filter.recordId)
  if (filter.assetId) q = q.eq('asset_id', filter.assetId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as CalibrationDocument[]
}

/** Storage object name: {tenant}/{record or asset}/{uuid}-{safe file name}. */
export function documentPath(tenantId: string, ownerId: string, fileName: string, id: string): string {
  const safe = fileName.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-120) || 'file'
  return `${tenantId}/${ownerId}/${id}-${safe}`
}

export async function uploadDocument(opts: {
  tenantId: string
  recordId?: string
  assetId?: string
  file: File
  kind: DocumentKind
  description?: string
}): Promise<CalibrationDocument> {
  const { tenantId, recordId, assetId, file, kind, description } = opts
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('File is larger than 25 MB')
  const owner = recordId ?? assetId
  if (!owner) throw new Error('A document needs a calibration record or asset')
  const path = documentPath(tenantId, owner, file.name, crypto.randomUUID())

  const { error: upErr } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (upErr) throw upErr

  const { data, error } = await supabase
    .from('calibration_documents')
    .insert({
      tenant_id: tenantId,
      record_id: recordId ?? null,
      asset_id: assetId ?? null,
      file_path: path,
      file_name: file.name,
      content_type: file.type || null,
      size_bytes: file.size,
      kind,
      description: description || null,
    })
    .select()
    .single()
  if (error) {
    // Don't leave an orphaned file behind if the row couldn't be written.
    await supabase.storage.from(DOCUMENT_BUCKET).remove([path])
    throw error
  }
  return data as CalibrationDocument
}

export async function openDocumentUrl(doc: Pick<CalibrationDocument, 'file_path'>): Promise<string> {
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(doc.file_path, 300)
  if (error || !data) throw error ?? new Error('Could not open document')
  return data.signedUrl
}

export async function deleteDocument(doc: Pick<CalibrationDocument, 'id' | 'file_path'>): Promise<void> {
  const { error } = await supabase.from('calibration_documents').delete().eq('id', doc.id)
  if (error) throw error
  await supabase.storage.from(DOCUMENT_BUCKET).remove([doc.file_path])
}

export function formatBytes(n: number | null): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
