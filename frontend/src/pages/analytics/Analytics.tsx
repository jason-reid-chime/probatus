import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { fetchAnalytics, type MonthStat } from '../../lib/api/analytics'
import { formatMoney } from '../../lib/api/invoices'

const RANGES = [3, 6, 12, 24]

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

/** Monthly fail-rate bars (single series; values labelled on hover and in the table). */
function TrendChart({ months }: { months: MonthStat[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (months.length === 0) return null
  const rates = months.map((m) => (m.calibrations ? (m.failures * 100) / m.calibrations : 0))
  const max = Math.max(10, ...rates)
  return (
    <figure className="rounded-2xl border border-gray-200 bg-white p-5">
      <figcaption className="mb-4 font-semibold text-gray-900">Fail rate by month</figcaption>
      <div className="relative flex h-40 items-end gap-1 border-b border-gray-200" role="img" aria-label="Monthly fail rate chart; values are listed in the table below">
        {months.map((m, i) => (
          <div
            key={m.month}
            className="relative flex h-full flex-1 items-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className={`w-full rounded-t ${hover === i ? 'bg-brand-600' : 'bg-brand-500'}`}
              style={{ height: `${Math.max(rates[i] ? 2 : 0, (rates[i] / max) * 100)}%` }}
            />
            {hover === i && (
              <div className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1 text-xs text-white shadow">
                {m.month}: {rates[i].toFixed(1)}% ({m.failures}/{m.calibrations})
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-gray-500">
        {months.map((m) => <span key={m.month} className="flex-1 truncate text-center">{m.month.slice(2)}</span>)}
      </div>
    </figure>
  )
}

export default function Analytics() {
  const [months, setMonths] = useState(12)
  const { data, isLoading, error } = useQuery({ queryKey: ['analytics', months], queryFn: () => fetchAnalytics(months) })
  const currency = 'CAD'

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">Which instruments fail calibration, and what they cost. Approved calibrations only.</p>
        </div>
        <div className="flex rounded-xl border border-gray-200 bg-white p-1" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={months === r}
              onClick={() => setMonths(r)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${months === r ? 'bg-brand-500 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {r < 12 ? `${r} mo` : `${r / 12} yr`}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />}
      {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{(error as Error).message}</div>}

      {data && data.calibrations === 0 && data.total_billed === 0 && (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <BarChart3 size={48} className="mb-4 text-gray-300" aria-hidden />
          <p className="text-gray-500">No approved calibrations or invoices in this period yet.</p>
        </div>
      )}

      {data && (data.calibrations > 0 || data.total_billed > 0) && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Calibrations" value={String(data.calibrations)} />
            <Stat label="Failed" value={String(data.failures)} sub="any point out of tolerance" />
            <Stat label="Fail rate" value={`${data.fail_rate.toFixed(1)}%`} />
            <Stat label="Billed" value={formatMoney(data.total_billed, currency)} sub="non-void invoices" />
          </div>

          <TrendChart months={data.monthly} />

          <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <h2 className="px-5 pt-4 pb-2 font-semibold text-gray-900">Failure rate by manufacturer &amp; model</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="px-4 py-2 font-semibold text-gray-700">Make / model</th>
                    <th className="px-4 py-2 font-semibold text-gray-700 hidden sm:table-cell">Type</th>
                    <th className="px-4 py-2 text-right font-semibold text-gray-700">Instruments</th>
                    <th className="px-4 py-2 text-right font-semibold text-gray-700">Calibrations</th>
                    <th className="px-4 py-2 text-right font-semibold text-gray-700">Failed</th>
                    <th className="px-4 py-2 font-semibold text-gray-700 w-40">Fail rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.by_make_model.map((m) => (
                    <tr key={`${m.manufacturer}|${m.model}|${m.instrument_type}`}>
                      <td className="px-4 py-2 font-medium text-gray-900">{m.manufacturer} <span className="text-gray-500">{m.model}</span></td>
                      <td className="px-4 py-2 capitalize text-gray-600 hidden sm:table-cell">{m.instrument_type.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.instruments}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.calibrations}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m.failures}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-gray-100">
                            <div className="h-2 rounded-full bg-brand-500" style={{ width: `${m.fail_rate}%` }} />
                          </div>
                          <span className="w-12 text-right tabular-nums text-gray-700">{m.fail_rate.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.repeat_failures.length > 0 && (
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 className="font-semibold text-gray-900">Repeat failures</h2>
              <p className="mb-3 text-sm text-gray-500">Instruments that failed two or more times — candidates for repair, replacement or a shorter interval.</p>
              <ul className="divide-y divide-gray-100 text-sm">
                {data.repeat_failures.map((a) => (
                  <li key={a.asset_id} className="flex items-center gap-3 py-2">
                    <Link to={`/assets/${a.asset_id}`} className="font-semibold text-gray-900 hover:text-brand-600">{a.tag_id}</Link>
                    <span className="text-gray-500">{[a.manufacturer, a.model].filter(Boolean).join(' ')}</span>
                    <span className="ml-auto tabular-nums text-gray-700">{a.failures} of {a.calibrations} failed</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <h2 className="px-5 pt-4 pb-1 font-semibold text-gray-900">Cost per instrument</h2>
            <p className="px-5 pb-2 text-sm text-gray-500">From invoice lines linked to each instrument, annualised over the selected period.</p>
            {data.cost_by_asset.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-gray-500">No invoiced work in this period. Create invoices from completed work orders to see costs.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="px-4 py-2 font-semibold text-gray-700">Tag</th>
                      <th className="px-4 py-2 font-semibold text-gray-700 hidden sm:table-cell">Make / model</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-700">Billed</th>
                      <th className="px-4 py-2 text-right font-semibold text-gray-700">Per year</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.cost_by_asset.map((a) => (
                      <tr key={a.asset_id}>
                        <td className="px-4 py-2"><Link to={`/assets/${a.asset_id}`} className="font-semibold text-gray-900 hover:text-brand-600">{a.tag_id}</Link></td>
                        <td className="px-4 py-2 text-gray-600 hidden sm:table-cell">{[a.manufacturer, a.model].filter(Boolean).join(' ') || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(a.total_billed, currency)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium">{formatMoney(a.cost_per_year, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
