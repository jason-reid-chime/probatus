import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Trash2, Loader2, FlaskConical, Users } from 'lucide-react'
import { useWorkOrder, useDeleteWorkOrder } from '../../hooks/useWorkOrders'
import { useAuth } from '../../hooks/useAuth'

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700 border border-blue-200',
  in_progress: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  completed: 'bg-green-100 text-green-700 border border-green-200',
  cancelled: 'bg-gray-100 text-gray-500 border border-gray-200',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

function SkeletonBlock() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-6 w-64 rounded bg-gray-200" />
      <div className="h-4 w-40 rounded bg-gray-100" />
      <div className="h-4 w-32 rounded bg-gray-100" />
    </div>
  )
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: wo, isLoading } = useWorkOrder(id ?? '')
  const deleteWo = useDeleteWorkOrder()

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const canEdit = profile?.role === 'supervisor' || profile?.role === 'admin'

  async function handleDelete() {
    if (!id) return
    setDeleteError(null)
    try {
      await deleteWo.mutateAsync(id)
      navigate('/work-orders')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-gray-400 hover:text-gray-700 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-gray-900">Work Order</h1>
        </div>
        {canEdit && wo && (
          <div className="flex items-center gap-2">
            <Link
              to={`/work-orders/${id}/edit`}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Pencil size={16} />
              Edit
            </Link>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-100 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        )}
      </div>

      {isLoading && <SkeletonBlock />}

      {!isLoading && wo && (
        <>
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm px-5 py-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-2xl font-bold text-gray-900">{wo.title}</h2>
              <span
                className={`inline-flex items-center rounded-full px-3 py-0.5 text-sm font-medium flex-shrink-0 ${STATUS_BADGE[wo.status] ?? STATUS_BADGE.open}`}
              >
                {STATUS_LABEL[wo.status] ?? wo.status}
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Scheduled Date
                </dt>
                <dd className="mt-1 text-base text-gray-800">
                  {wo.scheduled_date
                    ? new Date(wo.scheduled_date + 'T00:00:00').toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Customer
                </dt>
                <dd className="mt-1 text-base text-gray-800">
                  {wo.customer?.name ?? <span className="text-gray-400 italic">None</span>}
                </dd>
              </div>
            </dl>

            {wo.notes && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Notes
                </dt>
                <dd className="mt-1 text-base text-gray-700 whitespace-pre-wrap">{wo.notes}</dd>
              </div>
            )}
          </div>

          {wo.technicians.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm px-5 py-5 space-y-3">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                <Users size={14} />
                Assigned Technicians ({wo.technicians.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {wo.technicians.map((tech) => (
                  <span
                    key={tech.id}
                    className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-200 px-3 py-1 text-sm font-medium text-indigo-700"
                  >
                    {tech.full_name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm px-5 py-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Assets ({wo.assets.length})
            </h3>

            {wo.assets.length === 0 && (
              <p className="text-sm text-gray-400 italic">No assets linked to this work order.</p>
            )}

            {wo.assets.length > 0 && (
              <div className="space-y-2">
                {wo.assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/assets/${asset.id}`}
                        className="font-mono text-sm font-semibold text-brand-700 hover:underline"
                      >
                        {asset.tag_id}
                      </Link>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {[
                          asset.instrument_type.replace(/_/g, ' '),
                          asset.serial_number ? `S/N: ${asset.serial_number}` : null,
                          asset.manufacturer,
                          asset.model,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <Link
                      to={`/calibrations/${asset.id}/new`}
                      className="flex items-center gap-1.5 flex-shrink-0 rounded-xl border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 transition-colors"
                    >
                      <FlaskConical size={14} />
                      Start Calibration
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {!isLoading && !wo && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-gray-500">Work order not found.</p>
        </div>
      )}

      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 space-y-4">
            <h2 id="delete-modal-title" className="text-lg font-bold text-gray-900">
              Delete Work Order?
            </h2>
            <p className="text-sm text-gray-600">
              This will permanently delete <strong>{wo?.title}</strong> and unlink all associated
              assets. This cannot be undone.
            </p>

            {deleteError && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleteWo.isPending}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteWo.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-60"
              >
                {deleteWo.isPending && <Loader2 size={14} className="animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
