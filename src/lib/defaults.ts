import type { Settings } from './types'

/** 預設設定。門檻之後會依獸醫的建議在設定頁調整。 */
export const DEFAULT_SETTINGS: Settings = {
  pet: {
    name: 'Carbon',
    breed: '博美',
    birthday: '',
  },
  thresholds: {
    yellowRate: 30,
    redRate: 40,
    baselinePct: 25,
    baselineDays: 7,
    baselineMinCount: 3,
  },
  contacts: {
    regular: { name: '安可動物醫院', phone: '03-3015232' },
    emergency: { name: '', phone: '' },
  },
  counter: {
    quickTarget: 10,
  },
  weight: {
    baselineKg: null,
    gainAlertKg: 0.2,
  },
}

/** 低於或高於這個範圍的呼吸數，儲存前會先請使用者確認（多半是漏點或多點）。 */
export const PLAUSIBLE_MIN = 8
export const PLAUSIBLE_MAX = 120
