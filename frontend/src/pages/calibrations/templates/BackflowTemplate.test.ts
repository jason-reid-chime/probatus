import { describe, it, expect } from 'vitest'
import {
  buildDefaultBackflowRows,
  backflowRowsFromTemplate,
  backflowRowsFromMeasurements,
  backflowMeasurements,
  backflowPointPass,
  composeBackflowNotes,
  parseBackflowNotes,
} from './BackflowTemplate'
import { overallResult } from '../../../utils/calibrationMath'

// Readings from CalTec certificate C26-02033 (Zurn TG-5, CP.13).
const AS_FOUND = ['12.7', '11.1', '9.4', '7.5', '5.5', '3.5', '1.5', '0.0']
const AS_LEFT = ['13.8', '12.0', '10.0', '8.1', '6.1', '4.1', '2.1', '0.0']

function filledRows() {
  return buildDefaultBackflowRows().map((r, i) => ({ ...r, asFound: AS_FOUND[i], asLeft: AS_LEFT[i] }))
}

describe('buildDefaultBackflowRows', () => {
  it('is descending 14 → 0 PSID with ±0.2 (0 at zero)', () => {
    const rows = buildDefaultBackflowRows()
    expect(rows.map((r) => r.nominal)).toEqual([14, 12, 10, 8, 6, 4, 2, 0])
    expect(rows.map((r) => r.tolerance)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0])
    expect(rows[0].label).toBe('14.0 PSID')
    expect(rows[7].label).toBe('0 PSID')
  })
})

describe('backflowPointPass', () => {
  it('treats the ±0.2 limits as inclusive despite float noise', () => {
    expect(backflowPointPass(14, 13.8, 0.2)).toBe(true)
    expect(backflowPointPass(2, 2.2, 0.2)).toBe(true)
    expect(backflowPointPass(8, 8.2, 0.2)).toBe(true)
    expect(backflowPointPass(2, 1.8, 0.2)).toBe(true)
    expect(backflowPointPass(14, 13.7, 0.2)).toBe(false)
    expect(backflowPointPass(2, 2.3, 0.2)).toBe(false)
  })

  it('requires an exact 0 at the 0 PSID point', () => {
    expect(backflowPointPass(0, 0, 0)).toBe(true)
    expect(backflowPointPass(0, 0.1, 0)).toBe(false)
  })
})

describe('backflowMeasurements (certificate C26-02033)', () => {
  const ms = backflowMeasurements('rec-1', filledRows(), 15)

  it('matches the certificate As Left PASS on every point', () => {
    expect(ms.map((m) => m.pass)).toEqual(Array(8).fill(true))
    expect(overallResult(ms)).toBe('PASS')
  })

  it('records As Found FAIL on every point except 0', () => {
    const af = ms.map((m) => m.notes?.match(/As Found (PASS|FAIL)/)?.[1])
    expect(af).toEqual(['FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'FAIL', 'PASS'])
  })

  it('maps nominal → standard_value, readings → as_found/measured, unit PSID', () => {
    expect(ms[0]).toMatchObject({
      point_label: '14.0 PSID',
      standard_value: 14,
      as_found_value: 12.7,
      measured_value: 13.8,
      unit: 'PSID',
    })
    expect(ms[0].error_pct).toBeCloseTo((0.2 / 15) * 100, 6)
  })

  it('fails overall when an As Left reading is out of tolerance', () => {
    const rows = filledRows()
    rows[3] = { ...rows[3], asLeft: '8.3' }
    expect(overallResult(backflowMeasurements('rec-1', rows, 15))).toBe('FAIL')
  })

  it('is INCOMPLETE until every As Left is entered', () => {
    expect(overallResult(backflowMeasurements('rec-1', buildDefaultBackflowRows(), 15))).toBe('INCOMPLETE')
  })

  it('round-trips through saved measurements', () => {
    const rows = backflowRowsFromMeasurements([...ms].reverse())
    const num = (rs: ReturnType<typeof filledRows>) =>
      rs.map((r) => [r.label, r.nominal, r.tolerance, parseFloat(r.asFound), parseFloat(r.asLeft)])
    expect(num(rows)).toEqual(num(filledRows()))
  })
})

describe('backflowRowsFromTemplate', () => {
  it('uses tolerance_abs from template points', () => {
    const rows = backflowRowsFromTemplate([
      { label: '10.0 PSID', standard_value: 10, unit: 'PSID', tolerance_abs: 0.5 },
      { label: '0 PSID', standard_value: 0, unit: 'PSID' },
    ])
    expect(rows.map((r) => [r.nominal, r.tolerance])).toEqual([[10, 0.5], [0, 0]])
  })
})

describe('backflow notes header', () => {
  it('round-trips PO, room conditions and UUT condition', () => {
    const conditions = {
      poNumber: '009591',
      roomTemp: '22',
      humidity: '50',
      uutCondition: 'Readings out of tolerance.',
    }
    const notes = composeBackflowNotes(conditions, 'Replaced clear hose.\nCleaned chamber.')
    expect(notes.split('\n')[0]).toBe(
      '[Backflow] PO: 009591 | Room temp (°C): 22 | Humidity (%RH): 50 | UUT condition as found: Readings out of tolerance.',
    )
    expect(parseBackflowNotes(notes)).toEqual({
      conditions,
      freeNotes: 'Replaced clear hose.\nCleaned chamber.',
    })
  })

  it('leaves untagged notes alone', () => {
    expect(parseBackflowNotes('plain').freeNotes).toBe('plain')
    expect(composeBackflowNotes({ poNumber: '', roomTemp: '', humidity: '', uutCondition: '' }, 'x')).toBe('x')
  })
})
