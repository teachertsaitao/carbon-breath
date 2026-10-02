import { DEFAULT_SETTINGS } from './defaults'
import type { Contact, SettingRow, Settings } from './types'

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)

/** 數字要是有限的數、而且落在合理範圍內，否則用預設值 */
const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

function cleanContact(v: unknown, fallback: Contact): Contact {
  const c = obj(v)
  return { name: str(c.name, fallback.name), phone: str(c.phone, fallback.phone) }
}

/**
 * 把（可能不完整、可能有壞值的）設定整理成一份完整、保證合理的設定：
 * 缺的欄位補預設值，型別不對或超出範圍的也換回預設值。
 * 這樣不管資料庫或備份檔裡存了什麼，警示規則拿到的門檻一定是能用的數字。
 */
export function cleanSettings(stored: Partial<Record<keyof Settings, unknown>>): Settings {
  const d = DEFAULT_SETTINGS
  const pet = obj(stored.pet)
  const t = obj(stored.thresholds)
  const contacts = obj(stored.contacts)
  const counter = obj(stored.counter)
  const weight = obj(stored.weight)

  let yellowRate = num(t.yellowRate, d.thresholds.yellowRate, 1, 300)
  let redRate = num(t.redRate, d.thresholds.redRate, 1, 300)
  if (yellowRate >= redRate) {
    // 黃色一定要比紅色低，不然規則會互相矛盾
    yellowRate = d.thresholds.yellowRate
    redRate = d.thresholds.redRate
  }

  return {
    pet: {
      name: str(pet.name, d.pet.name),
      breed: str(pet.breed, d.pet.breed),
      birthday: str(pet.birthday, d.pet.birthday),
    },
    thresholds: {
      yellowRate,
      redRate,
      baselinePct: num(t.baselinePct, d.thresholds.baselinePct, 1, 500),
      baselineDays: Math.round(num(t.baselineDays, d.thresholds.baselineDays, 1, 90)),
      baselineMinCount: Math.round(num(t.baselineMinCount, d.thresholds.baselineMinCount, 1, 100)),
    },
    contacts: {
      regular: cleanContact(contacts.regular, d.contacts.regular),
      emergency: cleanContact(contacts.emergency, d.contacts.emergency),
    },
    counter: {
      quickTarget: Math.round(num(counter.quickTarget, d.counter.quickTarget, 2, 100)),
    },
    weight: {
      baselineKg:
        typeof weight.baselineKg === 'number' && Number.isFinite(weight.baselineKg) && weight.baselineKg > 0
          ? weight.baselineKg
          : d.weight.baselineKg,
      gainAlertKg: num(weight.gainAlertKg, d.weight.gainAlertKg, 0.01, 50),
    },
  }
}

/** 把資料庫裡存的設定（一個區塊一列）整理成完整的設定。沒存過的區塊用預設值。 */
export function mergeSettings(rows: SettingRow[]): Settings {
  const stored: Partial<Record<keyof Settings, unknown>> = {}
  for (const row of rows) stored[row.key] = row.value
  return cleanSettings(stored)
}

/**
 * 取出要撥的號碼：只留主要號碼的數字（和開頭的 +）。
 * 分機（#12、轉 12、分機 12、ext 12）不會接在後面，免得撥到錯的號碼；
 * 一個欄位填了兩支電話（用 / 、或 隔開）時只撥第一支。
 */
export function dialNumber(phone: string): string {
  const main = phone.trim().split(/[#,;/、\n]|轉|分機|ext\.?|或/i)[0]
  const digits = main.replace(/\D/g, '')
  return main.trim().startsWith('+') ? `+${digits}` : digits
}

/** 電話號碼轉成 tel: 連結 */
export function telHref(phone: string): string {
  return `tel:${dialNumber(phone)}`
}

export function hasPhone(phone: string): boolean {
  return dialNumber(phone).replace(/\D/g, '').length >= 3
}
