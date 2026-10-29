import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import PressureGaugeTemplate, {
  buildDefaultGaugePoints,
  emptyGaugeConditions,
  gaugeRange,
  type GaugePoint,
} from './PressureGaugeTemplate'
import type { LocalAsset } from '../../../lib/db'

const asset = { id: 'a', range_min: 0, range_max: 100, range_unit: 'psi' } as LocalAsset

function Harness({ spy }: { spy?: (p: GaugePoint[]) => void }) {
  const [points, setPoints] = useState(buildDefaultGaugePoints(gaugeRange(asset)))
  const [conditions, setConditions] = useState(emptyGaugeConditions())
  return (
    <PressureGaugeTemplate
      asset={asset}
      points={points}
      onChange={(p) => { spy?.(p); setPoints(p) }}
      conditions={conditions}
      onConditionsChange={setConditions}
    />
  )
}

describe('PressureGaugeTemplate', () => {
  it('shows deviation and copies one As Found reading to As Left', () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    fireEvent.change(screen.getByLabelText('As found reference at 20 psi ↑'), { target: { value: '20.13' } })
    expect(screen.getByText('Dev +0.13')).toBeInTheDocument()

    // 12 per-row copy buttons; rising rows render first (0, 20, …).
    const copies = screen.getAllByRole('button', { name: 'Copy As Found to As Left' })
    expect(copies).toHaveLength(12)
    fireEvent.click(copies[1])
    expect(screen.getByLabelText('As left reference at 20 psi ↑')).toHaveValue(20.13)
    expect(screen.getByLabelText('As left reference at 20 psi ↓')).toHaveValue(null)
  })

  it('copies all As Found readings and reports max error', () => {
    render(<Harness />)
    const rising = ['0', '20.13', '40.23', '60.29', '80.36', '100.45']
    const falling = ['0', '20.08', '40.19', '60.24', '80.31', '100.45']
    ;[0, 20, 40, 60, 80, 100].forEach((n, i) => {
      fireEvent.change(screen.getByLabelText(`As found reference at ${n} psi ↑`), { target: { value: rising[i] } })
      fireEvent.change(screen.getByLabelText(`As found reference at ${n} psi ↓`), { target: { value: falling[i] } })
    })
    fireEvent.click(screen.getByRole('button', { name: /Copy As Found → As Left/ }))
    expect(screen.getByLabelText('As left reference at 100 psi ↓')).toHaveValue(100.45)
    expect(screen.getAllByText('±0.45 % FS · PASS')).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('Accuracy (± % FS)'), { target: { value: '0.25' } })
    expect(screen.getAllByText('±0.45 % FS · FAIL')).toHaveLength(2)
  })
})
