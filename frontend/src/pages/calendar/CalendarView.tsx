import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

interface CalAsset {
  id: string
  tag_id: string
  next_due_at: string
  instrument_type: string
  serial_number: string | null
}

const INSTRUMENT_LABELS: Record<string, string> = {
  pressure: 'Pressure',
  temperature: 'Temperature',
  ph_conductivity: 'pH / Conductivity',
  level_4_20ma: 'Level / 4-20 mA',
  other: 'Other',
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function todayKey(): string {
  return toDateKey(new Date())
}

function assetStatus(nextDueAt: string): 'overdue' | 'due-soon' | 'upcoming' {
  const now = Date.now()
  const due = new Date(nextDueAt).getTime()
  if (due < now) return 'overdue'
  if (due - now <= 7 * 24 * 60 * 60 * 1000) return 'due-soon'
  return 'upcoming'
}

function buildCalendarGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1)
  const startOffset = firstDay.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function getWeekNumber(date: Date, monthStart: Date): number {
  const diff = Math.floor((date.getTime() - monthStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
  return diff + 1
}

export default function CalendarView() {
  const { profile } = useAuth()
  const tenantId = profile?.tenant_id

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const year = currentMonth.getFullYear()
  const month = currentMonth.getMonth()

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['calendar-assets', tenantId],
    queryFn: async () => {
      if (!tenantId) return []
      const { data, error } = await supabase
        .from('assets')
        .select('id, tag_id, next_due_at, instrument_type, serial_number')
        .not('next_due_at', 'is', null)
        .eq('tenant_id', tenantId)
      if (error) throw error
      return (data ?? []) as CalAsset[]
    },
    enabled: !!tenantId,
  })

  const assetsByDay = useMemo(() => {
    const map = new Map<string, CalAsset[]>()
    for (const asset of assets) {
      const key = toDateKey(new Date(asset.next_due_at))
      const existing = map.get(key) ?? []
      existing.push(asset)
      map.set(key, existing)
    }
    return map
  }, [assets])

  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)

  const assetsThisMonth = useMemo(() => {
    return assets.filter((a) => {
      const d = new Date(a.next_due_at)
      return d >= monthStart && d <= monthEnd
    })
  }, [assets, year, month])

  const assetsByWeek = useMemo(() => {
    const groups = new Map<number, CalAsset[]>()
    for (const asset of assetsThisMonth) {
      const d = new Date(asset.next_due_at)
      const week = getWeekNumber(d, monthStart)
      const existing = groups.get(week) ?? []
      existing.push(asset)
      groups.set(week, existing)
    }
    return groups
  }, [assetsThisMonth])

  const calendarCells = useMemo(() => buildCalendarGrid(year, month), [year, month])

  const today = todayKey()

  const goToPrevMonth = () => setCurrentMonth(new Date(year, month - 1, 1))
  const goToNextMonth = () => setCurrentMonth(new Date(year, month + 1, 1))
  const goToToday = () => {
    const now = new Date()
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedDay(today)
  }

  const selectedAssets = selectedDay ? (assetsByDay.get(selectedDay) ?? []) : null

  const statusStyles = {
    overdue: 'bg-red-50 text-red-700',
    'due-soon': 'bg-amber-50 text-amber-700',
    upcoming: 'bg-green-50 text-green-700',
  }

  const dotStyles = {
    overdue: 'bg-red-500',
    'due-soon': 'bg-amber-400',
    upcoming: 'bg-green-500',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
          <button
            onClick={goToToday}
            className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Today
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <button
              onClick={goToPrevMonth}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50"
              aria-label="Previous month"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-lg font-semibold text-gray-900">
              {MONTH_NAMES[month]} {year}
            </span>
            <button
              onClick={goToNextMonth}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50"
              aria-label="Next month"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="hidden sm:grid grid-cols-7">
            {DAY_LABELS.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-400">
                {d}
              </div>
            ))}
          </div>

          <div className="hidden sm:grid grid-cols-7 border-t border-gray-100">
            {calendarCells.map((date, idx) => {
              if (!date) {
                return <div key={`empty-${idx}`} className="min-h-[80px] p-1 border border-gray-100 bg-gray-50" />
              }

              const key = toDateKey(date)
              const dayAssets = assetsByDay.get(key) ?? []
              const isToday = key === today
              const isPast = key < today
              const hasOverdue = isPast && dayAssets.length > 0
              const isSelected = key === selectedDay

              let cellClass = 'min-h-[80px] p-1 border border-gray-100 cursor-pointer transition-colors hover:bg-gray-50'
              if (isToday) cellClass += ' bg-brand-50 border-brand-200'
              else if (hasOverdue) cellClass += ' bg-red-50'
              if (isSelected) cellClass += ' ring-2 ring-brand-500 ring-inset'

              return (
                <div
                  key={key}
                  className={cellClass}
                  onClick={() => setSelectedDay(isSelected ? null : key)}
                >
                  <div className={`text-sm font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-brand-500 text-white' : isPast ? 'text-gray-400' : 'text-gray-700'}`}>
                    {date.getDate()}
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {dayAssets.slice(0, 3).map((a) => {
                      const st = assetStatus(a.next_due_at)
                      return (
                        <span
                          key={a.id}
                          className={`inline-block h-1.5 w-1.5 rounded-full ${dotStyles[st]}`}
                          title={a.tag_id}
                        />
                      )
                    })}
                    {dayAssets.length > 3 && (
                      <span className="text-xs text-gray-400 leading-none">+{dayAssets.length - 3}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {selectedAssets && selectedAssets.length > 0 && (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
            <h2 className="text-base font-semibold text-gray-900 mb-3">
              Assets due {selectedDay}
            </h2>
            <div className="space-y-2">
              {selectedAssets.map((a) => {
                const st = assetStatus(a.next_due_at)
                return (
                  <Link
                    key={a.id}
                    to={`/assets/${a.id}`}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-opacity hover:opacity-80 ${statusStyles[st]}`}
                  >
                    <span className="font-mono font-semibold">{a.tag_id}</span>
                    <span>{INSTRUMENT_LABELS[a.instrument_type] ?? a.instrument_type}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {selectedAssets && selectedAssets.length === 0 && (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm p-4 text-center text-sm text-gray-500">
            No assets due on this day.
          </div>
        )}

        <div className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {MONTH_NAMES[month]} {year} — Due This Month
          </h2>

          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && assetsThisMonth.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
              <CalendarDays size={48} className="mb-4 text-gray-300" />
              <h3 className="mb-1 text-xl font-semibold text-gray-700">No calibrations due this month</h3>
              <p className="text-base text-gray-500">Navigate to another month or add due dates to your assets.</p>
            </div>
          )}

          {!isLoading && assetsThisMonth.length > 0 && (
            <div className="space-y-6">
              {Array.from(assetsByWeek.entries())
                .sort(([a], [b]) => a - b)
                .map(([week, weekAssets]) => {
                  const sorted = [...weekAssets].sort(
                    (a, b) => new Date(a.next_due_at).getTime() - new Date(b.next_due_at).getTime()
                  )
                  return (
                    <div key={week}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Week {week}
                      </p>
                      <div className="space-y-2">
                        {sorted.map((a) => {
                          const st = assetStatus(a.next_due_at)
                          const dueDate = new Date(a.next_due_at).toLocaleDateString(undefined, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })
                          return (
                            <Link
                              key={a.id}
                              to={`/assets/${a.id}`}
                              className={`flex items-center justify-between rounded-xl px-4 py-3 transition-opacity hover:opacity-80 ${statusStyles[st]}`}
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm font-semibold">{a.tag_id}</span>
                                <span className="text-sm">{INSTRUMENT_LABELS[a.instrument_type] ?? a.instrument_type}</span>
                              </div>
                              <span className="text-sm font-medium">{dueDate}</span>
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center gap-6 rounded-2xl border border-gray-200 bg-white shadow-sm px-5 py-4">
          <span className="text-sm font-semibold text-gray-600">Legend</span>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
            <span className="text-sm text-gray-700">Overdue</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-amber-400" />
            <span className="text-sm text-gray-700">Due Soon (7 days)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
            <span className="text-sm text-gray-700">Upcoming</span>
          </div>
        </div>
      </main>
    </div>
  )
}
