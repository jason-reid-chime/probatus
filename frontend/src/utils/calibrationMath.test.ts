import { describe, it, expect } from 'vitest'
import {
  calcErrorPct,
  calc4_20mAErrorPct,
  isPass,
  overallResult,
} from './calibrationMath'
import type { LocalMeasurement } from '../lib/db'

// ---------------------------------------------------------------------------
// calcErrorPct
// ---------------------------------------------------------------------------
describe('calcErrorPct', () => {
  it('returns correct positive error', () => {
    expect(calcErrorPct(100, 102)).toBeCloseTo(2)
  })

  it('returns correct negative error', () => {
    expect(calcErrorPct(100, 98)).toBeCloseTo(-2)
  })

  it('returns 0 when measured equals standard', () => {
    expect(calcErrorPct(50, 50)).toBe(0)
  })

  it('returns NaN when standard is 0 (division by zero guard)', () => {
    expect(calcErrorPct(0, 10)).toBeNaN()
  })

  it('handles fractional standard values', () => {
    expect(calcErrorPct(4, 4.08)).toBeCloseTo(2)
  })
})

// ---------------------------------------------------------------------------
// calc4_20mAErrorPct
// ---------------------------------------------------------------------------
describe('calc4_20mAErrorPct', () => {
  it('returns 0 at 0% with 4 mA output', () => {
    expect(calc4_20mAErrorPct(0, 4)).toBeCloseTo(0)
  })

  it('returns 0 at 100% with 20 mA output', () => {
    expect(calc4_20mAErrorPct(100, 20)).toBeCloseTo(0)
  })

  it('returns 0 at 50% with 12 mA output', () => {
    expect(calc4_20mAErrorPct(50, 12)).toBeCloseTo(0)
  })

  it('returns positive error when output is high', () => {
    // expected = 12 mA, actual = 12.16 mA → error = (0.16/16)*100 = 1%
    expect(calc4_20mAErrorPct(50, 12.16)).toBeCloseTo(1)
  })

  it('returns negative error when output is low', () => {
    expect(calc4_20mAErrorPct(50, 11.84)).toBeCloseTo(-1)
  })

  it('uses the 16 mA span (not full 20 mA range) as the denominator', () => {
    // At 25%: expected = 4 + 0.25*16 = 8 mA; +1 mA = (1/16)*100 = 6.25%
    expect(calc4_20mAErrorPct(25, 9)).toBeCloseTo(6.25)
  })
})

// ---------------------------------------------------------------------------
// isPass
// ---------------------------------------------------------------------------
describe('isPass', () => {
  it('passes when error is exactly 0', () => {
    expect(isPass(0)).toBe(true)
  })

  it('passes when error is within default tolerance (1.0%)', () => {
    expect(isPass(0.99)).toBe(true)
    expect(isPass(-0.99)).toBe(true)
  })

  it('passes at exactly the tolerance boundary', () => {
    expect(isPass(1.0)).toBe(true)
    expect(isPass(-1.0)).toBe(true)
  })

  it('fails when error exceeds default tolerance', () => {
    expect(isPass(1.01)).toBe(false)
    expect(isPass(-1.01)).toBe(false)
  })

  it('respects a custom tolerance', () => {
    expect(isPass(1.5, 2)).toBe(true)
    expect(isPass(2.1, 2)).toBe(false)
  })

  it('fails for NaN (non-finite) error', () => {
    expect(isPass(NaN)).toBe(false)
  })

  it('fails for Infinity error', () => {
    expect(isPass(Infinity)).toBe(false)
    expect(isPass(-Infinity)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// overallResult
// ---------------------------------------------------------------------------

function measurement(overrides: Partial<LocalMeasurement> = {}): LocalMeasurement {
  return {
    id: 'test-id',
    record_id: 'rec-id',
    point_label: '50%',
    standard_value: 50,
    measured_value: 50,
    error_pct: 0,
    pass: true,
    ...overrides,
  }
}

describe('overallResult', () => {
  it('returns INCOMPLETE for an empty measurement array', () => {
    expect(overallResult([])).toBe('INCOMPLETE')
  })

  it('returns PASS when all measurements pass', () => {
    const ms = [
      measurement({ error_pct: 0, pass: true }),
      measurement({ error_pct: 0.5, pass: true }),
    ]
    expect(overallResult(ms)).toBe('PASS')
  })

  it('returns FAIL when any measurement fails', () => {
    const ms = [
      measurement({ error_pct: 0, pass: true }),
      measurement({ error_pct: 5, pass: false }),
    ]
    expect(overallResult(ms)).toBe('FAIL')
  })

  it('returns INCOMPLETE when error_pct is undefined', () => {
    const ms = [measurement({ error_pct: undefined, pass: undefined })]
    expect(overallResult(ms)).toBe('INCOMPLETE')
  })

  it('returns INCOMPLETE when error_pct is null', () => {
    const ms = [measurement({ error_pct: null as unknown as number, pass: null as unknown as boolean })]
    expect(overallResult(ms)).toBe('INCOMPLETE')
  })

  it('returns INCOMPLETE when error_pct is non-finite', () => {
    const ms = [measurement({ error_pct: NaN, pass: true })]
    expect(overallResult(ms)).toBe('INCOMPLETE')
  })

  it('returns INCOMPLETE when pass is undefined even if error_pct is set', () => {
    const ms = [measurement({ error_pct: 0, pass: undefined })]
    expect(overallResult(ms)).toBe('INCOMPLETE')
  })

  it('FAIL takes priority — any single failing measurement fails all', () => {
    const ms = [
      measurement({ error_pct: 0, pass: true }),
      measurement({ error_pct: 0, pass: true }),
      measurement({ error_pct: 2, pass: false }),
    ]
    expect(overallResult(ms)).toBe('FAIL')
  })

  it('returns INCOMPLETE (not FAIL) when one measurement is incomplete', () => {
    const ms = [
      measurement({ error_pct: 0, pass: true }),
      measurement({ error_pct: undefined, pass: undefined }),
    ]
    expect(overallResult(ms)).toBe('INCOMPLETE')
  })
})
