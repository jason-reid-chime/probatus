import { Link, useNavigate } from 'react-router-dom'
import { Plus, AlertTriangle, Clock, Shield, Pencil, Trash2, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useStandards, useDeleteStandard } from '../../hooks/useStandards'
import { isStandardExpired, isStandardDueSoon } from '../../types'
import type { MasterStandard } from '../../types'
import { supabase } from '../../lib/supabase'

function useCalibrationCounts() {
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    supabase
      .from('calibration_standards_used')
      .select('standard_id')
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, number> = {}
        for (const row of data) {
          map[row.standard_id] = (map[row.standard_id] ?? 0) + 1
        }
        setCounts(map)
      })
  }, [])
  return counts
}

function StatusBadge({ standard }: { standard: MasterStandard }) {
  if (isStandardExpired(standard)) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-300">
        <AlertTriangle size={12} /> EXPIRED
      </span>
    )
  }
  if (isStandardDueSoon(standard, 30)) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-300">
        <Clock size={12} /> Due within 30 days
      </span>
    )
  }
  if (isStandardDueSoon(standard, 90)) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 border border-yellow-300">
        <Clock size={12} /> Due within 90 days
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-300">
      <Shield size={12} /> Valid
    </span>
  )
}

type StatusPill = 'all' | 'valid' | 'due-soon' | 'overdue'

const STATUS_PILLS: { value: StatusPill; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'valid', label: 'Valid' },
  { value: 'due-soon', label: 'Due Soon' },
  { value: 'overdue', label: 'Overdue' },
]

export default function StandardsList() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: standards = [], isLoading } = useStandards()
  const deleteMutation = useDeleteStandard()
  const calibrationCounts = useCalibrationCounts()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusPill>('all')

  if (profile?.role === 'technician') {
    navigate('/', { replace: true })
    return null
  }

  const sorted = [...standards].sort((a, b) => {
    const aExp = isStandardExpired(a) ? 0 : 1
    const bExp = isStandardExpired(b) ? 0 : 1
    if (aExp !== bExp) return aExp - bExp
    return a.due_at.localeCompare(b.due_at)
  })

  const displayed = sorted.filter((s) => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !s.name.toLowerCase().includes(q) &&
        !(s.serial_number ?? '').toLowerCase().includes(q)
      ) return false
    }
    if (statusFilter === 'overdue' && !isStandardExpired(s)) return false
    if (statusFilter === 'due-soon' && (isStandardExpired(s) || !isStandardDueSoon(s, 30))) return false
    if (statusFilter === 'valid' && (isStandardExpired(s) || isStandardDueSoon(s, 30))) return false
    return true
  })

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete standard "${name}"? This cannot be undone.`)) return
    await deleteMutation.mutateAsync(id)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Master Standards</h1>
          <p className="text-sm text-gray-500 mt-1">
            Reference equipment used to perform calibrations
          </p>
        </div>
        <Link
          to="/standards/new"
          className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors"
        >
          <Plus size={16} /> Add Standard
        </Link>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="search"
            placeholder="Search by name or serial number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_PILLS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={[
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                statusFilter === value
                  ? 'bg-brand-500 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && displayed.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Shield size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium">
            {search || statusFilter !== 'all' ? 'No standards match your filters' : 'No master standards yet'}
          </p>
          <p className="text-sm mt-1">
            {search || statusFilter !== 'all' ? 'Try adjusting your search or filter.' : 'Add the test equipment your technicians use'}
          </p>
        </div>
      )}

      {!isLoading && displayed.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-700">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Serial #</th>
                <th className="px-4 py-3 font-semibold text-gray-700 hidden md:table-cell">Cert Ref</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Due Date</th>
                <th className="px-4 py-3 font-semibold text-gray-700 hidden md:table-cell">Used in</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {displayed.map((s) => (
                <tr
                  key={s.id}
                  className={`border-t border-gray-100 ${isStandardExpired(s) ? 'bg-red-50' : isStandardDueSoon(s, 30) ? 'bg-amber-50' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <Link
                      to={`/standards/${s.id}`}
                      className="hover:text-brand-600 hover:underline transition-colors"
                    >
                      {s.name}
                    </Link>
                    {s.manufacturer && (
                      <span className="block text-xs text-gray-500 font-normal">{s.manufacturer}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-700">{s.serial_number}</td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{s.certificate_ref ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{s.due_at}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                      {calibrationCounts[s.id] ?? 0} calibration{(calibrationCounts[s.id] ?? 0) !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge standard={s} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <Link
                        to={`/standards/${s.id}/edit`}
                        className="p-2 text-gray-400 hover:text-brand-500 rounded-lg transition-colors"
                      >
                        <Pencil size={16} />
                      </Link>
                      <button
                        onClick={() => handleDelete(s.id, s.name)}
                        className="p-2 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
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
      )}
    </div>
  )
}
