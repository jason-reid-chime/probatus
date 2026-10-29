import { describe, it, expect } from 'vitest'
import { copyAllAsFound, copyAsFoundAt, copyRowAsFound, hasReading } from './copyAsFound'

type Row = { asFound: string; asLeft: string }

describe('copyAsFound helpers', () => {
  it('hasReading treats blank and whitespace as empty', () => {
    expect(hasReading('')).toBe(false)
    expect(hasReading('  ')).toBe(false)
    expect(hasReading(undefined)).toBe(false)
    expect(hasReading('0')).toBe(true)
  })

  it('copyAllAsFound fills every row with an As Found value and overwrites As Left', () => {
    const rows: Row[] = [
      { asFound: '1.5', asLeft: '' },
      { asFound: '', asLeft: '9' },
      { asFound: '0', asLeft: '7' },
    ]
    expect(copyAllAsFound(rows, 'asFound', 'asLeft')).toEqual([
      { asFound: '1.5', asLeft: '1.5' },
      { asFound: '', asLeft: '9' },
      { asFound: '0', asLeft: '0' },
    ])
    // input is not mutated
    expect(rows[0].asLeft).toBe('')
  })

  it('copyAsFoundAt only touches the given row', () => {
    const rows: Row[] = [
      { asFound: '1', asLeft: '' },
      { asFound: '2', asLeft: '' },
    ]
    expect(copyAsFoundAt(rows, 1, 'asFound', 'asLeft')).toEqual([
      { asFound: '1', asLeft: '' },
      { asFound: '2', asLeft: '2' },
    ])
  })

  it('copyRowAsFound returns the same row when As Found is blank', () => {
    const row: Row = { asFound: '', asLeft: '3' }
    expect(copyRowAsFound(row, 'asFound', 'asLeft')).toBe(row)
  })
})
