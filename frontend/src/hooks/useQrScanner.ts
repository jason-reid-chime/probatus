import { useRef, useState, useCallback, useEffect } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

// ---------------------------------------------------------------------------
// useQrScanner
// Mounts an Html5Qrcode scanner on the given div ref.
// Calls onResult with the raw decoded string on a successful scan.
// ---------------------------------------------------------------------------
export function useQrScanner(onResult: (tagId: string) => void): {
  scannerRef: React.RefObject<HTMLDivElement>
  startScanner: () => void
  stopScanner: () => void
  isScanning: boolean
} {
  const scannerRef = useRef<HTMLDivElement>(null)
  const html5QrRef = useRef<Html5Qrcode | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  // Keep a stable reference to onResult so start/stop callbacks don't stale-close
  const onResultRef = useRef(onResult)
  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])

  const stopScanner = useCallback(async () => {
    if (html5QrRef.current && isScanning) {
      try {
        await html5QrRef.current.stop()
      } catch {
        // ignore — may already be stopped
      }
      html5QrRef.current.clear()
      html5QrRef.current = null
    }
    setIsScanning(false)
  }, [isScanning])

  const startScanner = useCallback(() => {
    if (!scannerRef.current) return
    if (isScanning) return

    // html5-qrcode needs a stable DOM element id
    const elementId = scannerRef.current.id || 'qr-scanner-container'
    if (!scannerRef.current.id) {
      scannerRef.current.id = elementId
    }

    const scanner = new Html5Qrcode(elementId)
    html5QrRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          onResultRef.current(decodedText)
        },
        undefined, // ignore frame-level errors
      )
      .then(() => {
        setIsScanning(true)
      })
      .catch((err) => {
        console.error('QR scanner failed to start:', err)
        html5QrRef.current = null
      })
  }, [isScanning])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => {}).finally(() => {
          html5QrRef.current?.clear()
          html5QrRef.current = null
        })
      }
    }
  }, [])

  return { scannerRef, startScanner, stopScanner, isScanning }
}
