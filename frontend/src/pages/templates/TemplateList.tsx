import { Link, useNavigate } from 'react-router-dom'
import { Plus, LayoutTemplate, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTemplates, useDeleteTemplate } from '../../hooks/useTemplates'
import type { CalibrationTemplate } from '../../types'

const instrumentTypeLabels: Record<string, string> = {
  pressure: 'Pressure',
  temperature: 'Temperature',
  ph_conductivity: 'pH / Conductivity',
  level_4_20ma: 'Level (4–20 mA)',
  other: 'Other',
}

const instrumentTypeBadgeClass: Record<string, string> = {
  pressure: 'bg-blue-100 text-blue-700 border-blue-200',
  temperature: 'bg-orange-100 text-orange-700 border-orange-200',
  ph_conductivity: 'bg-green-100 text-green-700 border-green-200',
  level_4_20ma: 'bg-purple-100 text-purple-700 border-purple-200',
  other: 'bg-gray-100 text-gray-600 border-gray-200',
}

const INSTRUMENT_TYPE_ORDER: CalibrationTemplate['instrument_type'][] = [
  'pressure',
  'temperature',
  'ph_conductivity',
  'level_4_20ma',
  'other',
]

function InstrumentTypeBadge({ type }: { type: string }) {
  return (
    <span
      className={[
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border',
        instrumentTypeBadgeClass[type] ?? 'bg-gray-100 text-gray-600 border-gray-200',
      ].join(' ')}
    >
      {instrumentTypeLabels[type] ?? type}
    </span>
  )
}

export default function TemplateList() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: templates = [], isLoading } = useTemplates()
  const deleteMutation = useDeleteTemplate()

  if (profile?.role === 'technician') {
    navigate('/', { replace: true })
    return null
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return
    await deleteMutation.mutateAsync(id)
  }

  // Group by instrument type
  const grouped = INSTRUMENT_TYPE_ORDER.reduce<
    Record<string, CalibrationTemplate[]>
  >((acc, type) => {
    const items = templates.filter((t) => t.instrument_type === type)
    if (items.length > 0) acc[type] = items
    return acc
  }, {})

  // Include any types not in the order list
  templates.forEach((t) => {
    if (!INSTRUMENT_TYPE_ORDER.includes(t.instrument_type)) {
      if (!grouped[t.instrument_type]) grouped[t.instrument_type] = []
      grouped[t.instrument_type].push(t)
    }
  })

  const hasTemplates = templates.length > 0

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Calibration Templates
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Reusable test-point configurations for each instrument type
          </p>
        </div>
        <Link
          to="/templates/new"
          className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors"
        >
          <Plus size={16} /> New Template
        </Link>
      </div>

      {/* Loading skeletons */}
      {isLoading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-20 bg-gray-100 rounded-xl animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !hasTemplates && (
        <div className="text-center py-20 text-gray-400">
          <LayoutTemplate
            size={48}
            className="mx-auto mb-4 opacity-40"
          />
          <p className="font-semibold text-base">No templates yet</p>
          <p className="text-sm mt-1">
            Create a template so technicians can pre-fill calibration forms
            in one tap.
          </p>
          <Link
            to="/templates/new"
            className="mt-5 inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Plus size={16} /> New Template
          </Link>
        </div>
      )}

      {/* Grouped list */}
      {!isLoading && hasTemplates && (
        <div className="space-y-8">
          {Object.entries(grouped).map(([type, items]) => (
            <section key={type}>
              <div className="flex items-center gap-3 mb-3">
                <InstrumentTypeBadge type={type} />
                <span className="text-sm text-gray-400">
                  {items.length}{' '}
                  {items.length === 1 ? 'template' : 'templates'}
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-gray-700">
                        Name
                      </th>
                      <th className="px-4 py-3 font-semibold text-gray-700 hidden md:table-cell">
                        Description
                      </th>
                      <th className="px-4 py-3 font-semibold text-gray-700 text-right">
                        Points
                      </th>
                      <th className="px-4 py-3 font-semibold text-gray-700 text-right">
                        Tolerance
                      </th>
                      <th className="px-4 py-3 w-20" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((tpl) => (
                      <tr
                        key={tpl.id}
                        className="border-t border-gray-100 hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {tpl.name}
                        </td>
                        <td className="px-4 py-3 text-gray-500 hidden md:table-cell max-w-xs truncate">
                          {tpl.description ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-right tabular-nums">
                          {tpl.points.length}
                        </td>
                        <td className="px-4 py-3 text-gray-700 text-right tabular-nums">
                          ±{tpl.tolerance_pct}%
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <Link
                              to={`/templates/${tpl.id}/edit`}
                              className="p-2 text-gray-400 hover:text-brand-500 rounded-lg transition-colors"
                              title="Edit template"
                            >
                              <Pencil size={16} />
                            </Link>
                            <button
                              onClick={() => handleDelete(tpl.id, tpl.name)}
                              className="p-2 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
                              title="Delete template"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
