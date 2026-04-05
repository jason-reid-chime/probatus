import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isOnline, toggleForcedOffline, isForcedOffline, startConnectivityMonitor } from './connectivity'

// Mock the outbox so we don't pull in Dexie/Supabase
vi.mock('./outbox', () => ({
  flushOutbox: vi.fn().mockResolvedValue(undefined),
}))

import { flushOutbox } from './outbox'
const mockFlushOutbox = vi.mocked(flushOutbox)

// ---------------------------------------------------------------------------
// Reset the module-level _forcedOffline flag before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  // toggleForcedOffline is stateful — reset to false before each test
  if (isForcedOffline()) toggleForcedOffline()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// isOnline / isForcedOffline / toggleForcedOffline
// ---------------------------------------------------------------------------
describe('isForcedOffline', () => {
  it('starts as false', () => {
    expect(isForcedOffline()).toBe(false)
  })
})

describe('toggleForcedOffline', () => {
  it('sets forced-offline to true on first call', () => {
    toggleForcedOffline()
    expect(isForcedOffline()).toBe(true)
    toggleForcedOffline() // reset
  })

  it('returns the new state', () => {
    const state1 = toggleForcedOffline()
    expect(state1).toBe(true)
    const state2 = toggleForcedOffline()
    expect(state2).toBe(false)
  })

  it('flushes outbox when toggling back online', async () => {
    toggleForcedOffline()           // go offline
    await toggleForcedOffline()     // come back online → should flush
    expect(mockFlushOutbox).toHaveBeenCalledTimes(1)
  })

  it('does NOT flush outbox when going offline', () => {
    toggleForcedOffline()           // go offline
    expect(mockFlushOutbox).not.toHaveBeenCalled()
    toggleForcedOffline()           // reset
  })
})

describe('isOnline', () => {
  it('returns false when forced-offline is set (regardless of navigator.onLine)', () => {
    toggleForcedOffline()
    expect(isOnline()).toBe(false)
    toggleForcedOffline() // reset
  })

  it('reflects navigator.onLine when not forced-offline', () => {
    // jsdom sets navigator.onLine = true by default
    expect(isOnline()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// startConnectivityMonitor
// ---------------------------------------------------------------------------
describe('startConnectivityMonitor', () => {
  afterEach(() => {
    // Ensure no leftover listeners after each test
    vi.restoreAllMocks()
  })

  it('returns a cleanup function', () => {
    const cleanup = startConnectivityMonitor()
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  it('flushes outbox on startup when navigator.onLine is true', () => {
    startConnectivityMonitor()()
    expect(mockFlushOutbox).toHaveBeenCalled()
  })

  it('flushes outbox when the online event fires', () => {
    const cleanup = startConnectivityMonitor()
    mockFlushOutbox.mockClear()
    window.dispatchEvent(new Event('online'))
    expect(mockFlushOutbox).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('does NOT flush when online event fires but forced-offline is active', () => {
    toggleForcedOffline()
    const cleanup = startConnectivityMonitor()
    mockFlushOutbox.mockClear()
    window.dispatchEvent(new Event('online'))
    expect(mockFlushOutbox).not.toHaveBeenCalled()
    cleanup()
    toggleForcedOffline() // reset
  })

  it('cleanup removes the online event listener', () => {
    const cleanup = startConnectivityMonitor()
    cleanup()
    mockFlushOutbox.mockClear()
    window.dispatchEvent(new Event('online'))
    expect(mockFlushOutbox).not.toHaveBeenCalled()
  })
})
