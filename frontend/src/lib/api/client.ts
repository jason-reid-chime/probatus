import * as Sentry from '@sentry/react'
import { supabase } from '../supabase'

// Central API URL — falls back to localhost for local dev if env var is missing.
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8080'

export async function apiRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ''
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    const err = new ApiError(method, path, res.status, text)
    reportApiError(err)
    throw err
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/**
 * A failed API call. `message` is written for the user: what failed, the
 * underlying cause the server reported, and a reference id that matches the
 * Sentry event and server log line.
 */
export class ApiError extends Error {
  readonly status: number
  readonly method: string
  readonly path: string
  /** Parsed JSON error body, or null when the body wasn't JSON. */
  readonly body: Record<string, unknown> | null
  readonly requestId?: string

  constructor(method: string, path: string, status: number, text: string) {
    let body: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
    } catch { /* not JSON */ }
    super(describeApiFailure(status, body, text))
    this.name = 'ApiError'
    this.status = status
    this.method = method
    this.path = path
    this.body = body
    this.requestId = typeof body?.request_id === 'string' ? body.request_id : undefined
  }
}

/** Human-readable text for a failed API response. */
export function describeApiFailure(status: number, body: Record<string, unknown> | null, text: string): string {
  const what = typeof body?.error === 'string' ? body.error : (text.trim() || `request failed`)
  const detail = typeof body?.detail === 'string' ? body.detail : ''
  const ref = typeof body?.request_id === 'string' ? `, ref ${body.request_id}` : ''
  const cause = detail ? ` — ${detail}` : ''
  const kind = status >= 500 ? 'server error' : 'error'
  return `${what}${cause} (${kind} ${status}${ref})`
}

/** Sends a failed call to Sentry. 404s are skipped: callers use them to probe existence. */
export function reportApiError(err: ApiError): void {
  if (err.status === 404) return
  Sentry.withScope((scope) => {
    scope.setTag('api.status', String(err.status))
    scope.setTag('api.path', `${err.method} ${err.path}`)
    if (err.requestId) scope.setTag('request_id', err.requestId)
    scope.setLevel(err.status >= 500 ? 'error' : 'warning')
    Sentry.captureException(err)
  })
}
