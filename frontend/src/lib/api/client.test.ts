import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }))
vi.mock('@sentry/react', () => ({ withScope: vi.fn(), captureException: vi.fn() }))

import { ApiError } from './client'

describe('ApiError', () => {
  it('says what failed, why, and gives a reference', () => {
    const err = new ApiError('POST', '/calibrations', 500,
      '{"error":"failed to create calibration record","detail":"calibrations.Create: insert failed: boom","request_id":"abc/123"}')
    expect(err.message).toBe(
      'failed to create calibration record — calibrations.Create: insert failed: boom (server error 500, ref abc/123)')
    expect(err.status).toBe(500)
    expect(err.requestId).toBe('abc/123')
  })

  it('falls back to the raw body when it is not JSON', () => {
    const err = new ApiError('GET', '/x', 502, 'Bad Gateway')
    expect(err.message).toBe('Bad Gateway (server error 502)')
    expect(err.body).toBeNull()
  })

  it('keeps 4xx messages from the server', () => {
    const err = new ApiError('POST', '/calibrations', 422,
      '{"error":"the asset for this calibration does not exist on the server — sync or re-create the asset first"}')
    expect(err.message).toMatch(/^the asset for this calibration does not exist.*\(error 422\)$/)
  })
})
