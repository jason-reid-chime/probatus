import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPage } from '../../test/render'

const authState = { profile: { id: 'u1', role: 'technician', tenant_id: 't1', full_name: 'Tia' } as Record<string, string> | null }
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => authState }))
// The real documents module is loaded for its constants; keep it off the real client.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/sync/connectivity', () => ({ isOnline: vi.fn(() => true) }))
vi.mock('../../lib/api/documents', async (orig) => ({
  ...(await orig<typeof import('../../lib/api/documents')>()),
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  openDocumentUrl: vi.fn(),
  deleteDocument: vi.fn(),
}))

import DocumentsPanel from './DocumentsPanel'
import { deleteDocument, listDocuments, openDocumentUrl, uploadDocument, type CalibrationDocument } from '../../lib/api/documents'
import { isOnline } from '../../lib/sync/connectivity'

const doc = (over: Partial<CalibrationDocument> = {}): CalibrationDocument => ({
  id: 'd1', tenant_id: 't1', record_id: 'r1', asset_id: 'a1', file_path: 't1/r1/x-cert.pdf', file_name: 'cert.pdf',
  content_type: 'application/pdf', size_bytes: 2048, kind: 'certificate', description: null, uploaded_by: 'u1',
  created_at: '2026-10-01T00:00:00Z', ...over,
})

describe('DocumentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.profile = { id: 'u1', role: 'technician', tenant_id: 't1', full_name: 'Tia' }
    vi.mocked(isOnline).mockReturnValue(true)
  })

  it('lists documents and opens them via a signed URL', async () => {
    vi.mocked(listDocuments).mockResolvedValue([doc()])
    vi.mocked(openDocumentUrl).mockResolvedValue('https://signed')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderPage(<DocumentsPanel recordId="r1" />)
    expect(await screen.findByText('cert.pdf')).toBeTruthy()
    expect(screen.getByText(/Certificate · 2 KB/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open cert.pdf' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed', '_blank', 'noopener'))
    expect(listDocuments).toHaveBeenCalledWith({ recordId: 'r1' })
  })

  it('uploads several files with the chosen type', async () => {
    vi.mocked(listDocuments).mockResolvedValue([])
    vi.mocked(uploadDocument).mockResolvedValue(doc())
    renderPage(<DocumentsPanel recordId="r1" />)
    await screen.findByText(/no documents attached/i)
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'photo' } })
    const files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })]
    fireEvent.change(screen.getByTestId('document-input'), { target: { files } })
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(2))
    expect(uploadDocument).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', recordId: 'r1', kind: 'photo' }))
  })

  it('refuses to upload offline and shows upload errors', async () => {
    vi.mocked(listDocuments).mockResolvedValue([])
    renderPage(<DocumentsPanel assetId="a1" />)
    await screen.findByText(/no documents attached/i)
    vi.mocked(isOnline).mockReturnValue(false)
    fireEvent.change(screen.getByTestId('document-input'), { target: { files: [new File(['a'], 'a.pdf')] } })
    expect((await screen.findByRole('alert')).textContent).toMatch(/needs a connection/)
    expect(uploadDocument).not.toHaveBeenCalled()

    vi.mocked(isOnline).mockReturnValue(true)
    vi.mocked(uploadDocument).mockRejectedValue(new Error('File is larger than 25 MB'))
    fireEvent.change(screen.getByTestId('document-input'), { target: { files: [new File(['a'], 'a.pdf')] } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/25 MB/))
    expect(uploadDocument).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'a1', recordId: undefined }))
  })

  it("lets uploaders delete their own files, with confirmation", async () => {
    vi.mocked(listDocuments).mockResolvedValue([doc(), doc({ id: 'd2', file_name: 'other.pdf', uploaded_by: 'someone' })])
    vi.mocked(deleteDocument).mockResolvedValue(undefined)
    renderPage(<DocumentsPanel recordId="r1" />)
    await screen.findByText('cert.pdf')
    expect(screen.queryByRole('button', { name: 'Delete other.pdf' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Delete cert.pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete cert.pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' })))
  })

  it('is read-only for customers', async () => {
    authState.profile = { id: 'c', role: 'customer', tenant_id: 't1', full_name: 'Cust' }
    vi.mocked(listDocuments).mockResolvedValue([doc()])
    renderPage(<DocumentsPanel assetId="a1" />)
    await screen.findByText('cert.pdf')
    expect(screen.queryByRole('button', { name: /upload/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })
})
