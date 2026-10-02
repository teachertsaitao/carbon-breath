// 基準值與每日統計。這裡全部是「純計算」，不碰資料庫，方便用測試驗證。

import { addDays } from './dates'
import type { BreathRecord, Thresholds } from './types'

/** 中位數。偶數筆取中間兩筆的平均；沒有資料回傳 null。 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 會列入基準值與呼吸數警示的紀錄：狀態是「熟睡」而且沒被刪除。 */
export function isCounted(r: BreathRecord): boolean {
  return r.state === 'deep' && !r.deletedAt
}

export interface Baseline {
  /** 基準值；熟睡紀錄不到最少筆數時是 null */
  value: number | null
  /** 這段期間有幾筆熟睡紀錄 */
  count: number
  from: string
  to: string
}

function baselineInWindow(records: BreathRecord[], from: string, to: string, minCount: number): Baseline {
  const rates = records.filter((r) => isCounted(r) && r.date >= from && r.date <= to).map((r) => r.rate)
  return { value: rates.length >= minCount ? median(rates) : null, count: rates.length, from, to }
}

/** 目前的基準值：refDate 當天往前共 N 天（預設 7 天）熟睡紀錄的中位數。首頁顯示的就是這個。 */
export function currentBaseline(records: BreathRecord[], refDate: string, t: Thresholds): Baseline {
  return baselineInWindow(records, addDays(refDate, -(t.baselineDays - 1)), refDate, t.baselineMinCount)
}

/**
 * 判斷「某一筆紀錄」時用的基準值：同樣取 N 天內的熟睡紀錄，但只算比它「更早量到」的。
 * 不含它自己（免得偏高的那一筆把自己的基準拉高），也不含之後才量的
 * （這樣之後再量幾次，不會回頭改變先前那一筆的判斷結果）。
 */
export function baselineBefore(
  records: BreathRecord[],
  target: Pick<BreathRecord, 'id' | 'date' | 'measuredAt'>,
  t: Thresholds,
): Baseline {
  const from = addDays(target.date, -(t.baselineDays - 1))
  const rates = records
    .filter(
      (r) =>
        isCounted(r) && r.id !== target.id && r.date >= from && r.measuredAt < target.measuredAt,
    )
    .map((r) => r.rate)
  return {
    value: rates.length >= t.baselineMinCount ? median(rates) : null,
    count: rates.length,
    from,
    to: target.date,
  }
}

/** refDate「之前」N 天的基準值（不含 refDate 當天），用在連續兩天偏高的判斷。 */
export function priorBaseline(records: BreathRecord[], refDate: string, t: Thresholds): Baseline {
  return baselineInWindow(
    records,
    addDays(refDate, -t.baselineDays),
    addDays(refDate, -1),
    t.baselineMinCount,
  )
}

export interface DaySummary {
  date: string
  median: number
  min: number
  max: number
  count: number
  /** 當天第一筆、最後一筆熟睡紀錄的測量時間（ISO） */
  firstAt: string
  lastAt: string
}

/** 每一天熟睡紀錄的中位數、最低、最高、筆數。沒有熟睡紀錄的日子不會出現。 */
export function dailyDeepSummaries(records: BreathRecord[]): Map<string, DaySummary> {
  const byDate = new Map<string, BreathRecord[]>()
  for (const r of records) {
    if (!isCounted(r)) continue
    const list = byDate.get(r.date)
    if (list) list.push(r)
    else byDate.set(r.date, [r])
  }
  const out = new Map<string, DaySummary>()
  for (const [date, list] of byDate) {
    const rates = list.map((r) => r.rate)
    const times = list.map((r) => r.measuredAt).sort()
    out.set(date, {
      date,
      median: median(rates)!,
      min: Math.min(...rates),
      max: Math.max(...rates),
      count: rates.length,
      firstAt: times[0],
      lastAt: times[times.length - 1],
    })
  }
  return out
}

export interface OtherRates {
  /** 淺眠時量到的呼吸數（照測量時間由早到晚） */
  light: number[]
  /** 清醒休息時量到的呼吸數（照測量時間由早到晚） */
  awake: number[]
}

/**
 * 每一天「不是熟睡」時量的紀錄（淺眠、清醒休息）。沒有這類紀錄的日子不會出現。
 * 這些紀錄不算進基準值和呼吸數警示，趨勢圖選「全部」時才會畫出來。
 */
export function dailyOtherRates(records: BreathRecord[]): Map<string, OtherRates> {
  const others = records
    .filter((r) => !r.deletedAt && r.state !== 'deep')
    .sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : 0))
  const out = new Map<string, OtherRates>()
  for (const r of others) {
    let day = out.get(r.date)
    if (!day) {
      day = { light: [], awake: [] }
      out.set(r.date, day)
    }
    if (r.state === 'light') day.light.push(r.rate)
    else day.awake.push(r.rate)
  }
  return out
}

/** 顯示用：整數就顯示整數，有小數顯示到一位（中位數可能是 x.5）。 */
export function formatRate(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
