// 資料庫（IndexedDB，透過 Dexie）。資料全部存在這支手機的瀏覽器裡，沒有上傳到任何地方。

import Dexie, { type EntityTable } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { toDateKey } from './dates'
import { DEFAULT_SETTINGS } from './defaults'
import { getDeviceId, getPref, newId } from './device'
import { mergeSettings } from './settings'
import type {
  BreathRecord,
  CountMode,
  DailyLog,
  EffortSign,
  MedLog,
  Medication,
  SettingKey,
  SettingRow,
  Settings,
  SleepState,
  SyncFields,
  WeightRecord,
} from './types'

export type AppDB = Dexie & {
  breaths: EntityTable<BreathRecord, 'id'>
  dailyLogs: EntityTable<DailyLog, 'id'>
  settings: EntityTable<SettingRow, 'key'>
  weights: EntityTable<WeightRecord, 'id'>
  medications: EntityTable<Medication, 'id'>
  medLogs: EntityTable<MedLog, 'id'>
}

export const db = new Dexie('carbon-breath') as AppDB

// 第一個欄位是主鍵，後面是要建索引的欄位（不是全部欄位）。
// 之後要加欄位不用改這裡；要加「資料表」或「索引」才需要 db.version(2)。
db.version(1).stores({
  breaths: 'id, measuredAt, date, updatedAt',
  dailyLogs: 'id, date, updatedAt',
  settings: 'key, updatedAt',
  weights: 'id, date, updatedAt',
  medications: 'id, updatedAt',
  medLogs: 'id, date, updatedAt',
})

// 一開始就把資料庫打開；打不開（例如無痕模式不允許儲存）就記下原因，讓畫面顯示說明
let openError: string | null = null
const openErrorListeners = new Set<() => void>()
if (typeof indexedDB !== 'undefined') {
  db.open().catch((err: unknown) => {
    openError = err instanceof Error ? err.message : String(err)
    openErrorListeners.forEach((fn) => fn())
  })
}
const subscribeOpenError = (fn: () => void) => {
  openErrorListeners.add(fn)
  return () => {
    openErrorListeners.delete(fn)
  }
}

/** 資料庫打不開時回傳錯誤訊息，正常時是 null。 */
export function useDbError(): string | null {
  return useSyncExternalStore(subscribeOpenError, () => openError)
}

const nowIso = () => new Date().toISOString()

// ── 呼吸紀錄 ────────────────────────────────────────

export interface BreathInput {
  measuredAt: Date
  rate: number
  mode: CountMode
  breaths: number | null
  durationSec: number | null
  state: SleepState
  signs: EffortSign[]
  note: string
}

/** 新增一筆呼吸紀錄。只存量到的內容；警示燈號是顯示時才用目前的門檻現算，不存。 */
export async function addBreath(input: BreathInput): Promise<BreathRecord> {
  const now = nowIso()
  const record: BreathRecord = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deviceId: getDeviceId(),
    measuredAt: input.measuredAt.toISOString(),
    date: toDateKey(input.measuredAt),
    rate: input.rate,
    mode: input.mode,
    breaths: input.breaths,
    durationSec: input.durationSec,
    state: input.state,
    signs: input.signs,
    note: input.note.trim(),
    recorder: getPref('recorder').trim(),
  }
  await db.breaths.add(record)
  return record
}

export type BreathPatch = Partial<Pick<BreathInput, 'measuredAt' | 'rate' | 'state' | 'signs' | 'note'>>

/** 修改紀錄（例如狀態選錯了）。 */
export async function updateBreath(id: string, patch: BreathPatch): Promise<BreathRecord> {
  const existing = await db.breaths.get(id)
  if (!existing) throw new Error('找不到這筆紀錄')
  const next: BreathRecord = {
    ...existing,
    // 沒有改測量時間就沿用原本的日期（不因為手機換了時區而變動）
    measuredAt: patch.measuredAt ? patch.measuredAt.toISOString() : existing.measuredAt,
    date: patch.measuredAt ? toDateKey(patch.measuredAt) : existing.date,
    rate: patch.rate ?? existing.rate,
    state: patch.state ?? existing.state,
    signs: patch.signs ?? existing.signs,
    note: (patch.note ?? existing.note).trim(),
    updatedAt: nowIso(),
  }
  await db.breaths.put(next)
  return next
}

/** 刪除只做標記（deletedAt），不真的移除，之後同步或合併時對方才知道這筆被刪了。 */
export async function deleteBreath(id: string): Promise<void> {
  const now = nowIso()
  await db.breaths.update(id, { deletedAt: now, updatedAt: now })
}

export async function restoreBreath(id: string): Promise<void> {
  await db.breaths.update(id, { deletedAt: null, updatedAt: nowIso() })
}

/** 所有沒被刪除的呼吸紀錄，由舊到新。資料還在讀取時回傳 undefined。 */
export function useBreaths(): BreathRecord[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.breaths.orderBy('measuredAt').toArray()
    return all.filter((r) => !r.deletedAt)
  }, [])
}

// ── 每日紀錄 ────────────────────────────────────────

export type DailyFields = Omit<DailyLog, keyof SyncFields | 'date'>

export function emptyDailyFields(): DailyFields {
  return {
    cough: null,
    coughContexts: [],
    appetite: null,
    energy: null,
    activities: [],
    activityNote: '',
    recoveryMin: null,
    water: null,
    urine: null,
    note: '',
  }
}

/** 每日紀錄一天一筆，改到哪個欄位就存哪個欄位。 */
export async function saveDailyLog(date: string, patch: Partial<DailyFields>): Promise<void> {
  await db.transaction('rw', db.dailyLogs, async () => {
    const existing = await db.dailyLogs.get(date)
    const now = nowIso()
    const base: DailyLog = existing ?? {
      id: date,
      date,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deviceId: getDeviceId(),
      ...emptyDailyFields(),
    }
    await db.dailyLogs.put({
      ...base,
      ...patch,
      deletedAt: null,
      updatedAt: now,
      deviceId: getDeviceId(),
    })
  })
}

/** 這一天填了幾項（咳嗽、食慾、精神、活動、喝水、排尿、備註） */
export function dailyFilledCount(log: DailyLog | undefined): number {
  if (!log || log.deletedAt) return 0
  return [
    log.cough != null,
    log.appetite != null,
    log.energy != null,
    log.activities.length > 0 || log.activityNote.trim() !== '' || log.recoveryMin != null,
    log.water != null,
    log.urine != null,
    log.note.trim() !== '',
  ].filter(Boolean).length
}

export function useDailyLogs(): DailyLog[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.dailyLogs.orderBy('date').toArray()
    return all.filter((l) => !l.deletedAt)
  }, [])
}

// ── 設定 ────────────────────────────────────────────

export async function saveSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
  const row: SettingRow = { key, value, updatedAt: nowIso(), deviceId: getDeviceId() }
  await db.settings.put(row)
}

export async function resetSetting(key: SettingKey): Promise<void> {
  await saveSetting(key, DEFAULT_SETTINGS[key])
}

/** 目前的設定。資料還在讀取時回傳 undefined。 */
export function useSettings(): Settings | undefined {
  return useLiveQuery(async () => mergeSettings(await db.settings.toArray()), [])
}
