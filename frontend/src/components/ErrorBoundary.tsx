import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Optional fallback rendered instead of the default error UI. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches unhandled render errors anywhere in the component tree and shows a
 * recovery UI instead of a blank screen.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <YourComponent />
 *   </ErrorBoundary>
 *
 * To report to an error-tracking service (e.g. Sentry) add the call inside
 * componentDidCatch:
 *   Sentry.captureException(error, { extra: { componentStack } })
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Replace this console.error with Sentry.captureException when ready
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    const { children, fallback } = this.props

    if (error) {
      if (fallback) return fallback(error, this.reset)

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h1 className="text-xl font-bold text-gray-900">Something went wrong</h1>
            <p className="text-sm text-gray-500">
              An unexpected error occurred. Try refreshing the page — your data is safe.
            </p>
            {import.meta.env.DEV && (
              <pre className="text-left text-xs bg-gray-100 rounded-lg p-3 overflow-auto max-h-40 text-red-700">
                {error.message}
              </pre>
            )}
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors"
            >
              <RefreshCw size={16} />
              Try again
            </button>
          </div>
        </div>
      )
    }

    return children
  }
}
