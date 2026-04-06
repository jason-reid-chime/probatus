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
  const [isEmpty, setIsEmpty] = useState(!value)

  // Restore saved signature on mount only — intentionally omitting `value`
  // from deps so drawing doesn't reset on every parent re-render.
  useEffect(() => {
    if (!value || !canvasRef.current) return
    const img = new Image()
    img.onload = () => canvasRef.current?.getContext('2d')?.drawImage(img, 0, 0)
    img.src = value
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    drawing.current = true
    const { x, y } = getPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = getPos(e)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1e293b'
    ctx.lineTo(x, y)
    ctx.stroke()
    setIsEmpty(false)
  }

  function endDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!drawing.current) return
    drawing.current = false
    const dataUrl = canvasRef.current?.toDataURL('image/png') ?? ''
    onChange(dataUrl)
  }

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
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
      </div>
      {isEmpty && (
        <p className="text-xs text-gray-400 italic">Sign above</p>
      )}
    </div>
  )
}
