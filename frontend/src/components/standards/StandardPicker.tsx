import { AlertTriangle } from 'lucide-react'
import { useStandards } from '../../hooks/useStandards'
import { isStandardExpired } from '../../types'

interface StandardPickerProps {
  selected: string[]
  onChange: (ids: string[]) => void
}

export default function StandardPicker({ selected, onChange }: StandardPickerProps) {
  const { data: standards = [], isLoading } = useStandards()

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  if (isLoading) return <p className="text-sm text-gray-400">Loading standards…</p>
  if (standards.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">
        No master standards configured. Add them in the Standards section.
      </p>
    )
  }

  const expired = selected.some((id) => {
    const s = standards.find((x) => x.id === id)
    return s && isStandardExpired(s)
  })

  return (
    <div className="space-y-2">
      {expired && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
          <AlertTriangle size={15} />
          <span>One or more selected standards are expired. This calibration cannot be saved.</span>
        </div>
      )}
      <div className="space-y-1 max-h-52 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100">
        {standards.map((s) => {
          const exp = isStandardExpired(s)
          return (
            <label
              key={s.id}
              className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${exp ? 'bg-red-50' : ''}`}
            >
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={() => toggle(s.id)}
                className="mt-0.5 w-4 h-4 accent-brand-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${exp ? 'text-red-700' : 'text-gray-900'}`}>
                    {s.name}
                  </span>
                  {exp && <AlertTriangle size={13} className="text-red-600 shrink-0" />}
                </div>
                <span className="text-xs text-gray-500 font-mono">{s.serial_number}</span>
                <span className={`block text-xs ${exp ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                  Due: {s.due_at}
                </span>
              </div>
            </label>
          )
        })}
      </div>
      {selected.length > 0 && (
        <p className="text-xs text-gray-500 text-right">
          {selected.length} standard{selected.length !== 1 ? 's' : ''} selected
        </p>
      )}
    </div>
  )
}
