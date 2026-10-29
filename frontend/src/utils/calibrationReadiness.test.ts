import { describe, it, expect } from 'vitest'
import { certificateFilename, measurementsIncompleteReason } from './calibrationReadiness'

const m = (measured_value: number | undefined | null) =>
  ({ id: 'x', record_id: 'r', point_label: 'p', measured_value }) as never

describe('measurementsIncompleteReason', () => {
  it('flags an empty list', () => {
    expect(measurementsIncompleteReason([])).toMatch(/no measurements/i)
  })
  it('flags blank, null and NaN readings', () => {
    expect(measurementsIncompleteReason([m(1), m(undefined)])).toMatch(/1 reading is blank/)
    expect(measurementsIncompleteReason([m(null), m(NaN)])).toMatch(/2 readings are blank/)
  })
  it('accepts a zero reading', () => {
    expect(measurementsIncompleteReason([m(0)])).toBeNull()
  })
})

describe('certificateFilename', () => {
  it('uses the certificate number when assigned', () => {
    expect(certificateFilename({ id: 'abcdef123456', certificate_number: 10001 })).toBe('certificate-10001.pdf')
  })
  it('falls back to the record id prefix', () => {
    expect(certificateFilename({ id: 'abcdef123456', certificate_number: null })).toBe('certificate-abcdef12.pdf')
    expect(certificateFilename({ id: 'abcdef123456' })).toBe('certificate-abcdef12.pdf')
  })
})
