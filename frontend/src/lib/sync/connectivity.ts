import { flushOutbox } from './outbox'

// Simulated offline override for testing — does not affect real network
let _forcedOffline = false

export function isOnline(): boolean {
  return !_forcedOffline && navigator.onLine
}

export function toggleForcedOffline(): boolean {
  _forcedOffline = !_forcedOffline
  if (!_forcedOffline) {
    // Coming back "online" — flush outbox
    flushOutbox().catch(console.error)
  }
  return _forcedOffline
}

export function isForcedOffline(): boolean {
  return _forcedOffline
}

/**
 * Registers online/offline listeners.
 * Automatically flushes the outbox when connectivity returns.
 */
export function startConnectivityMonitor(): () => void {
  const handleOnline = () => {
    if (!_forcedOffline) {
      console.info('[sync] online — flushing outbox')
      flushOutbox().catch(console.error)
    }
  }

  window.addEventListener('online', handleOnline)

  if (navigator.onLine) {
    flushOutbox().catch(console.error)
  }

  return () => window.removeEventListener('online', handleOnline)
}
