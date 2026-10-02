// 匯入備份檔時，逐列檢查並整理資料。
// 畫面上的程式都假設資料是完整的（例如 signs 一定是陣列），所以外面進來的資料要先過這一關：
// 缺了必要欄位的列直接丟掉，其他欄位型別不對的補成安全的預設值。

import { isDateKey, toDateKey } from './dates'
import { cleanSettings } from './settings'
import type {
  Amount,
  Appetite,
  BreathRecord,
  CoughContext,
  CoughLevel,
  CountMode,
  DailyLog,
  EffortSign,
  Energy,
  MedLog,
  Medication,
  SettingKey,
  SettingRow,
  SleepState,
  SyncFields,
  WeightRecord,
} from './types'

type Raw = Record<string, unknown>

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 合法的時間字串 → 統一成 ISO（UTC）格式；不合法回傳 null */
function isoTime(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null
  const ms = Date.parse(v)
  if (!Number.isFinite(ms)) return null
  const year = new Date(ms).getUTCFullYear()
  return year >= 2000 && year <= 2200 ? new Date(ms).toISOString() : null
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null
}

function listOf<T extends string>(v: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(v)) return []
  return allowed.filter((a) => v.includes(a))
}

const STATES: readonly SleepState[] = ['deep', 'light', 'awake']
const MODES: readonly CountMode[] = ['timed', 'quick', 'manual']
const SIGNS: readonly EffortSign[] = ['openMouth', 'abdominal', 'sitting', 'gums']
const COUGHS: readonly CoughLevel[] = ['none', 'few', 'some', 'many']
const CONTEXTS: readonly CoughContext[] = ['night', 'excited', 'afterDrink', 'other']
const APPETITES: readonly Appetite[] = ['normal', 'reduced', 'none']
const ENERGIES: readonly Energy[] = ['normal', 'low', 'veryLow']
const AMOUNTS: readonly Amount[] = ['normal', 'more', 'less']
const SETTING_KEYS: readonly SettingKey[] = ['pet', 'thresholds', 'contacts', 'counter', 'weight']

/** 每一筆資料都有的欄位；id 或 updatedAt 不對就回傳 null */
function syncFields(row: Raw): SyncFields | null {
  const id = text(row.id)
  const updatedAt = isoTime(row.updatedAt)
  if (!id || !updatedAt) return null
  return {
    id,
    updatedAt,
    createdAt: isoTime(row.createdAt) ?? updatedAt,
    deletedAt: isoTime(row.deletedAt),
    deviceId: text(row.deviceId),
  }
}

export function sanitizeBreath(raw: unknown): BreathRecord | null {
  if (!isObject(raw)) return null
  const sync = syncFields(raw)
  const measuredAt = isoTime(raw.measuredAt)
  const state = oneOf(raw.state, STATES)
  if (!sync || !measuredAt || !state) return null
  if (!finite(raw.rate) || raw.rate < 0 || raw.rate > 999) return null

  // 日期要跟測量時間對得上（不同時區最多差一天），否則用測量時間重算
  const fromTime = toDateKey(new Date(measuredAt))
  const dateOk =
    isDateKey(raw.date) &&
    Math.abs(Date.parse(`${raw.date}T12:00:00Z`) - Date.parse(`${measuredAt.slice(0, 10)}T12:00:00Z`)) <=
      86_400_000

  return {
    ...sync,
    measuredAt,
    date: dateOk ? (raw.date as string) : fromTime,
    rate: Math.round(raw.rate),
    mode: oneOf(raw.mode, MODES) ?? 'manual',
    breaths: finite(raw.breaths) ? raw.breaths : null,
    durationSec: finite(raw.durationSec) ? raw.durationSec : null,
    state,
    signs: listOf(raw.signs, SIGNS),
    note: text(raw.note),
    recorder: text(raw.recorder),
  }
}

/** 每日紀錄裡互相有關的欄位要一致：沒有咳嗽就不會有咳嗽情境 */
export function normalizeDailyLog(log: DailyLog): DailyLog {
  if (log.cough == null || log.cough === 'none') return { ...log, coughContexts: [] }
  return log
}

export function sanitizeDailyLog(raw: unknown): DailyLog | null {
  if (!isObject(raw)) return null
  const sync = syncFields(raw)
  if (!sync) return null
  // 每日紀錄的 id 就是日期
  const date = isDateKey(raw.date) ? raw.date : isDateKey(raw.id) ? raw.id : null
  if (!date) return null
  const recovery = finite(raw.recoveryMin) && raw.recoveryMin >= 0 && raw.recoveryMin <= 600 ? raw.recoveryMin : null

  return normalizeDailyLog({
    ...sync,
    id: date,
    date,
    cough: oneOf(raw.cough, COUGHS),
    coughContexts: listOf(raw.coughContexts, CONTEXTS),
    appetite: oneOf(raw.appetite, APPETITES),
    energy: oneOf(raw.energy, ENERGIES),
    activities: Array.isArray(raw.activities)
      ? raw.activities.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
      : [],
    activityNote: text(raw.activityNote),
    recoveryMin: recovery,
    water: oneOf(raw.water, AMOUNTS),
    urine: oneOf(raw.urine, AMOUNTS),
    note: text(raw.note),
  })
}

export function sanitizeSettingRow(raw: unknown): SettingRow | null {
  if (!isObject(raw)) return null
  const key = oneOf(raw.key, SETTING_KEYS)
  const updatedAt = isoTime(raw.updatedAt)
  if (!key || !updatedAt || !isObject(raw.value)) return null
  // 借用設定的整理規則：只整理這一個區塊，型別不對或超出範圍的欄位換回預設值
  const value = cleanSettings({ [key]: raw.value })[key]
  return { key, value, updatedAt, deviceId: text(raw.deviceId) } as SettingRow
}

export function sanitizeWeight(raw: unknown): WeightRecord | null {
  if (!isObject(raw)) return null
  const sync = syncFields(raw)
  const measuredAt = isoTime(raw.measuredAt)
  if (!sync || !measuredAt || !finite(raw.kg) || raw.kg <= 0 || raw.kg > 200) return null
  return {
    ...sync,
    measuredAt,
    date: isDateKey(raw.date) ? raw.date : toDateKey(new Date(measuredAt)),
    kg: raw.kg,
    note: text(raw.note),
  }
}

export function sanitizeMedication(raw: unknown): Medication | null {
  if (!isObject(raw)) return null
  const sync = syncFields(raw)
  const name = text(raw.name).trim()
  if (!sync || !name) return null
  return {
    ...sync,
    name,
    dose: text(raw.dose),
    slots: Array.isArray(raw.slots) ? raw.slots.filter((s): s is string => typeof s === 'string' && s !== '') : [],
    active: raw.active !== false,
    sortOrder: finite(raw.sortOrder) ? raw.sortOrder : 0,
  }
}

export function sanitizeMedLog(raw: unknown): MedLog | null {
  if (!isObject(raw)) return null
  const sync = syncFields(raw)
  const givenAt = isoTime(raw.givenAt)
  const medicationId = text(raw.medicationId)
  const slot = text(raw.slot)
  if (!sync || !givenAt || !medicationId || !slot || !isDateKey(raw.date)) return null
  return { ...sync, date: raw.date, medicationId, slot, givenAt }
}
