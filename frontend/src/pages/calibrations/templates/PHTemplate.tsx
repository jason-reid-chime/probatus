/* eslint-disable react-refresh/only-export-components */
export interface PHData {
  phReading: string
  conductivityReading: string
  buffer1LotNumber: string
  buffer1Expiry: string
  buffer2LotNumber: string
  buffer2Expiry: string
}

interface PHTemplateProps {
  data: PHData
  onChange: (data: PHData) => void
}

export function buildDefaultPHData(): PHData {
  return {
    phReading: '',
    conductivityReading: '',
    buffer1LotNumber: '',
    buffer1Expiry: '',
    buffer2LotNumber: '',
    buffer2Expiry: '',
  }
}

export default function PHTemplate({ data, onChange }: PHTemplateProps) {
  function handleField(field: keyof PHData, value: string) {
    onChange({ ...data, [field]: value })
  }

  return (
    <div className="space-y-6">
      {/* Readings */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Readings
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              pH Reading
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={data.phReading}
              onChange={(e) => handleField('phReading', e.target.value)}
              placeholder="e.g. 7.00"
              className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Conductivity Reading (µS/cm)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={data.conductivityReading}
              onChange={(e) =>
                handleField('conductivityReading', e.target.value)
              }
              placeholder="e.g. 1413.0"
              className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
        </div>
      </section>

      {/* Buffer 1 */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Buffer Solution 1
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lot Number
            </label>
            <input
              type="text"
              value={data.buffer1LotNumber}
              onChange={(e) => handleField('buffer1LotNumber', e.target.value)}
              placeholder="e.g. LOT-20250401"
              className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expiry Date
            </label>
            <input
              type="date"
              value={data.buffer1Expiry}
              onChange={(e) => handleField('buffer1Expiry', e.target.value)}
              className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
        </div>
      </section>

      {/* Buffer 2 (optional) */}
      <section>
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
          Buffer Solution 2{' '}
          <span className="normal-case font-normal text-gray-400">
            (optional)
          </span>
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lot Number
            </label>
            <input
              type="text"
              value={data.buffer2LotNumber}
              onChange={(e) => handleField('buffer2LotNumber', e.target.value)}
              placeholder="e.g. LOT-20250401"
              className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expiry Date
            </label>
            <input
              type="date"
              value={data.buffer2Expiry}
              onChange={(e) => handleField('buffer2Expiry', e.target.value)}
              className="w-full text-lg min-h-[48px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
