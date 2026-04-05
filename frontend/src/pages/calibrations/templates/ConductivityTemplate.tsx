import { CheckCircle, XCircle, Plus, Trash2 } from 'lucide-react'

// Common conductivity standard solutions
const COMMON_STANDARDS = [
  { nominal: '84.0', unit: 'µS/cm' },
  { nominal: '1413', unit: 'µS/cm' },
  { nominal: '12880', unit: 'µS/cm' },
]

export interface ConductivityStandard {
  id: string
  nominal: string      // known value of standard solution
  reading: string      // instrument reading
  lotNumber: string
  expiry: string
}

export interface ConductivityData {
  temperature: string
  unit: 'µS/cm' | 'mS/cm'
  tolerancePct: string
  standards: ConductivityStandard[]
}

interface ConductivityTemplateProps {
  data: ConductivityData
  onChange: (data: ConductivityData) => void
}

export function buildDefaultConductivityData(): ConductivityData {
  return {
    temperature: '',
    unit: 'µS/cm',
    tolerancePct: '2',
    standards: [
      { id: crypto.randomUUID(), nominal: '84.0', reading: '', lotNumber: '', expiry: '' },
      { id: crypto.randomUUID(), nominal: '1413', reading: '', lotNumber: '', expiry: '' },
    ],
  }
}

function calcError(nominal: string, reading: string): number | null {
  const n = parseFloat(nominal)
  const r = parseFloat(reading)
  if (isNaN(n) || isNaN(r) || n === 0 || reading === '') return null
  return Math.abs(r - n) / n * 100
}

const inputClass =
  'w-full text-base min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent'

export default function ConductivityTemplate({ data, onChange }: ConductivityTemplateProps) {
  function setField<K extends keyof ConductivityData>(key: K, val: ConductivityData[K]) {
    onChange({ ...data, [key]: val })
  }

  function updateStandard(id: string, field: keyof ConductivityStandard, val: string) {
    onChange({
      ...data,
      standards: data.standards.map(s => s.id === id ? { ...s, [field]: val } : s),
    })
  }

  function addStandard() {
    onChange({
      ...data,
      standards: [
        ...data.standards,
        { id: crypto.randomUUID(), nominal: '', reading: '', lotNumber: '', expiry: '' },
      ],
    })
  }

  function removeStandard(id: string) {
    if (data.standards.length <= 1) return
    onChange({ ...data, standards: data.standards.filter(s => s.id !== id) })
  }

  const tolerancePct = parseFloat(data.tolerancePct) || 2

  return (
    <div className="space-y-5">
      {/* Settings row */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
          <select
            value={data.unit}
            onChange={e => setField('unit', e.target.value as ConductivityData['unit'])}
            className={inputClass}
          >
            <option value="µS/cm">µS/cm</option>
            <option value="mS/cm">mS/cm</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Temp (°C)</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={data.temperature}
            onChange={e => setField('temperature', e.target.value)}
            placeholder="25.0"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tolerance %</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={data.tolerancePct}
            onChange={e => setField('tolerancePct', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Quick-add common standards */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-gray-500 self-center">Quick add:</span>
        {COMMON_STANDARDS.map(s => (
          <button
            key={s.nominal}
            type="button"
            onClick={() => onChange({
              ...data,
              standards: [
                ...data.standards,
                { id: crypto.randomUUID(), nominal: s.nominal, reading: '', lotNumber: '', expiry: '' },
              ],
            })}
            className="text-xs px-2.5 py-1 rounded-full border border-brand-300 text-brand-600 hover:bg-brand-50 transition-colors"
          >
            {s.nominal} {s.unit}
          </button>
        ))}
      </div>

      {/* Standards table */}
      <div className="space-y-4">
        {data.standards.map((std, idx) => {
          const errPct = calcError(std.nominal, std.reading)
          const pass = errPct !== null ? errPct <= tolerancePct : null

          return (
            <div key={std.id} className="rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">Standard {idx + 1}</span>
                {data.standards.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStandard(std.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                    aria-label="Remove standard"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Nominal ({data.unit})
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={std.nominal}
                    onChange={e => updateStandard(std.id, 'nominal', e.target.value)}
                    placeholder="e.g. 1413"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Reading ({data.unit})
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={std.reading}
                    onChange={e => updateStandard(std.id, 'reading', e.target.value)}
                    placeholder="—"
                    className={`${inputClass} ${pass === true ? 'border-green-400 bg-green-50' : pass === false ? 'border-red-400 bg-red-50' : ''}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Lot Number</label>
                  <input
                    type="text"
                    value={std.lotNumber}
                    onChange={e => updateStandard(std.id, 'lotNumber', e.target.value)}
                    placeholder="e.g. LOT-20250401"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Expiry Date</label>
                  <input
                    type="date"
                    value={std.expiry}
                    onChange={e => updateStandard(std.id, 'expiry', e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Error / result */}
              {errPct !== null && (
                <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${pass ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {pass
                    ? <CheckCircle size={16} className="shrink-0" />
                    : <XCircle size={16} className="shrink-0" />}
                  <span className="font-mono font-semibold">{errPct.toFixed(3)}% error</span>
                  <span className="text-xs opacity-70">
                    ({pass ? 'within' : 'exceeds'} ±{tolerancePct}% tolerance)
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={addStandard}
        className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors"
      >
        <Plus size={16} />
        Add Standard Solution
      </button>
    </div>
  )
}
