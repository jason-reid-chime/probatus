/**
 * Default unit and range values for each instrument type.
 * Used to pre-fill AssetForm fields when the user selects a type.
 */
export const INSTRUMENT_TYPE_VALUES = [
  'pressure',
  'temperature',
  'ph_conductivity',
  'conductivity',
  'level_4_20ma',
  'flow',
  'transmitter_4_20ma',
  'pressure_switch',
  'temperature_switch',
  'other',
] as const

export type InstrumentType = (typeof INSTRUMENT_TYPE_VALUES)[number]

export interface InstrumentDefaults {
  unit: string
  min: number
  max: number
}

export const INSTRUMENT_DEFAULTS: Record<InstrumentType, InstrumentDefaults> = {
  pressure:           { unit: 'psi',   min: 0,  max: 100  },
  temperature:        { unit: '°C',    min: 0,  max: 150  },
  ph_conductivity:    { unit: 'pH',    min: 0,  max: 14   },
  conductivity:       { unit: 'µS/cm', min: 0,  max: 1000 },
  level_4_20ma:       { unit: 'mA',    min: 4,  max: 20   },
  flow:               { unit: 'mA',    min: 4,  max: 20   },
  transmitter_4_20ma: { unit: 'mA',    min: 4,  max: 20   },
  pressure_switch:    { unit: 'psi',   min: 0,  max: 100  },
  temperature_switch: { unit: '°C',    min: 0,  max: 150  },
  other:              { unit: '',      min: 0,  max: 100  },
}
