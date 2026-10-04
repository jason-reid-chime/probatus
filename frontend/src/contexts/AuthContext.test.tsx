import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useContext } from 'react'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn(),
    },
    from: vi.fn(),
  },
}))
vi.mock('../lib/sync/outbox', () => ({
  flushOutbox: vi.fn().mockResolvedValue(undefined),
  clearLocalDataOnSignOut: vi.fn().mockResolvedValue(undefined),
}))

import { AuthProvider, AuthContext } from './AuthContext'
import { supabase } from '../lib/supabase'
import { flushOutbox, clearLocalDataOnSignOut } from '../lib/sync/outbox'

describe('AuthContext signOut', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flushes the outbox, signs out, then clears local data and the query cache', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['assets', 't'], [{ id: 'cached' }])
    const onCtx = vi.fn<(c: React.ContextType<typeof AuthContext>) => void>()
    function Probe() { onCtx(useContext(AuthContext)); return null }
    const latest = () => onCtx.mock.lastCall?.[0]

    render(
      <QueryClientProvider client={qc}>
        <AuthProvider><Probe /></AuthProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(latest()?.loading).toBe(false))

    await act(async () => { await latest()!.signOut() })

    const flushOrder = vi.mocked(flushOutbox).mock.invocationCallOrder[0]
    const signOutOrder = vi.mocked(supabase.auth.signOut).mock.invocationCallOrder[0]
    const clearOrder = vi.mocked(clearLocalDataOnSignOut).mock.invocationCallOrder[0]
    expect(flushOrder).toBeLessThan(signOutOrder)
    expect(signOutOrder).toBeLessThan(clearOrder)
    expect(qc.getQueryData(['assets', 't'])).toBeUndefined()
  })
})
