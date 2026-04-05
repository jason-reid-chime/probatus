import { describe, it, expect } from 'vitest'
import { buildDefaultPressureRows } from './PressureTemplate'
import { buildDefaultTemperatureRows } from './TemperatureTemplate'
import { buildDefaultLevelRows } from './LevelTemplate'
import { buildDefaultSwitchData } from './SwitchTemplate'
import { buildDefaultConductivityData } from './ConductivityTemplate'
import { buildDefaultTransmitterRows } from './TransmitterTemplate'
import type { LocalAsset } from '../../../lib/db'

// ---------------------------------------------------------------------------
// Shared test fixture
// ---------------------------------------------------------------------------
function makeAsset(overrides: Partial<LocalAsset> = {}): LocalAsset {
  return {
    id: 'asset-1',
    tenant_id: 'tenant-1',
    tag_id: 'TT-001',
    instrument_type: 'pressure',
    range_min: 0,
    range_max: 100,
    range_unit: 'psi',
    calibration_interval_days: 365,
    ...overrides,
  } as LocalAsset
}

// ---------------------------------------------------------------------------
// buildDefaultPressureRows
// ---------------------------------------------------------------------------
describe('buildDefaultPressureRows', () => {
  it('returns 5 rows at 0/25/50/75/100%', () => {
    const rows = buildDefaultPressureRows(makeAsset())
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.pct)).toEqual([0, 25, 50, 75, 100])
  })

  it('computes standard values from asset range', () => {
    const rows = buildDefaultPressureRows(makeAsset({ range_min: 0, range_max: 200 }))
    expect(rows[0].standardValue).toBe(0)    // 0%
    expect(rows[2].standardValue).toBe(100)  // 50%
    expect(rows[4].standardValue).toBe(200)  // 100%
  })

  it('handles a non-zero range_min', () => {
    const rows = buildDefaultPressureRows(makeAsset({ range_min: 10, range_max: 110 }))
    expect(rows[0].standardValue).toBe(10)   // 0% → min
    expect(rows[4].standardValue).toBe(110)  // 100% → max
    expect(rows[2].standardValue).toBe(60)   // 50% → midpoint
  })

  it('defaults range to 0–100 when asset has no range values', () => {
    const rows = buildDefaultPressureRows(makeAsset({ range_min: undefined, range_max: undefined }))
    expect(rows[0].standardValue).toBe(0)
    expect(rows[4].standardValue).toBe(100)
  })

  it('initialises asFound and asLeft as empty strings', () => {
    const rows = buildDefaultPressureRows(makeAsset())
    rows.forEach((r) => {
      expect(r.asFound).toBe('')
      expect(r.asLeft).toBe('')
    })
  })
})

// ---------------------------------------------------------------------------
// buildDefaultTemperatureRows
// ---------------------------------------------------------------------------
describe('buildDefaultTemperatureRows', () => {
  it('returns exactly 3 rows', () => {
    expect(buildDefaultTemperatureRows()).toHaveLength(3)
  })

  it('labels rows as Point 1, Point 2, Point 3', () => {
    const rows = buildDefaultTemperatureRows()
    expect(rows[0].label).toBe('Point 1')
    expect(rows[1].label).toBe('Point 2')
    expect(rows[2].label).toBe('Point 3')
  })

  it('initialises reference and measured as empty strings', () => {
    buildDefaultTemperatureRows().forEach((r) => {
      expect(r.reference).toBe('')
      expect(r.measured).toBe('')
    })
  })

  it('gives each row a unique id', () => {
    const rows = buildDefaultTemperatureRows()
    const ids = new Set(rows.map((r) => r.id))
    expect(ids.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// buildDefaultLevelRows
// ---------------------------------------------------------------------------
describe('buildDefaultLevelRows', () => {
  it('returns 5 rows at 0/25/50/75/100%', () => {
    const rows = buildDefaultLevelRows()
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.pct)).toEqual([0, 25, 50, 75, 100])
  })

  it('initialises outputMA as empty string', () => {
    buildDefaultLevelRows().forEach((r) => expect(r.outputMA).toBe(''))
  })
})

// ---------------------------------------------------------------------------
// buildDefaultSwitchData
// ---------------------------------------------------------------------------
describe('buildDefaultSwitchData', () => {
  it('has an empty setpoint and 2% tolerance', () => {
    const data = buildDefaultSwitchData()
    expect(data.setpoint).toBe('')
    expect(data.tolerancePct).toBe('2')
  })

  it('starts with all reading fields empty', () => {
    const data = buildDefaultSwitchData()
    expect(data.asFoundTrip).toBe('')
    expect(data.asFoundReset).toBe('')
    expect(data.asLeftTrip).toBe('')
    expect(data.asLeftReset).toBe('')
  })
})

// ---------------------------------------------------------------------------
// buildDefaultConductivityData
// ---------------------------------------------------------------------------
describe('buildDefaultConductivityData', () => {
  it('defaults to µS/cm unit and 2% tolerance', () => {
    const data = buildDefaultConductivityData()
    expect(data.unit).toBe('µS/cm')
    expect(data.tolerancePct).toBe('2')
  })

  it('pre-fills two standard solutions (84.0 and 1413)', () => {
    const data = buildDefaultConductivityData()
    expect(data.standards).toHaveLength(2)
    expect(data.standards[0].nominal).toBe('84.0')
    expect(data.standards[1].nominal).toBe('1413')
  })

  it('initialises readings as empty strings', () => {
    const data = buildDefaultConductivityData()
    data.standards.forEach((s) => expect(s.reading).toBe(''))
  })

  it('initialises temperature as empty string', () => {
    expect(buildDefaultConductivityData().temperature).toBe('')
  })
})

// ---------------------------------------------------------------------------
// buildDefaultTransmitterRows
// ---------------------------------------------------------------------------
describe('buildDefaultTransmitterRows', () => {
  it('returns 5 rows at 0/25/50/75/100%', () => {
    const rows = buildDefaultTransmitterRows(makeAsset())
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => r.pct)).toEqual([0, 25, 50, 75, 100])
  })

  it('computes applied values from asset range', () => {
    const rows = buildDefaultTransmitterRows(makeAsset({ range_min: 0, range_max: 100 }))
    expect(rows[0].appliedValue).toBe(0)
    expect(rows[2].appliedValue).toBe(50)
    expect(rows[4].appliedValue).toBe(100)
  })

  it('handles non-zero range_min in applied values', () => {
    const rows = buildDefaultTransmitterRows(makeAsset({ range_min: 20, range_max: 120 }))
    expect(rows[0].appliedValue).toBe(20)   // 0%
    expect(rows[4].appliedValue).toBe(120)  // 100%
  })

  it('initialises all reading fields as empty strings', () => {
    const rows = buildDefaultTransmitterRows(makeAsset())
    rows.forEach((r) => {
      expect(r.pvAsFound).toBe('')
      expect(r.pvAsLeft).toBe('')
      expect(r.maAsFound).toBe('')
      expect(r.maAsLeft).toBe('')
    })
  })
})
