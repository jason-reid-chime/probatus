import { describe, it, expect } from 'vitest'
import {
  buildDefaultGaugePoints,
  gaugeRange,
  gaugeSummary,
  gaugeMeasurements,
  gaugeDeviation,
  gaugePointsFromMeasurements,
  gaugePointsFromTemplate,
  gaugeAccuracyFromMeasurements,
  isPressureGaugeMeasurements,
  copyGaugeAsFoundToAsLeft,
  setGaugeReading,
  composeGaugeNotes,
  parseGaugeNotes,
  emptyGaugeConditions,
  type GaugePoint,
} from './PressureGaugeTemplate'
import { overallResult } from '../../../utils/calibrationMath'

// CALTROLS certificate 0818/3012/161: WIKA 0–100 psi gauge, ±1% FS.
// Reference readings for instrument readings 0, 20, 40, 60, 80, 100.
const RISING = ['0.00', '20.13', '40.23', '60.29', '80.36', '100.45']
const FALLING = ['0.00', '20.08', '40.19', '60.24', '80.31', '100.45']
const RANGE = gaugeRange({ range_min: 0, range_max: 100, range_unit: 'psi' })

function certificatePoints(asFound = true): GaugePoint[] {
  return buildDefaultGaugePoints(RANGE).map((p, i) => ({
    ...p,
    rising: { asFound: asFound ? RISING[i] : '', asLeft: RISING[i] },
    falling: { asFound: asFound ? FALLING[i] : '', asLeft: FALLING[i] },
  }))
}

describe('points and range', () => {
  it('builds 0/20/40/60/80/100% points from the asset range', () => {
    expect(buildDefaultGaugePoints(RANGE).map((p) => p.nominal)).toEqual([0, 20, 40, 60, 80, 100])
    const bar = gaugeRange({ range_min: 0, range_max: 7, range_unit: 'bar' })
    expect(buildDefaultGaugePoints(bar).map((p) => p.nominal)).toEqual([0, 1.4, 2.8, 4.2, 5.6, 7])
  })

  it('falls back to 0–100 psi when the asset has no usable range', () => {
    expect(gaugeRange({})).toEqual({ min: 0, max: 100, unit: 'psi' })
    expect(gaugeRange({ range_min: 5, range_max: 5 })).toEqual({ min: 0, max: 100, unit: 'psi' })
    expect(gaugeRange(null)).toEqual({ min: 0, max: 100, unit: 'psi' })
  })

  it('reads template points as % of range when unit is "%", else absolute', () => {
    const range = gaugeRange({ range_min: 0, range_max: 160, range_unit: 'psi' })
    const pct = gaugePointsFromTemplate({
      points: [0, 50, 100].map((v) => ({ label: `${v}%`, standard_value: v, unit: '%' })),
    }, range)
    expect(pct.map((p) => p.nominal)).toEqual([0, 80, 160])
    const abs = gaugePointsFromTemplate({
      points: [{ label: '40', standard_value: 40, unit: 'psi' }],
    }, range)
    expect(abs[0]).toMatchObject({ nominal: 40, pct: 25 })
  })
})

describe('certificate numbers', () => {
  it('deviation is reference − instrument', () => {
    expect(gaugeDeviation(20, '20.13')).toBeCloseTo(0.13, 9)
    expect(gaugeDeviation(80, '80.31')).toBeCloseTo(0.31, 9)
    expect(gaugeDeviation(100, '100.45')).toBeCloseTo(0.45, 9)
    expect(gaugeDeviation(40, '39.9')).toBeCloseTo(-0.1, 9)
    expect(gaugeDeviation(40, '')).toBeNull()
  })

  it('max error is ±0.45 % FS and passes at ±1% FS', () => {
    const s = gaugeSummary(certificatePoints(), RANGE, 1)
    expect(s.maxErrorLeft).toBeCloseTo(0.45, 9)
    expect(s.maxErrorFound).toBeCloseTo(0.45, 9)
    expect(s.resultLeft).toBe('PASS')
    expect(s.resultFound).toBe('PASS')
  })

  it('fails when the accuracy class is tighter than the max error', () => {
    const s = gaugeSummary(certificatePoints(), RANGE, 0.25)
    expect(s.resultLeft).toBe('FAIL')
  })

  it('fails when one reading is out by more than 1% FS', () => {
    let pts = certificatePoints()
    pts = setGaugeReading(pts, 3, 'falling', 'asLeft', '61.2') // 1.2% FS
    const s = gaugeSummary(pts, RANGE, 1)
    expect(s.maxErrorLeft).toBeCloseTo(1.2, 9)
    expect(s.resultLeft).toBe('FAIL')
    expect(overallResult(gaugeMeasurements('r', pts, RANGE, 1))).toBe('FAIL')
  })

  it('treats a deviation of exactly the class as a pass', () => {
    const pts = setGaugeReading(certificatePoints(), 5, 'rising', 'asLeft', '101')
    expect(gaugeSummary(pts, RANGE, 1).resultLeft).toBe('PASS')
  })

  it('is INCOMPLETE until every rising and falling reading is entered', () => {
    const pts = setGaugeReading(certificatePoints(), 0, 'falling', 'asLeft', '')
    expect(gaugeSummary(pts, RANGE, 1).resultLeft).toBe('INCOMPLETE')
    expect(overallResult(gaugeMeasurements('r', pts, RANGE, 1))).toBe('INCOMPLETE')
    expect(gaugeSummary(certificatePoints(false), RANGE, 1).resultFound).toBe('INCOMPLETE')
  })
})

describe('gaugeMeasurements', () => {
  it('emits 12 rows: rising 0→100 then falling 100→0, with arrows in labels', () => {
    const ms = gaugeMeasurements('rec', certificatePoints(), RANGE, 1)
    expect(ms.map((m) => m.point_label)).toEqual([
      '0 psi ↑', '20 psi ↑', '40 psi ↑', '60 psi ↑', '80 psi ↑', '100 psi ↑',
      '100 psi ↓', '80 psi ↓', '60 psi ↓', '40 psi ↓', '20 psi ↓', '0 psi ↓',
    ])
    expect(new Set(ms.map((m) => m.point_label)).size).toBe(12)
    const r20 = ms[1]
    expect(r20).toMatchObject({
      record_id: 'rec',
      standard_value: 20,
      as_found_value: 20.13,
      measured_value: 20.13,
      unit: 'psi',
      pass: true,
    })
    expect(r20.error_pct).toBeCloseTo(0.13, 9)
    expect(r20.notes).toBe('Rising; Acc ±1% FS; As Found PASS')
    expect(ms[6].notes).toMatch(/^Falling;/)
    expect(overallResult(ms)).toBe('PASS')
  })

  it('records As Found FAIL in notes while As Left passes', () => {
    const pts = setGaugeReading(certificatePoints(), 2, 'rising', 'asFound', '42')
    const row = gaugeMeasurements('r', pts, RANGE, 1).find((m) => m.point_label === '40 psi ↑')!
    expect(row.notes).toContain('As Found FAIL')
    expect(row.pass).toBe(true)
  })

  it('round-trips through saved measurements', () => {
    const pts = certificatePoints()
    const ms = gaugeMeasurements('r', pts, RANGE, 0.5)
    // Saved rows come back in arbitrary order.
    const back = gaugePointsFromMeasurements([...ms].reverse(), RANGE)
    expect(back).toEqual(pts.map((p) => ({
      ...p,
      rising: { asFound: String(parseFloat(p.rising.asFound)), asLeft: String(parseFloat(p.rising.asLeft)) },
      falling: { asFound: String(parseFloat(p.falling.asFound)), asLeft: String(parseFloat(p.falling.asLeft)) },
    })))
    expect(gaugeAccuracyFromMeasurements(ms)).toBe('0.5')
  })
})

describe('legacy detection', () => {
  it('distinguishes old 5-point pressure rows from gauge rows', () => {
    expect(isPressureGaugeMeasurements([{ point_label: '0%' }, { point_label: '25%' }])).toBe(false)
    expect(isPressureGaugeMeasurements([{ point_label: '20 psi ↑' }])).toBe(true)
    expect(isPressureGaugeMeasurements([])).toBe(false)
  })
})

describe('copy As Found → As Left', () => {
  const pts = certificatePoints().map((p) => ({
    ...p,
    rising: { ...p.rising, asLeft: '' },
    falling: { ...p.falling, asLeft: '' },
  }))

  it('copies every reading', () => {
    const out = copyGaugeAsFoundToAsLeft(pts)
    expect(out.map((p) => p.rising.asLeft)).toEqual(RISING)
    expect(out.map((p) => p.falling.asLeft)).toEqual(FALLING)
    expect(gaugeSummary(out, RANGE, 1).resultLeft).toBe('PASS')
  })

  it('copies one reading only', () => {
    const out = copyGaugeAsFoundToAsLeft(pts, 1, 'falling')
    expect(out[1].falling.asLeft).toBe('20.08')
    expect(out[1].rising.asLeft).toBe('')
    expect(out[2].falling.asLeft).toBe('')
  })
})

describe('notes header', () => {
  it('round-trips conditions and free notes', () => {
    const c = {
      ...emptyGaugeConditions(),
      temperature: '20',
      humidity: '50',
      connection: '½" MNPT',
      dialSize: '6"',
    }
    const notes = composeGaugeNotes(c, 'Glycerin filled')
    expect(notes.split('\n')[0]).toBe(
      '[Pressure Gauge] Accuracy (% FS): 1 | Temp (°C): 20 | Humidity (%RH): 50 | Connection: ½" MNPT | Dial: 6"',
    )
    const parsed = parseGaugeNotes(notes)
    expect(parsed.conditions).toEqual(c)
    expect(parsed.freeNotes).toBe('Glycerin filled')
    expect(parsed.tagged).toBe(true)
  })

  it('leaves untagged notes alone', () => {
    const parsed = parseGaugeNotes('plain note')
    expect(parsed.freeNotes).toBe('plain note')
    expect(parsed.conditions).toEqual(emptyGaugeConditions())
  })
})
