// 警示規則。全部是純計算，規則的白話說明在 README「計算規則」一節。

import { addDays, toDateKey } from './dates'
import { PLAUSIBLE_MAX, PLAUSIBLE_MIN } from './defaults'
import {
  baselineBefore,
  currentBaseline,
  dailyDeepSummaries,
  isCounted,
  median,
  priorBaseline,
  type Baseline,
  type DaySummary,
} from './stats'
import type {
  AlertReason,
  AlertResult,
  BreathRecord,
  CoughLevel,
  DailyLog,
  EffortSign,
  SleepState,
  Thresholds,
} from './types'

const EPS = 1e-9

// ── 呼吸數換算 ──────────────────────────────────────

/** 計時模式：次數 ÷ 秒數 × 60 */
export function rateFromTimed(breaths: number, durationSec: number): number {
  return Math.round((breaths * 60) / durationSec)
}

/** 快速模式：第一下點擊開始計時（不計入），之後點滿 N 次，呼吸數 = N ÷ 經過秒數 × 60 */
export function rateFromQuick(breaths: number, elapsedMs: number): number {
  return Math.round((breaths / (elapsedMs / 1000)) * 60)
}

/** 數值不合理（低於 8 或高於 120），儲存前要先請使用者確認。 */
export function isImplausible(rate: number): boolean {
  return rate < PLAUSIBLE_MIN || rate > PLAUSIBLE_MAX
}

// ── 單筆紀錄的警示 ──────────────────────────────────

/** 「比基準值高出 N% 以上」對應的呼吸數 */
export function relativeYellowRate(baseline: number, t: Thresholds): number {
  return baseline * (1 + t.baselinePct / 100)
}

/**
 * 判斷一筆紀錄的警示燈號。
 *
 * - 呼吸費力徵象：不管當時是不是熟睡，只要勾了任何一項就是紅色。
 *   （例如「坐著不肯躺下」本來就不會是熟睡狀態，不能因為不是熟睡就不警示。）
 * - 呼吸數：只有「熟睡」的紀錄才判斷。≥ 紅色門檻 → 紅色；
 *   ≥ 黃色門檻，或比基準值高出設定的百分比以上 → 黃色。
 */
export function evaluateRecord(
  input: { rate: number; state: SleepState; signs: EffortSign[] },
  baseline: number | null,
  t: Thresholds,
): AlertResult {
  const reasons: AlertReason[] = []

  if (input.signs.length > 0) reasons.push('signs')

  if (input.state === 'deep') {
    if (input.rate >= t.redRate) reasons.push('rateRed')
    else if (input.rate >= t.yellowRate) reasons.push('rateYellow')
    if (baseline != null && input.rate >= relativeYellowRate(baseline, t) - EPS) {
      reasons.push('aboveBaseline')
    }
  }

  const level =
    reasons.includes('signs') || reasons.includes('rateRed')
      ? 'red'
      : reasons.length > 0
        ? 'yellow'
        : 'none'

  return {
    level,
    reasons,
    baseline,
    yellowRate: t.yellowRate,
    redRate: t.redRate,
    baselinePct: t.baselinePct,
  }
}

type Evaluable = Pick<BreathRecord, 'id' | 'date' | 'measuredAt' | 'rate' | 'state' | 'signs'>

/** 判斷某一筆紀錄的警示：基準值取它之前（N 天內）的熟睡紀錄。 */
export function evaluateAgainstHistory(record: Evaluable, records: BreathRecord[], t: Thresholds): AlertResult {
  return evaluateRecord(record, baselineBefore(records, record, t).value, t)
}

const DAY_MS = 86_400_000

/**
 * 把所有紀錄用「目前的門檻」判斷一遍，回傳 紀錄 id → 判斷結果。
 * 警示結果不存進資料庫，每次都現算：門檻一改，首頁、清單、圖表會一致地跟著變。
 *
 * 結果跟逐筆呼叫 evaluateAgainstHistory 一樣，只是先照時間排好、
 * 每一筆只往回看它前面一段時間的熟睡紀錄，資料累積幾年也不會變慢。
 */
export function evaluateAll(records: BreathRecord[], t: Thresholds): Map<string, AlertResult> {
  const live = records
    .filter((r) => !r.deletedAt)
    .map((r) => ({ r, ms: Date.parse(r.measuredAt) }))
    .sort((a, b) => a.ms - b.ms)
  const out = new Map<string, AlertResult>()
  const deepSoFar: typeof live = [] // 已經走過的熟睡紀錄，由舊到新

  for (const { r, ms } of live) {
    const from = addDays(r.date, -(t.baselineDays - 1))
    // 往回找的時間上限。「日期」是當地日期，兩支手機時區不同時日期和時間的先後可能差到一天，
    // 所以多留兩天緩衝，真正要不要算進去還是用下面的日期條件決定。
    const cutoff = ms - (t.baselineDays + 2) * DAY_MS
    const rates: number[] = []
    for (let i = deepSoFar.length - 1; i >= 0; i--) {
      const prev = deepSoFar[i]
      if (prev.ms < cutoff) break
      if (prev.r.date >= from && prev.r.measuredAt < r.measuredAt) rates.push(prev.r.rate)
    }
    const baseline = rates.length >= t.baselineMinCount ? median(rates) : null
    out.set(r.id, evaluateRecord(r, baseline, t))
    if (r.state === 'deep') deepSoFar.push({ r, ms })
  }
  return out
}

// ── 連續兩天偏高 ────────────────────────────────────

/** 某一天的熟睡呼吸中位數有沒有達到黃色門檻 */
export function isDayElevated(
  dayMedian: number,
  referenceBaseline: number | null,
  t: Thresholds,
): boolean {
  if (dayMedian >= t.yellowRate) return true
  return referenceBaseline != null && dayMedian >= relativeYellowRate(referenceBaseline, t) - EPS
}

export interface ConsecutiveResult {
  active: boolean
  /** 偏高的那兩天（由舊到新）；沒有觸發時是空陣列 */
  days: DaySummary[]
}

/** 「連續兩天」的兩天紀錄至少要相隔這麼久，才算是持續偏高 */
const MIN_SPAN_MS = 12 * 60 * 60 * 1000

/**
 * 連續兩天的熟睡呼吸中位數都達到黃色門檻。
 *
 * 看的是「最近的兩個連續日曆天」：今天已經有熟睡紀錄就看今天＋昨天；
 * 今天還沒量就看昨天＋前天（所以早上打開 App、還沒量之前，提醒會留著）。
 * 「比基準值高 N%」用的是這兩天「之前」的基準值，避免偏高的這兩天把基準拉高。
 *
 * 另外，這兩天的紀錄前後至少要相隔 12 小時。半夜 23:50 量到偏高、照提示在 00:10 再量一次，
 * 日期上跨了兩天，但其實是同一個晚上，不算「連續兩天」。
 */
export function consecutiveElevated(
  records: BreathRecord[],
  today: string,
  t: Thresholds,
): ConsecutiveResult {
  const days = dailyDeepSummaries(records)
  const d0 = days.has(today) ? today : addDays(today, -1)
  const d1 = addDays(d0, -1)
  const s0 = days.get(d0)
  const s1 = days.get(d1)
  if (!s0 || !s1) return { active: false, days: [] }

  const reference = priorBaseline(records, d1, t).value
  const farEnoughApart = Date.parse(s0.lastAt) - Date.parse(s1.firstAt) >= MIN_SPAN_MS
  const active =
    farEnoughApart && isDayElevated(s0.median, reference, t) && isDayElevated(s1.median, reference, t)
  return { active, days: active ? [s1, s0] : [] }
}

// ── 首頁狀態 ────────────────────────────────────────

/** 首頁燈號。idle＝過去 24 小時沒有可判斷的紀錄。 */
export type Light = 'red' | 'yellow' | 'green' | 'idle'

export interface HomeStatus {
  light: Light
  /** 決定燈號的那一筆紀錄（過去 24 小時內最新的熟睡紀錄，或有費力徵象的紀錄） */
  decisive: BreathRecord | null
  /** 那一筆紀錄的判斷結果 */
  decisiveAlert: AlertResult | null
  /** 最近一次熟睡紀錄（不限時間） */
  latestDeep: BreathRecord | null
  baseline: Baseline
  consecutive: ConsecutiveResult
  /** 過去 24 小時的警示次數 */
  last24h: { red: number; yellow: number }
  /** 今天量了幾次（全部狀態）、其中幾次是熟睡 */
  today: { total: number; deep: number }
}

export function homeStatus(records: BreathRecord[], now: Date, t: Thresholds): HomeStatus {
  const live = records
    .filter((r) => !r.deletedAt)
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
  const today = toDateKey(now)
  const nowMs = now.getTime()

  const alerts = evaluateAll(live, t)
  const levelOf = (r: BreathRecord) => alerts.get(r.id)?.level ?? 'none'

  const recent = live.filter((r) => {
    const ms = Date.parse(r.measuredAt)
    return ms >= nowMs - DAY_MS && ms <= nowMs + 60_000
  })
  // 不是熟睡、也沒有費力徵象的紀錄不影響燈號
  const decisiveList = recent.filter((r) => r.state === 'deep' || levelOf(r) !== 'none')
  const decisive = decisiveList.length > 0 ? decisiveList[decisiveList.length - 1] : null
  const decisiveAlert = decisive ? (alerts.get(decisive.id) ?? null) : null

  const consecutive = consecutiveElevated(live, today, t)

  let light: Light = 'idle'
  if (decisiveAlert) {
    light = decisiveAlert.level === 'red' ? 'red' : decisiveAlert.level === 'yellow' ? 'yellow' : 'green'
  }
  if (consecutive.active && light !== 'red') light = 'yellow'

  const todays = live.filter((r) => r.date === today)
  const deepRecords = live.filter(isCounted)

  return {
    light,
    decisive,
    decisiveAlert,
    latestDeep: deepRecords.length > 0 ? deepRecords[deepRecords.length - 1] : null,
    baseline: currentBaseline(live, today, t),
    consecutive,
    last24h: {
      red: recent.filter((r) => levelOf(r) === 'red').length,
      yellow: recent.filter((r) => levelOf(r) === 'yellow').length,
    },
    today: { total: todays.length, deep: todays.filter(isCounted).length },
  }
}

// ── 咳嗽 ────────────────────────────────────────────

/** 咳嗽次數是選範圍，比較平均時換成代表值：0、1–3→2、4–10→7、10 次以上→12 */
export const COUGH_SCORE: Record<CoughLevel, number> = { none: 0, few: 2, some: 7, many: 12 }

export interface CoughComparison {
  /** 當天咳嗽比前 7 天平均多 */
  more: boolean
  /** 前 7 天有填咳嗽的天數 */
  priorDays: number
  priorAverage: number | null
}

/** 當天的咳嗽次數有沒有比「前 7 天有紀錄的日子」的平均多。前 7 天完全沒紀錄就不比較。 */
export function coughComparison(logs: DailyLog[], date: string): CoughComparison {
  const from = addDays(date, -7)
  const to = addDays(date, -1)
  const prior = logs.filter(
    (l) => !l.deletedAt && l.cough != null && l.date >= from && l.date <= to,
  )
  const todayLog = logs.find((l) => !l.deletedAt && l.date === date)
  if (prior.length === 0) return { more: false, priorDays: 0, priorAverage: null }

  const avg = prior.reduce((sum, l) => sum + COUGH_SCORE[l.cough!], 0) / prior.length
  const more = todayLog?.cough != null && COUGH_SCORE[todayLog.cough] > avg + EPS
  return { more, priorDays: prior.length, priorAverage: avg }
}
