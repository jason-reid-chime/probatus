import { useRef, useEffect, useState } from 'react'
import { Eraser } from 'lucide-react'

interface SignaturePadProps {
  value?: string        // base64 data URL
  onChange: (dataUrl: string) => void
  label?: string
}

export default function SignaturePad({ value, onChange, label = 'Signature' }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const onChangeRef = useRef(onChange)
  const [isEmpty, setIsEmpty] = useState(!value)

  // Keep onChangeRef current without re-running the touch-listener effect.
  useEffect(() => { onChangeRef.current = onChange })

  // Restore saved signature on mount only — intentionally omitting `value`
  // from deps so drawing doesn't reset on every parent re-render.
  useEffect(() => {
    if (!value || !canvasRef.current) return
    const img = new Image()
    img.onload = () => canvasRef.current?.getContext('2d')?.drawImage(img, 0, 0)
    img.src = value
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function canvasPos(clientX: number, clientY: number) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top)  * (canvas.height / rect.height),
    }
  }

  // Mouse handlers (React synthetic events — no passive conflict).
  function onMouseDown(e: React.MouseEvent) {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    drawing.current = true
    const { x, y } = canvasPos(e.clientX, e.clientY)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = canvasPos(e.clientX, e.clientY)
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1e293b'
    ctx.lineTo(x, y)
    ctx.stroke()
    setIsEmpty(false)
  }

  function onMouseUp() {
    if (!drawing.current) return
    drawing.current = false
    onChangeRef.current(canvasRef.current?.toDataURL('image/png') ?? '')
  }

  // Touch handlers must be attached manually with { passive: false } so that
  // preventDefault() works — React always registers onTouchX as passive.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function onTouchStart(e: TouchEvent) {
      e.preventDefault()
      const ctx = canvas!.getContext('2d')
      if (!ctx) return
      drawing.current = true
      const { x, y } = canvasPos(e.touches[0].clientX, e.touches[0].clientY)
      ctx.beginPath()
      ctx.moveTo(x, y)
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault()
      if (!drawing.current) return
      const ctx = canvas!.getContext('2d')
      if (!ctx) return
      const { x, y } = canvasPos(e.touches[0].clientX, e.touches[0].clientY)
      ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1e293b'
      ctx.lineTo(x, y)
      ctx.stroke()
      setIsEmpty(false)
    }

    function onTouchEnd(e: TouchEvent) {
      e.preventDefault()
      if (!drawing.current) return
      drawing.current = false
      onChangeRef.current(canvas!.toDataURL('image/png'))
    }

    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false })
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: false })

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove',  onTouchMove)
      canvas.removeEventListener('touchend',   onTouchEnd)
    }
  }, [])

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setIsEmpty(true)
    onChange('')
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">{label}</label>
        {!isEmpty && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            <Eraser size={12} /> Clear
          </button>
        )}
      </div>
      <div className="border-2 border-gray-300 rounded-xl overflow-hidden bg-white touch-none">
        <canvas
          ref={canvasRef}
          width={600}
          height={150}
          className="w-full h-[120px] cursor-crosshair"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
      </div>
      {isEmpty && (
        <p className="text-xs text-gray-400 italic">Sign above</p>
      )}
    </div>
  )
}
