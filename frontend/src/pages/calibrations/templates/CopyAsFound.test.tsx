import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { LocalAsset } from '../../../lib/db'
import PressureTemplate, { buildDefaultPressureRows, type PressureRow } from './PressureTemplate'
import BackflowTemplate, { buildDefaultBackflowRows, emptyBackflowConditions, type BackflowRow } from './BackflowTemplate'
import SwitchTemplate, { buildDefaultSwitchData, type SwitchData } from './SwitchTemplate'
import TransmitterTemplate, { buildDefaultTransmitterRows, type TransmitterRow } from './TransmitterTemplate'

const BULK = /copy as found → as left/i
const ROW = 'Copy As Found to As Left'

const asset = {
  id: 'a1', tenant_id: 't1', tag_id: 'PT-1', instrument_type: 'pressure',
  range_min: 0, range_max: 100, range_unit: 'psi', updated_at: '',
} as unknown as LocalAsset

function value(label: string | RegExp): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value
}

function type(label: string | RegExp, v: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: v } })
}

// ---------------------------------------------------------------------------
// Pressure
// ---------------------------------------------------------------------------
function PressureHarness({ readOnly = false }: { readOnly?: boolean }) {
  const [rows, setRows] = useState<PressureRow[]>(buildDefaultPressureRows(asset))
  return <PressureTemplate asset={asset} rows={rows} onChange={setRows} readOnly={readOnly} />
}

function rowOf(label: string | RegExp): HTMLElement {
  return screen.getByLabelText(label).closest('tr') as HTMLElement
}

describe('Pressure sheet — copy As Found → As Left', () => {
  it('bulk copy fills every row that has As Found, overwrites As Left and recomputes error/pass', () => {
    render(<PressureHarness />)
    const bulk = screen.getByRole('button', { name: BULK })
    expect(bulk).toBeDisabled() // nothing to copy yet

    type('As found at 0%', '0.5')     // 0.5% of span → pass
    type('As found at 50%', '55')     // 5% of span → fail
    type('As left at 50%', '50')      // will be overwritten
    type('As left at 100%', '100')    // no As Found → left alone

    // before copy: 50% row passes on its typed As Left
    expect(within(rowOf('As left at 50%')).getByText('0.000%')).toHaveClass('text-green-600')

    fireEvent.click(screen.getByRole('button', { name: BULK }))

    expect(value('As left at 0%')).toBe('0.5')
    expect(value('As left at 50%')).toBe('55')
    expect(value('As left at 25%')).toBe('')
    expect(value('As left at 100%')).toBe('100')

    expect(within(rowOf('As left at 0%')).getByText('0.500%')).toHaveClass('text-green-600')
    expect(within(rowOf('As left at 50%')).getByText('5.000%')).toHaveClass('text-red-600')
  })

  it('per-row copy only affects its own row and is disabled without As Found', () => {
    render(<PressureHarness />)
    const buttons = screen.getAllByRole('button', { name: ROW })
    expect(buttons).toHaveLength(5)
    buttons.forEach((b) => expect(b).toBeDisabled())

    type('As found at 25%', '25.2')
    type('As found at 75%', '80')
    fireEvent.click(within(rowOf('As left at 25%')).getByRole('button', { name: ROW }))

    expect(value('As left at 25%')).toBe('25.2')
    expect(value('As left at 75%')).toBe('')
    expect(within(rowOf('As left at 25%')).getByText('0.200%')).toHaveClass('text-green-600')
  })

  it('hides copy controls when read-only', () => {
    render(<PressureHarness readOnly />)
    expect(screen.queryByRole('button', { name: BULK })).toBeNull()
    expect(screen.queryAllByRole('button', { name: ROW })).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Backflow
// ---------------------------------------------------------------------------
function BackflowHarness({ readOnly = false }: { readOnly?: boolean }) {
  const [rows, setRows] = useState<BackflowRow[]>(buildDefaultBackflowRows())
  const [conditions, setConditions] = useState(emptyBackflowConditions())
  return (
    <BackflowTemplate
      rows={rows}
      onChange={setRows}
      conditions={conditions}
      onConditionsChange={setConditions}
      readOnly={readOnly}
    />
  )
}

describe('Backflow sheet — copy As Found → As Left', () => {
  it('bulk copy updates As Left pass/fail', () => {
    render(<BackflowHarness />)
    type('As found at 14.0 PSID', '14.1') // within ±0.2
    type('As found at 12.0 PSID', '12.5') // outside ±0.2
    fireEvent.click(screen.getByRole('button', { name: BULK }))

    expect(value('As left at 14.0 PSID')).toBe('14.1')
    expect(value('As left at 12.0 PSID')).toBe('12.5')
    expect(value('As left at 10.0 PSID')).toBe('')

    // Each row shows an A.F. and an A.L. icon; after copy both match.
    expect(within(rowOf('As left at 14.0 PSID')).getAllByLabelText('Pass')).toHaveLength(2)
    expect(within(rowOf('As left at 12.0 PSID')).getAllByLabelText('Fail')).toHaveLength(2)
  })

  it('per-row copy flips the As Left result for that row only', () => {
    render(<BackflowHarness />)
    type('As found at 8.0 PSID', '8.1')
    type('As left at 8.0 PSID', '9')
    expect(within(rowOf('As left at 8.0 PSID')).getByLabelText('Fail')).toBeTruthy()

    fireEvent.click(within(rowOf('As left at 8.0 PSID')).getByRole('button', { name: ROW }))
    expect(value('As left at 8.0 PSID')).toBe('8.1')
    expect(within(rowOf('As left at 8.0 PSID')).queryByLabelText('Fail')).toBeNull()
    expect(within(rowOf('As left at 8.0 PSID')).getAllByLabelText('Pass')).toHaveLength(2)
  })

  it('hides copy controls when read-only', () => {
    render(<BackflowHarness readOnly />)
    expect(screen.queryByRole('button', { name: BULK })).toBeNull()
    expect(screen.queryAllByRole('button', { name: ROW })).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------
function SwitchHarness() {
  const [data, setData] = useState<SwitchData>({ ...buildDefaultSwitchData(), setpoint: '50' })
  return <SwitchTemplate asset={asset} data={data} onChange={setData} />
}

describe('Switch sheet — copy As Found → As Left', () => {
  it('bulk copy fills trip and reset and recomputes error %', () => {
    render(<SwitchHarness />)
    type('As found trip', '51')   // 1% → pass (tolerance 2%)
    type('As found reset', '45')  // 5% → fail
    fireEvent.click(screen.getByRole('button', { name: BULK }))

    expect(value('As left trip')).toBe('51')
    expect(value('As left reset')).toBe('45')
    expect(within(rowOf('As left trip')).getByText('1.000%')).toHaveClass('text-green-600')
    expect(within(rowOf('As left reset')).getByText('5.000%')).toHaveClass('text-red-600')
  })

  it('per-row copy only copies the trip point', () => {
    render(<SwitchHarness />)
    type('As found trip', '50.5')
    type('As found reset', '48')
    fireEvent.click(within(rowOf('As left trip')).getByRole('button', { name: ROW }))
    expect(value('As left trip')).toBe('50.5')
    expect(value('As left reset')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Transmitter
// ---------------------------------------------------------------------------
function TransmitterHarness() {
  const [rows, setRows] = useState<TransmitterRow[]>(buildDefaultTransmitterRows(asset))
  return <TransmitterTemplate asset={asset} rows={rows} onChange={setRows} />
}

describe('Transmitter sheet — copy As Found → As Left', () => {
  it('bulk copy fills PV and mA As Left and shows the error', () => {
    render(<TransmitterHarness />)
    type('PV as found at 50%', '50.2')
    type('mA as found at 50%', '13')   // expected 12 mA → 6.25% → fail
    fireEvent.click(screen.getByRole('button', { name: BULK }))

    expect(value('PV as left at 50%')).toBe('50.2')
    expect(value('mA as left at 50%')).toBe('13')
    expect(value('PV as left at 25%')).toBe('')
    expect(screen.getByText('0.400% error')).toHaveClass('text-green-600')
    expect(screen.getByText('6.250% error')).toHaveClass('text-red-600')
  })

  it('per-row copy has one control per As Left input and copies only that reading', () => {
    render(<TransmitterHarness />)
    expect(screen.getAllByRole('button', { name: ROW })).toHaveLength(10)
    type('PV as found at 75%', '75')
    type('mA as found at 75%', '16')
    const pvLeft = screen.getByLabelText('PV as left at 75%')
    fireEvent.click(within(pvLeft.parentElement as HTMLElement).getByRole('button', { name: ROW }))
    expect(value('PV as left at 75%')).toBe('75')
    expect(value('mA as left at 75%')).toBe('')
  })
})
