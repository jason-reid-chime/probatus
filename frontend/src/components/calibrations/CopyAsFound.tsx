import { Copy } from 'lucide-react'

interface CopyAllAsFoundButtonProps {
  onClick: () => void
  /** Disabled when no row has an As Found reading to copy. */
  disabled?: boolean
}

/** Bulk "Copy As Found → As Left" action shown above a readings sheet. */
export function CopyAllAsFoundButton({ onClick, disabled = false }: CopyAllAsFoundButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Enter As Found readings first' : 'Use each As Found reading as the As Left reading'}
      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 border border-brand-300 text-brand-600 hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent font-semibold text-sm min-h-[44px] px-4 py-2.5 rounded-xl transition-colors"
    >
      <Copy size={16} />
      Copy As Found → As Left
    </button>
  )
}

interface CopyRowAsFoundButtonProps {
  onClick: () => void
  disabled?: boolean
}

/** Per-row icon button placed beside an As Left input. */
export function CopyRowAsFoundButton({ onClick, disabled = false }: CopyRowAsFoundButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Copy As Found to As Left"
      title="Copy As Found to As Left"
      className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-gray-400 hover:text-brand-500 hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400 rounded-lg transition-colors"
    >
      <Copy size={18} />
    </button>
  )
}
