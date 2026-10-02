// 畫面上顯示的文字（選項名稱、警示說明）。要改用詞改這裡就好。

import { formatRate } from './stats'
import type {
  AlertResult,
  Amount,
  Appetite,
  BreathRecord,
  CoughContext,
  CoughLevel,
  EffortSign,
  Energy,
  SleepState,
} from './types'

export const STATE_LABEL: Record<SleepState, string> = {
  deep: '熟睡',
  light: '淺眠',
  awake: '清醒休息',
}
export const STATES: SleepState[] = ['deep', 'light', 'awake']

export const SIGN_LABEL: Record<EffortSign, string> = {
  openMouth: '休息時張嘴喘',
  abdominal: '肚子用力呼吸',
  sitting: '坐著不肯躺下',
  gums: '牙齦發紫或發白',
}
export const SIGNS: EffortSign[] = ['openMouth', 'abdominal', 'sitting', 'gums']

export const COUGH_LABEL: Record<CoughLevel, string> = {
  none: '0 次',
  few: '1–3 次',
  some: '4–10 次',
  many: '10 次以上',
}
export const COUGH_LEVELS: CoughLevel[] = ['none', 'few', 'some', 'many']

export const COUGH_CONTEXT_LABEL: Record<CoughContext, string> = {
  night: '晚上',
  excited: '興奮時',
  afterDrink: '喝水後',
  other: '其他',
}
export const COUGH_CONTEXTS: CoughContext[] = ['night', 'excited', 'afterDrink', 'other']

export const APPETITE_LABEL: Record<Appetite, string> = { normal: '正常', reduced: '變少', none: '不吃' }
export const APPETITES: Appetite[] = ['normal', 'reduced', 'none']

export const ENERGY_LABEL: Record<Energy, string> = { normal: '正常', low: '較差', veryLow: '很差' }
export const ENERGIES: Energy[] = ['normal', 'low', 'veryLow']

export const AMOUNT_LABEL: Record<Amount, string> = { normal: '正常', more: '變多', less: '變少' }
export const AMOUNTS: Amount[] = ['normal', 'more', 'less']

export const ACTIVITY_PRESETS = ['散步', '玩耍', '舔人']

export const MODE_LABEL = { timed: '計時', quick: '快速', manual: '手動補登' } as const

/** 免責說明，首頁、說明頁、設定頁都會顯示同一段。 */
export const DISCLAIMER = '這個 App 只是紀錄工具，不能取代獸醫師的判斷。有任何疑慮請直接聯絡醫師。'

export const YELLOW_ADVICE = '隔 10 到 15 分鐘再量一次；持續偏高請聯絡醫師。'
export const RED_ADVICE = '請立即聯絡醫師或前往急診。'

export interface AlertText {
  title: string
  advice: string
  reasons: string[]
}

/** 把一筆紀錄的警示結果寫成給人看的文字。 */
export function describeAlert(r: Pick<BreathRecord, 'rate' | 'state' | 'signs'>, a: AlertResult): AlertText {
  const reasons: string[] = []

  for (const reason of a.reasons) {
    if (reason === 'signs') {
      reasons.push(`有呼吸費力的徵象：${r.signs.map((s) => SIGN_LABEL[s]).join('、')}`)
    } else if (reason === 'rateRed') {
      reasons.push(`熟睡時每分鐘 ${r.rate} 次，達到紅色門檻（${a.redRate} 次以上）`)
    } else if (reason === 'rateYellow') {
      reasons.push(`熟睡時每分鐘 ${r.rate} 次，達到黃色門檻（${a.yellowRate} 次以上）`)
    } else if (reason === 'aboveBaseline' && a.baseline != null) {
      const pct = Math.round((r.rate / a.baseline - 1) * 100)
      reasons.push(`比基準值 ${formatRate(a.baseline)} 高了 ${pct}%（高出 ${a.baselinePct}% 以上就會提醒）`)
    }
  }

  if (a.level === 'red') return { title: '請立即聯絡醫師或前往急診', advice: '', reasons }
  if (a.level === 'yellow') return { title: '呼吸偏快，等一下再量一次', advice: YELLOW_ADVICE, reasons }

  if (r.state !== 'deep') {
    return {
      title: '這筆不列入基準值',
      advice: `「${STATE_LABEL[r.state]}」時量的紀錄會照樣保留，但不會用來算基準值，也不會用呼吸數判斷警示。`,
      reasons,
    }
  }
  return {
    title: '在正常範圍內',
    advice:
      a.baseline != null
        ? `這次每分鐘 ${r.rate} 次，基準值是 ${formatRate(a.baseline)}。`
        : `這次每分鐘 ${r.rate} 次。`,
    reasons,
  }
}
