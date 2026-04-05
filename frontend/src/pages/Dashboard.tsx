import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle, Clock, Calendar, Shield, Wifi, WifiOff, RefreshCw,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  fetchDashboardStats, fetchOverdueAssets, fetchDueSoonAssets,
  type DashboardStats, type OverdueAsset,
} from '../lib/api/dashboard'

function greeting(name: string) {
  const h = new Date().getHours()
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  return `Good ${time}, ${name.split(' ')[0]}`
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function StatCard({
  label, value, icon: Icon, color,
}: {
  label: string; value: number; icon: React.ElementType; color: string
}) {
  return (
    <div className={`rounded-2xl p-6 shadow-sm border ${color} flex items-start gap-4`}>
      <Icon size={28} className="shrink-0 mt-0.5 opacity-80" />
      <div>
        <p className="text-3xl font-bold">{value}</p>
        <p className="text-sm font-medium mt-0.5 opacity-80">{label}</p>
      </div>
    </div>
  )
}

function PassRateCard({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100)
  const color = pct >= 90 ? 'bg-green-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-500'
  const textColor = pct >= 90 ? 'text-green-700' : pct >= 75 ? 'text-amber-700' : 'text-red-700'
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-3">
      <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
        Pass Rate — last 30 days
      </p>
      <p className={`text-5xl font-bold ${textColor}`}>{pct}%</p>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function AssetRow({ asset, overdue }: { asset: OverdueAsset; overdue: boolean }) {
  return (
    <Link
      to={`/assets/${asset.id}`}
      className="flex items-start justify-between px-4 py-3 hover:bg-gray-50 transition-colors border-t border-gray-100 first:border-0"
    >
      <div>
        <p className="font-semibold text-gray-900 text-sm">{asset.tag_id}</p>
        {(asset.manufacturer || asset.model) && (
          <p className="text-xs text-gray-500">{[asset.manufacturer, asset.model].filter(Boolean).join(' ')}</p>
        )}
        {asset.location && <p className="text-xs text-gray-400">{asset.location}</p>}
      </div>
      <p className={`text-xs font-semibold shrink-0 ml-4 mt-0.5 ${overdue ? 'text-red-600' : 'text-amber-600'}`}>
        {asset.next_due_at}
      </p>
    </Link>
  )
}

function SkeletonCard() {
  return <div className="rounded-2xl p-6 h-28 bg-gray-100 animate-pulse" />
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const { data: stats, isLoading: statsLoading, isError, refetch } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
    staleTime: 1000 * 60 * 2,
  })

  const { data: overdue = [] } = useQuery<OverdueAsset[]>({
    queryKey: ['overdue-assets'],
    queryFn: fetchOverdueAssets,
  })

  const { data: dueSoon = [] } = useQuery<OverdueAsset[]>({
    queryKey: ['due-soon-assets'],
    queryFn: fetchDueSoonAssets,
  })

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-700">
            {profile ? greeting(profile.full_name) : 'Dashboard'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{formatDate(new Date())}</p>
        </div>
        <div className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ${online ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {online ? <Wifi size={13} /> : <WifiOff size={13} />}
          {online ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* Stat cards */}
      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex items-center justify-between">
          <p className="text-red-700 text-sm font-medium">Could not load dashboard data</p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-800 font-semibold"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Overdue"
            value={stats?.overdue_count ?? 0}
            icon={AlertCircle}
            color="bg-red-50 border-red-200 text-red-700"
          />
          <StatCard
            label="Due in 30 days"
            value={stats?.due_within_30 ?? 0}
            icon={Clock}
            color="bg-amber-50 border-amber-200 text-amber-700"
          />
          <StatCard
            label="Due in 90 days"
            value={stats?.due_within_90 ?? 0}
            icon={Calendar}
            color="bg-yellow-50 border-yellow-200 text-yellow-700"
          />
          <StatCard
            label="Standards expiring"
            value={stats?.standards_expiring_soon ?? 0}
            icon={Shield}
            color="bg-orange-50 border-orange-200 text-orange-700"
          />
        </div>
      )}

      {/* Pass rate */}
      {!statsLoading && !isError && stats && (
        <PassRateCard rate={stats.pass_rate_30d} />
      )}

      {/* Asset lists */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <AlertCircle size={16} className="text-red-500" /> Overdue Instruments
            </h2>
          </div>
          {overdue.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400">
              <p className="text-2xl mb-2">✓</p>
              <p className="text-sm font-medium">No overdue instruments</p>
            </div>
          ) : (
            overdue.map((a) => <AssetRow key={a.id} asset={a} overdue />)
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Clock size={16} className="text-amber-500" /> Due in Next 30 Days
            </h2>
          </div>
          {dueSoon.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400">
              <p className="text-sm font-medium">Nothing due in the next 30 days</p>
            </div>
          ) : (
            dueSoon.map((a) => <AssetRow key={a.id} asset={a} overdue={false} />)
          )}
        </div>
      </div>
    </div>
  )
}
