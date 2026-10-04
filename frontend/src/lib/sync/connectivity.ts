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

/** How often pending entries are retried while the device reports online. */
export const PERIODIC_FLUSH_MS = 30_000

/**
 * Registers online/offline listeners.
 * Automatically flushes the outbox when connectivity returns, and retries
 * periodically while online — the `online` event never fires when the device
 * stays connected but the API was down, so without this, entries sit pending
 * until a reload.
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

  const interval = setInterval(() => {
    if (isOnline()) flushOutbox().catch(console.error)
  }, PERIODIC_FLUSH_MS)

  return () => {
    window.removeEventListener('online', handleOnline)
    clearInterval(interval)
  }
}
