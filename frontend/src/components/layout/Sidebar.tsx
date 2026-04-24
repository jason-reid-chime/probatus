import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Wrench,
  ClipboardList,
  ClipboardCheck,
  FlaskConical,
  LayoutTemplate,
  FileCheck,
  LogOut,
  Wifi,
  WifiOff,
  Building2,
  CalendarDays,
  Briefcase,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useCustomerFilter } from '../../hooks/useCustomerFilter'
import { supabase } from '../../lib/supabase'
import { isOnline, toggleForcedOffline } from '../../lib/sync/connectivity'

interface SidebarProps {
  onClose?: () => void
}

const roleBadgeClass: Record<string, string> = {
  technician: 'bg-gray-100 text-gray-600',
  supervisor: 'bg-brand-500 text-white',
  admin: 'bg-red-600 text-white',
}

const roleLabel: Record<string, string> = {
  technician: 'Technician',
  supervisor: 'Supervisor',
  admin: 'Admin',
}

interface NavItem {
  to: string
  label: string
  Icon: React.ComponentType<{ className?: string }>
  roles?: Array<'technician' | 'supervisor' | 'admin'>
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/calendar', label: 'Calendar', Icon: CalendarDays },
  { to: '/assets', label: 'Assets', Icon: Wrench },
  { to: '/calibrations', label: 'Calibrations', Icon: ClipboardList },
  { to: '/customers', label: 'Customers', Icon: Building2 },
  { to: '/work-orders', label: 'Work Orders', Icon: Briefcase },
  {
    to: '/approvals',
    label: 'Approvals',
    Icon: ClipboardCheck,
    roles: ['supervisor', 'admin'],
  },
  {
    to: '/standards',
    label: 'Standards',
    Icon: FlaskConical,
    roles: ['supervisor', 'admin'],
  },
  {
    to: '/templates',
    label: 'Templates',
    Icon: LayoutTemplate,
    roles: ['supervisor', 'admin'],
  },
  {
    to: '/audit',
    label: 'Audit Package',
    Icon: FileCheck,
    roles: ['supervisor', 'admin'],
  },
]

export default function Sidebar({ onClose }: SidebarProps) {
  const { profile, signOut, refreshProfile } = useAuth()
  const { customers, selectedCustomerId, setSelectedCustomerId } = useCustomerFilter()
  const [online, setOnline] = useState(isOnline())

  useEffect(() => {
    const sync = () => setOnline(isOnline())
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync) }
  }, [])

  const handleConnectivityToggle = () => {
    toggleForcedOffline()
    setOnline(isOnline())
  }

  const handleSignOut = async () => {
    await signOut()
  }

  const handleRoleSwitch = async (newRole: string) => {
    if (!profile || newRole === profile.role) return
    await supabase.from('profiles').update({ role: newRole }).eq('id', profile.id)
    await refreshProfile()
  }

  const visibleItems = navItems.filter((item) => {
    if (!item.roles) return true
    if (!profile) return false
    return item.roles.includes(profile.role as 'technician' | 'supervisor' | 'admin')
  })

  return (
    <aside className="flex flex-col h-full bg-white border-r border-gray-200 w-64 flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
        <span className="text-2xl font-black tracking-widest text-brand-700 select-none">
          PROBATUS
        </span>
        {/* Close button (mobile) */}
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label="Close menu"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {visibleItems.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onClose}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors min-h-[48px]',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={[
                    'w-5 h-5 flex-shrink-0',
                    isActive ? 'text-brand-600' : 'text-gray-400',
                  ].join(' ')}
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Client filter */}
      {customers.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-4">
          <label
            htmlFor="sidebar-customer-filter"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400"
          >
            Client
          </label>
          <select
            id="sidebar-customer-filter"
            value={selectedCustomerId ?? ''}
            onChange={(e) => setSelectedCustomerId(e.target.value || null)}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All Clients</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* User footer */}
      <div className="border-t border-gray-100 px-4 py-4">
        {profile && (
          <div className="mb-3 px-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{profile.full_name}</p>
            {profile.roles && profile.roles.length > 1 ? (
              <select
                value={profile.role}
                onChange={(e) => handleRoleSwitch(e.target.value)}
                className="mt-1 w-full text-xs rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 font-medium text-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {profile.roles.map((r) => (
                  <option key={r} value={r}>{roleLabel[r] ?? r}</option>
                ))}
              </select>
            ) : (
              <span className={['inline-block mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium', roleBadgeClass[profile.role] ?? 'bg-gray-100 text-gray-600'].join(' ')}>
                {roleLabel[profile.role] ?? profile.role}
              </span>
            )}
          </div>
        )}
        <button
          onClick={handleConnectivityToggle}
          className={[
            'flex items-center gap-3 w-full px-4 py-2 rounded-xl text-sm font-medium transition-colors min-h-[40px] mb-1',
            online ? 'text-green-700 hover:bg-green-50' : 'text-gray-500 hover:bg-gray-100',
          ].join(' ')}
        >
          {online
            ? <Wifi className="w-4 h-4 text-green-500 flex-shrink-0" />
            : <WifiOff className="w-4 h-4 text-gray-400 flex-shrink-0" />}
          {online ? 'Online' : 'Offline (simulated)'}
        </button>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors min-h-[48px] focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <LogOut className="w-5 h-5 text-gray-400 flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
