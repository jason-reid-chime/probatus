// Helpers for copying As Found readings into As Left when no adjustment was
// made. They only touch the As Left strings; everything As Left drives
// (error %, pass/fail, overall result) is derived from those strings on render,
// so the result is identical to the technician typing the values.

/** True when an As Found input holds something worth copying. */
export function hasReading(value: string | undefined | null): boolean {
  return value != null && value.trim() !== ''
}

/**
 * Copy `fromKey` into `toKey` on every row whose `fromKey` has a reading.
 * Rows without an As Found value are left untouched. Existing As Left values
 * are overwritten (the user asked for it explicitly).
 */
export function copyAllAsFound<T, F extends keyof T, L extends keyof T>(
  rows: T[],
  fromKey: F,
  toKey: L,
): T[] {
  return rows.map((row) => copyRowAsFound(row, fromKey, toKey))
}

/** Copy one row's As Found into its As Left (no-op when As Found is blank). */
export function copyRowAsFound<T, F extends keyof T, L extends keyof T>(
  row: T,
  fromKey: F,
  toKey: L,
): T {
  const from = row[fromKey] as unknown as string
  if (!hasReading(from)) return row
  return { ...row, [toKey]: from }
}

/** Copy As Found → As Left for the row at `index` only. */
export function copyAsFoundAt<T, F extends keyof T, L extends keyof T>(
  rows: T[],
  index: number,
  fromKey: F,
  toKey: L,
): T[] {
  return rows.map((row, i) => (i === index ? copyRowAsFound(row, fromKey, toKey) : row))
}
