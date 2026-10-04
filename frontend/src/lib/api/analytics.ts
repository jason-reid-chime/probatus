import { apiRequest } from './client'

export interface MakeModelStat {
  manufacturer: string
  model: string
  instrument_type: string
  instruments: number
  calibrations: number
  failures: number
  fail_rate: number
}

export interface MonthStat {
  month: string
  calibrations: number
  failures: number
}

export interface AssetCost {
  asset_id: string
  tag_id: string
  manufacturer: string
  model: string
  instrument_type: string
  calibrations: number
  failures: number
  total_billed: number
  cost_per_year: number
}

export interface Analytics {
  months: number
  calibrations: number
  failures: number
  fail_rate: number
  total_billed: number
  by_make_model: MakeModelStat[]
  monthly: MonthStat[]
  cost_by_asset: AssetCost[]
  repeat_failures: AssetCost[]
}

export function fetchAnalytics(months = 12): Promise<Analytics> {
  return apiRequest<Analytics>('GET', `/stats/analytics?months=${months}`)
}
