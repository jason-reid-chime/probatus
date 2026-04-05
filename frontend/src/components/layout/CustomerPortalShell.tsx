import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

export default function CustomerPortalShell() {
  const { user, profile, loading, signOut } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500 font-medium">Loading…</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch {
      // sign-out errors are non-critical; navigation will follow session clearing
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Top navbar */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <span className="text-xl font-black tracking-widest text-brand-700 select-none">
              PROBATUS
            </span>
            {profile?.full_name && (
              <>
                <span className="text-gray-300 text-lg font-light select-none">|</span>
                <span className="text-sm font-medium text-gray-600 truncate max-w-[180px] sm:max-w-xs">
                  {profile.full_name}
                </span>
              </>
            )}
          </div>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors px-3 py-2 rounded-lg hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
    </div>
  )
}
