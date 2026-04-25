import { useMemo } from 'react'
import type { LocalCalibrationRecord, LocalMeasurement } from '../../lib/db'

interface Props {
  calibrations: LocalCalibrationRecord[]
  measurements: Record<string, LocalMeasurement[]>  // keyed by record.id
  tolerancePct?: number
}

const W = 480
const H = 160
const PAD = { top: 12, right: 16, bottom: 32, left: 44 }
const INNER_W = W - PAD.left - PAD.right
const INNER_H = H - PAD.top - PAD.bottom

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4']

function lerp(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return (outMin + outMax) / 2
  return outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin)
}

export default function DriftChart({ calibrations, measurements, tolerancePct = 1 }: Props) {
  const { series, dates, maxErr } = useMemo(() => {
    // Only approved cals with measurements, sorted oldest→newest
    const approved = calibrations
      .filter(c => c.status === 'approved' && measurements[c.id]?.length > 0)
      .sort((a, b) => a.performed_at.localeCompare(b.performed_at))

    if (approved.length < 2) return { series: [], dates: [], maxErr: tolerancePct }

    // Group by point_label
    const pointMap = new Map<string, { date: string; errorPct: number }[]>()
    for (const cal of approved) {
      for (const m of measurements[cal.id] ?? []) {
        if (m.error_pct == null) continue
        const pts = pointMap.get(m.point_label) ?? []
        pts.push({ date: cal.performed_at, errorPct: m.error_pct })
        pointMap.set(m.point_label, pts)
      }
    }

    // Only points that appear in ≥2 calibrations
    const series = [...pointMap.entries()]
      .filter(([, pts]) => pts.length >= 2)
      .map(([label, pts]) => ({ label, pts: pts.sort((a, b) => a.date.localeCompare(b.date)) }))

    const allDates = [...new Set(approved.map(c => c.performed_at))].sort()
    const allErrors = series.flatMap(s => s.pts.map(p => p.errorPct))
    const maxErr = Math.max(tolerancePct * 1.5, ...allErrors)

    return { series, dates: allDates, maxErr }
  }, [calibrations, measurements, tolerancePct])

  if (series.length === 0) return null

  const xScale = (date: string) => lerp(dates.indexOf(date), 0, dates.length - 1, 0, INNER_W)
  const yScale = (err: number) => lerp(err, 0, maxErr, INNER_H, 0)
  const tolY = yScale(tolerancePct)

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 pb-5">
      <h2 className="pt-5 pb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Drift Trend
      </h2>
      <p className="text-xs text-gray-400 mb-3">Error % per calibration point over time. Dashed line = tolerance limit.</p>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full max-w-full"
          style={{ minWidth: 280 }}
          aria-label="Drift trend chart"
        >
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map(f => {
              const y = f * INNER_H
              const val = lerp(f, 0, 1, maxErr, 0)
              return (
                <g key={f}>
                  <line x1={0} y1={y} x2={INNER_W} y2={y} stroke="#f3f4f6" strokeWidth={1} />
                  <text x={-6} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af">
                    {val.toFixed(1)}%
                  </text>
                </g>
              )
            })}

            {/* Tolerance line */}
            <line
              x1={0} y1={tolY} x2={INNER_W} y2={tolY}
              stroke="#ef4444" strokeWidth={1} strokeDasharray="4 3" opacity={0.7}
            />
            <text x={INNER_W + 2} y={tolY + 4} fontSize={8} fill="#ef4444">{tolerancePct}%</text>

            {/* Series lines */}
            {series.map((s, si) => {
              const color = COLORS[si % COLORS.length]
              const points = s.pts.map(p => `${xScale(p.date)},${yScale(p.errorPct)}`).join(' ')
              const last = s.pts[s.pts.length - 1]
              const trending = s.pts.length >= 2 && last.errorPct > s.pts[s.pts.length - 2].errorPct
              return (
                <g key={s.label}>
                  <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.8}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {s.pts.map(p => (
                    <circle
                      key={p.date}
                      cx={xScale(p.date)}
                      cy={yScale(p.errorPct)}
                      r={3}
                      fill={color}
                    >
                      <title>{s.label}: {p.errorPct.toFixed(3)}% on {new Date(p.date).toLocaleDateString()}</title>
                    </circle>
                  ))}
                  {/* Trend arrow on last point */}
                  {trending && last.errorPct > tolerancePct * 0.7 && (
                    <text x={xScale(last.date) + 5} y={yScale(last.errorPct) + 4} fontSize={10} fill={color}>↗</text>
                  )}
                </g>
              )
            })}

            {/* X axis dates */}
            {dates.map((d, i) => (
              <text key={d} x={xScale(d)} y={INNER_H + 18} textAnchor="middle" fontSize={9} fill="#9ca3af">
                {new Date(d).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}
                {i === dates.length - 1 ? ' ←now' : ''}
              </text>
            ))}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {series.map((s, si) => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: COLORS[si % COLORS.length] }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}
