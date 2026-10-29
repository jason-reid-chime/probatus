import type { LocalMeasurement } from '../lib/db'

// Readiness for submit / approve. The backend rejects both with a 422 when no
// measurements exist or a reading is blank; mirror that so the buttons can't
// be pressed into a guaranteed failure.
export function measurementsIncompleteReason(measurements: LocalMeasurement[]): string | null {
  if (measurements.length === 0) return 'No measurements recorded yet — add readings before submitting or approving.'
  const blank = measurements.filter(
    (m) => m.measured_value == null || (typeof m.measured_value === 'number' && isNaN(m.measured_value)),
  ).length
  if (blank > 0) {
    return `${blank} ${blank === 1 ? 'reading is' : 'readings are'} blank — complete all As Left readings before submitting or approving.`
  }
  return null
}

/** Download filename for the generated certificate PDF. */
export function certificateFilename(record: { id: string; certificate_number?: number | null }): string {
  return record.certificate_number != null
    ? `certificate-${record.certificate_number}.pdf`
    : `certificate-${record.id.slice(0, 8)}.pdf`
}
