import { useState, useEffect } from 'react'
import { Menu, Wifi, WifiOff } from 'lucide-react'
import { isOnline, toggleForcedOffline, isForcedOffline } from '../../lib/sync/connectivity'

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const [online, setOnline] = useState(isOnline)
  const [forced, setForced] = useState(isForcedOffline)

  useEffect(() => {
    const handleOnline  = () => setOnline(isOnline())
    const handleOffline = () => setOnline(isOnline())
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const handleToggle = () => {
    const nowForced = toggleForcedOffline()
    setForced(nowForced)
    setOnline(isOnline())
  }

  return (
    <header className="md:hidden flex items-center justify-between bg-white border-b border-gray-200 px-4 py-3 h-14">
      {/* Hamburger */}
      <button
        onClick={onMenuClick}
        className="p-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
        aria-label="Open menu"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Brand */}
      <span className="text-lg font-black tracking-widest text-brand-700 select-none">PROBATUS</span>

      {/* Online/offline toggle */}
      <button
        onClick={handleToggle}
        title={forced ? 'Simulating offline — click to go online' : 'Click to simulate offline'}
        className={[
          'flex items-center gap-1.5 pr-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors',
          online ? 'text-green-600 hover:bg-green-50' : 'text-gray-500 hover:bg-gray-100',
        ].join(' ')}
      >
        {online
          ? <Wifi size={15} className="text-green-500" />
          : <WifiOff size={15} className="text-gray-400" />}
        {online ? 'Online' : forced ? 'Offline (sim)' : 'Offline'}
      </button>
    </header>
  )
}
