import { Link } from 'react-router-dom'
import { X, LayoutTemplate, ChevronRight } from 'lucide-react'
import { useTemplates } from '../../hooks/useTemplates'
import type { CalibrationTemplate } from '../../types'

interface TemplatePickerProps {
  instrumentType: string
  onSelect: (template: CalibrationTemplate) => void
  onDismiss: () => void
}

const instrumentTypeLabels: Record<string, string> = {
  pressure: 'Pressure',
  temperature: 'Temperature',
  ph_conductivity: 'pH / Conductivity',
  level_4_20ma: 'Level (4–20 mA)',
  other: 'Other',
}

function normaliseInstrumentType(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('pressure')) return 'pressure'
  if (lower.includes('temperature')) return 'temperature'
  if (lower.includes('ph') || lower.includes('conductivity')) return 'ph_conductivity'
  if (lower.includes('level') || lower.includes('4-20') || lower.includes('420')) return 'level_4_20ma'
  return 'other'
}

export default function TemplatePicker({
  instrumentType,
  onSelect,
  onDismiss,
}: TemplatePickerProps) {
  const normType = normaliseInstrumentType(instrumentType)
  const { data: templates = [], isLoading } = useTemplates(normType)

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      {/* Sheet / modal */}
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <LayoutTemplate size={20} className="text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">
              Choose a Template
            </h2>
          </div>
          <button
            onClick={onDismiss}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Sub-header: instrument type */}
        <div className="px-5 py-2 bg-gray-50 border-b border-gray-100">
          <span className="text-xs text-gray-500 uppercase tracking-wide font-medium">
            {instrumentTypeLabels[normType] ?? normType}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="px-5 py-8 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-16 bg-gray-100 rounded-xl animate-pulse"
                />
              ))}
            </div>
          )}

          {!isLoading && templates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-5 text-center">
              <LayoutTemplate
                size={40}
                className="text-gray-300 mb-3"
              />
              <p className="font-medium text-gray-500">No templates yet</p>
              <p className="text-sm text-gray-400 mt-1">
                Supervisors can create reusable calibration templates.
              </p>
              <Link
                to="/templates/new"
                onClick={onDismiss}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
              >
                Create a template
                <ChevronRight size={14} />
              </Link>
            </div>
          )}

          {!isLoading && templates.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {templates.map((tpl) => (
                <li key={tpl.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(tpl)
                      onDismiss()
                    }}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-brand-50 active:bg-brand-100 transition-colors min-h-[64px] group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 group-hover:text-brand-700 truncate">
                        {tpl.name}
                      </p>
                      {tpl.description && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          {tpl.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-400">
                          {tpl.points.length}{' '}
                          {tpl.points.length === 1 ? 'point' : 'points'}
                        </span>
                        <span className="text-xs text-gray-400">
                          ±{tpl.tolerance_pct}% tolerance
                        </span>
                      </div>
                    </div>
                    <ChevronRight
                      size={16}
                      className="text-gray-300 group-hover:text-brand-400 flex-shrink-0"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
