import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from './ErrorBoundary'

// Component that throws on demand
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('test explosion')
  return <div>All good</div>
}

// Suppress React's console.error noise during error boundary tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('renders the fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('shows error message in dev mode (import.meta.env.DEV is true in tests)', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    )
    // The pre element with the error message is rendered in dev mode
    expect(screen.getByText('test explosion')).toBeInTheDocument()
  })

  it('resets the error state when "Try again" is clicked', () => {
    // Use a mutable flag so the child stops throwing after reset
    let shouldThrow = true
    function Toggle() {
      if (shouldThrow) throw new Error('test explosion')
      return <div>Recovered</div>
    }

    render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(screen.getByText('Recovered')).toBeInTheDocument()
  })

  it('renders a custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={(err, reset) => (
        <div>
          <span>Custom: {err.message}</span>
          <button onClick={reset}>Reset</button>
        </div>
      )}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Custom: test explosion')).toBeInTheDocument()
  })
})
