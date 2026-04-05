import type { LocalMeasurement } from '../lib/db'

const DEFAULT_TOLERANCE = 1.0

/**
 * Standard error percentage formula.
 * Returns NaN when standard is 0 to avoid division by zero.
 */
export function calcErrorPct(standard: number, measured: number): number {
  if (standard === 0) return NaN
  return ((measured - standard) / standard) * 100
}

/**
 * 4-20 mA error percentage.
 * expected_mA = 4 + (pct / 100) * 16
 * error_pct   = ((output - expected) / 16) * 100
 */
export function calc4_20mAErrorPct(pct: number, outputMA: number): number {
  const expectedMA = 4 + (pct / 100) * 16
  return ((outputMA - expectedMA) / 16) * 100
}

/**
 * A measurement point passes when abs(errorPct) <= tolerance.
 */
export function isPass(errorPct: number, tolerance = DEFAULT_TOLERANCE): boolean {
  if (!isFinite(errorPct)) return false
  return Math.abs(errorPct) <= tolerance
}

/**
 * Aggregates all measurements into an overall PASS / FAIL / INCOMPLETE result.
 * INCOMPLETE when any measurement has no error_pct recorded.
 * FAIL when any measurement has pass === false.
 * PASS only when every measurement has pass === true.
 */
export function overallResult(
  measurements: LocalMeasurement[],
): 'PASS' | 'FAIL' | 'INCOMPLETE' {
  if (measurements.length === 0) return 'INCOMPLETE'

  for (const m of measurements) {
    if (m.error_pct === undefined || m.error_pct === null || !isFinite(m.error_pct)) {
      return 'INCOMPLETE'
    }
    if (m.pass === undefined || m.pass === null) {
      return 'INCOMPLETE'
    }
  }

  const anyFail = measurements.some((m) => m.pass === false)
  return anyFail ? 'FAIL' : 'PASS'
}
