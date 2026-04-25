import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DriftChart from './DriftChart'
import type { LocalCalibrationRecord, LocalMeasurement } from '../../lib/db'

const makeRecord = (id: string, date: string): LocalCalibrationRecord => ({
  id,
  local_id: id,
  tenant_id: 't1',
  asset_id: 'a1',
  technician_id: 'u1',
  status: 'approved',
  performed_at: date,
  updated_at: date,
})

const makeMeasurement = (recordId: string, label: string, errorPct: number): LocalMeasurement => ({
  id: `${recordId}-${label}`,
  record_id: recordId,
  point_label: label,
  error_pct: errorPct,
  measured_value: 50,
  standard_value: 50,
  pass: errorPct < 1,
})

describe('DriftChart', () => {
  it('renders nothing when fewer than 2 approved calibrations', () => {
    const { container } = render(
      <DriftChart calibrations={[makeRecord('c1', '2025-01-01')]} measurements={{}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when no common points across calibrations', () => {
    const cals = [makeRecord('c1', '2025-01-01'), makeRecord('c2', '2025-06-01')]
    const { container } = render(<DriftChart calibrations={cals} measurements={{}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders chart heading when data is sufficient', () => {
    const cals = [makeRecord('c1', '2025-01-01'), makeRecord('c2', '2025-06-01')]
    const measurements = {
      c1: [makeMeasurement('c1', '0%', 0.2), makeMeasurement('c1', '50%', 0.3)],
      c2: [makeMeasurement('c2', '0%', 0.5), makeMeasurement('c2', '50%', 0.8)],
    }
    render(<DriftChart calibrations={cals} measurements={measurements} />)
    expect(screen.getByText(/drift trend/i)).toBeTruthy()
  })

  it('renders legend entries for each series', () => {
    const cals = [makeRecord('c1', '2025-01-01'), makeRecord('c2', '2025-06-01')]
    const measurements = {
      c1: [makeMeasurement('c1', '0%', 0.2), makeMeasurement('c1', '50%', 0.3)],
      c2: [makeMeasurement('c2', '0%', 0.5), makeMeasurement('c2', '50%', 0.8)],
    }
    render(<DriftChart calibrations={cals} measurements={measurements} />)
    expect(screen.getByText('0%')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
  })

  it('renders SVG chart element', () => {
    const cals = [makeRecord('c1', '2025-01-01'), makeRecord('c2', '2025-06-01')]
    const measurements = {
      c1: [makeMeasurement('c1', '25%', 0.1)],
      c2: [makeMeasurement('c2', '25%', 0.4)],
    }
    render(<DriftChart calibrations={cals} measurements={measurements} />)
    expect(document.querySelector('svg')).toBeTruthy()
  })
})
