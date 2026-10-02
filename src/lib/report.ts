// 回診報告的資料整理（純計算）。畫面上的摘要和 PDF 都用這一份資料，兩邊的數字才會一致。

import { evaluateAll } from './alerts'
import { dateRange, daysBetween, formatTime, isDateKey } from './dates'
import { SIGN_LABEL, STATE_LABEL } from './labels'
import { currentBaseline, dailyDeepSummaries, isCounted, median, type Baseline, type DaySummary } from './stats'
import type {
  AlertLevel,
  Appetite,
  BreathRecord,
  CoughLevel,
  DailyLog,
  Energy,
  PetProfile,
  Settings,
  Thresholds,
} from './types'

/** 一份報告最多幾天 */
export const REPORT_MAX_DAYS = 120

/** 報告裡的一天 */
export interface ReportDay {
  date: string
  /** 當天熟睡紀錄的統計；沒有熟睡紀錄是 null */
  deep: DaySummary | null
  /** 當天的警示次數（用目前的門檻判斷） */
  red: number
  yellow: number
  /** 當天不是熟睡時量的紀錄有幾筆 */
  otherCount: number
  /** 當天的每日紀錄；沒填是 null */
  log: DailyLog | null
}

/** 每日表格的一列：一天，或是一段連續好幾天都沒有紀錄的空白 */
export type ReportRow =
  | { kind: 'day'; day: ReportDay }
  | { kind: 'gap'; from: string; to: string; count: number }

/** 報告最後列出來的個別紀錄：有警示的、不是熟睡時量的、有寫備註的 */
export interface ReportEntry {
  date: string
  /** 測量時間 HH:MM；每日紀錄的備註沒有時間，是 null */
  time: string | null
  level: AlertLevel
  text: string
}

export interface ReportData {
  pet: PetProfile
  from: string
  to: string
  dayCount: number
  /** 製表日期 */
  generatedOn: string
  thresholds: Thresholds
  /** 到報告最後一天為止的基準值 */
  baseline: Baseline
  /** 這段期間的熟睡紀錄 */
  deep: {
    count: number
    /** 有熟睡紀錄的天數 */
    days: number
    median: number | null
    min: number | null
    max: number | null
  }
  /** 不是熟睡時量的紀錄有幾筆（不列入上面的統計） */
  otherCount: number
  alerts: { red: number; yellow: number }
  cough: Record<CoughLevel, number>
  appetite: Record<Appetite, number>
  energy: Record<Energy, number>
  days: ReportDay[]
  entries: ReportEntry[]
}

/** 檢查報告的日期範圍；沒問題回傳 null，有問題回傳要顯示給使用者的說明。 */
export function checkReportRange(from: string, to: string, today: string): string | null {
  if (!isDateKey(from) || !isDateKey(to)) return '請選擇開始和結束日期。'
  if (from > to) return '開始日期要在結束日期之前。'
  if (to > today) return '結束日期不能是未來。'
  if (daysBetween(from, to) + 1 > REPORT_MAX_DAYS) return `一份報告最多 ${REPORT_MAX_DAYS} 天，請縮短期間。`
  return null
}

export function buildReport(
  breaths: BreathRecord[],
  logs: DailyLog[],
  settings: Settings,
  from: string,
  to: string,
  generatedOn: string,
): ReportData {
  const t = settings.thresholds
  const live = breaths.filter((r) => !r.deletedAt)
  const inRange = live
    .filter((r) => r.date >= from && r.date <= to)
    .sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : 0))
  const logsInRange = logs.filter((l) => !l.deletedAt && l.date >= from && l.date <= to)

  // 警示要用「全部」紀錄來判斷：每一筆的基準值會用到報告期間之前幾天的紀錄
  const alerts = evaluateAll(live, t)
  const summaries = dailyDeepSummaries(inRange)
  const logByDate = new Map(logsInRange.map((l) => [l.date, l]))

  const days: ReportDay[] = dateRange(from, to).map((date) => ({
    date,
    deep: summaries.get(date) ?? null,
    red: 0,
    yellow: 0,
    otherCount: 0,
    log: logByDate.get(date) ?? null,
  }))
  const dayByDate = new Map(days.map((d) => [d.date, d]))

  const entries: ReportEntry[] = []
  let red = 0
  let yellow = 0
  for (const r of inRange) {
    const level = alerts.get(r.id)?.level ?? 'none'
    const day = dayByDate.get(r.date)
    if (day && r.state !== 'deep') day.otherCount++
    if (level === 'red') {
      red++
      if (day) day.red++
    } else if (level === 'yellow') {
      yellow++
      if (day) day.yellow++
    }
    const note = r.note.trim()
    if (level !== 'none' || r.state !== 'deep' || r.signs.length > 0 || note) {
      const parts = [`${STATE_LABEL[r.state]} ${r.rate} 次／分`]
      if (r.signs.length > 0) parts.push(`呼吸費力：${r.signs.map((s) => SIGN_LABEL[s]).join('、')}`)
      if (note) parts.push(`備註：${note}`)
      entries.push({ date: r.date, time: formatTime(r.measuredAt), level, text: parts.join('；') })
    }
  }
  for (const l of logsInRange) {
    const parts: string[] = []
    if (l.activityNote.trim()) parts.push(`活動：${l.activityNote.trim()}`)
    if (l.note.trim()) parts.push(`每日備註：${l.note.trim()}`)
    if (parts.length > 0) entries.push({ date: l.date, time: null, level: 'none', text: parts.join('；') })
  }
  // 照日期、時間排；同一天裡沒有時間的每日備註排最後
  const sortKey = (e: ReportEntry) => `${e.date} ${e.time ?? '99:99'}`
  entries.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0))

  const deepRates = inRange.filter(isCounted).map((r) => r.rate)

  const cough: Record<CoughLevel, number> = { none: 0, few: 0, some: 0, many: 0 }
  const appetite: Record<Appetite, number> = { normal: 0, reduced: 0, none: 0 }
  const energy: Record<Energy, number> = { normal: 0, low: 0, veryLow: 0 }
  for (const l of logsInRange) {
    if (l.cough) cough[l.cough]++
    if (l.appetite) appetite[l.appetite]++
    if (l.energy) energy[l.energy]++
  }

  return {
    pet: settings.pet,
    from,
    to,
    dayCount: days.length,
    generatedOn,
    thresholds: t,
    baseline: currentBaseline(live, to, t),
    deep: {
      count: deepRates.length,
      days: summaries.size,
      median: median(deepRates),
      min: deepRates.length > 0 ? Math.min(...deepRates) : null,
      max: deepRates.length > 0 ? Math.max(...deepRates) : null,
    },
    otherCount: inRange.length - deepRates.length,
    alerts: { red, yellow },
    cough,
    appetite,
    energy,
    days,
    entries,
  }
}

/** 這一天是不是完全沒有紀錄：沒有量呼吸，每日紀錄也什麼都沒填 */
export function isEmptyDay(day: ReportDay): boolean {
  if (day.deep || day.otherCount > 0 || day.red > 0 || day.yellow > 0) return false
  const l = day.log
  if (!l) return true
  return (
    l.cough == null &&
    l.appetite == null &&
    l.energy == null &&
    l.recoveryMin == null &&
    l.water == null &&
    l.urine == null &&
    l.activities.length === 0 &&
    l.activityNote.trim() === '' &&
    l.note.trim() === ''
  )
}

/**
 * 每日表格要畫哪些列。連續 2 天以上完全沒有紀錄，就合成一列「這幾天沒有紀錄」，
 * 不要一天一列全是空白（例如選了 30 天，但其實才開始記錄兩個星期）。
 */
export function reportRows(days: ReportDay[], minGap = 2): ReportRow[] {
  const rows: ReportRow[] = []
  let run: ReportDay[] = []
  const flush = () => {
    if (run.length >= minGap) {
      rows.push({ kind: 'gap', from: run[0].date, to: run[run.length - 1].date, count: run.length })
    } else {
      for (const day of run) rows.push({ kind: 'day', day })
    }
    run = []
  }
  for (const day of days) {
    if (isEmptyDay(day)) {
      run.push(day)
    } else {
      flush()
      rows.push({ kind: 'day', day })
    }
  }
  flush()
  return rows
}

/** 報告的標題，例如「Carbon 呼吸紀錄報告」 */
export function reportTitle(pet: PetProfile): string {
  const name = pet.name.trim()
  return name ? `${name} 呼吸紀錄報告` : '呼吸紀錄報告'
}

/** PDF 的檔名，例如「Carbon-呼吸紀錄報告-2026-09-19_2026-10-02.pdf」 */
export function reportFilename(pet: PetProfile, from: string, to: string): string {
  // 檔名裡不能有 / \ : * ? " < > | 這些字元
  const name = pet.name.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
  return `${name ? `${name}-` : ''}呼吸紀錄報告-${from}_${to}.pdf`
}

/** 把各選項的天數寫成「正常 9 天、變少 1 天」；全部是 0 回傳空字串 */
export function countsText<K extends string>(counts: Record<K, number>, labels: Record<K, string>, order: K[]): string {
  return order
    .filter((k) => counts[k] > 0)
    .map((k) => `${labels[k]} ${counts[k]} 天`)
    .join('、')
}
