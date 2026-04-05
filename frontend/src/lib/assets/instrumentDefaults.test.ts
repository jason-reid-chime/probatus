import { describe, it, expect } from 'vitest'
import { INSTRUMENT_DEFAULTS, INSTRUMENT_TYPE_VALUES, type InstrumentType } from './instrumentDefaults'

describe('INSTRUMENT_DEFAULTS', () => {
  it('has an entry for every instrument type value', () => {
    INSTRUMENT_TYPE_VALUES.forEach((type) => {
      expect(INSTRUMENT_DEFAULTS[type]).toBeDefined()
    })
  })

  it('every entry has unit, min, and max', () => {
    INSTRUMENT_TYPE_VALUES.forEach((type) => {
      const d = INSTRUMENT_DEFAULTS[type]
      expect(typeof d.unit).toBe('string')
      expect(typeof d.min).toBe('number')
      expect(typeof d.max).toBe('number')
    })
  })

  it('max is always greater than min', () => {
    INSTRUMENT_TYPE_VALUES.forEach((type) => {
      const { min, max } = INSTRUMENT_DEFAULTS[type]
      expect(max).toBeGreaterThan(min)
    })
  })

  // Spot-check a few expected values
  it('pressure defaults to psi, 0–100', () => {
    expect(INSTRUMENT_DEFAULTS.pressure).toEqual({ unit: 'psi', min: 0, max: 100 })
  })

  it('temperature defaults to °C, 0–150', () => {
    expect(INSTRUMENT_DEFAULTS.temperature).toEqual({ unit: '°C', min: 0, max: 150 })
  })

  it('ph_conductivity defaults to pH, 0–14', () => {
    expect(INSTRUMENT_DEFAULTS.ph_conductivity).toEqual({ unit: 'pH', min: 0, max: 14 })
  })

  it('level_4_20ma defaults to mA, 4–20', () => {
    expect(INSTRUMENT_DEFAULTS.level_4_20ma).toEqual({ unit: 'mA', min: 4, max: 20 })
  })

  it('flow shares the same defaults as level_4_20ma', () => {
    expect(INSTRUMENT_DEFAULTS.flow).toEqual(INSTRUMENT_DEFAULTS.level_4_20ma)
  })

  it('transmitter_4_20ma shares the same defaults as level_4_20ma', () => {
    expect(INSTRUMENT_DEFAULTS.transmitter_4_20ma).toEqual(INSTRUMENT_DEFAULTS.level_4_20ma)
  })

  it('other has an empty unit string', () => {
    expect(INSTRUMENT_DEFAULTS.other.unit).toBe('')
  })

  it('INSTRUMENT_TYPE_VALUES contains exactly 10 types', () => {
    expect(INSTRUMENT_TYPE_VALUES).toHaveLength(10)
  })

  // Type guard — ensures the type export works correctly at runtime
  it('a valid instrument type string is a member of INSTRUMENT_TYPE_VALUES', () => {
    const type: InstrumentType = 'pressure'
    expect(INSTRUMENT_TYPE_VALUES).toContain(type)
  })
})
