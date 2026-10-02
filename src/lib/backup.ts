// 備份：把所有資料匯出成一個 JSON 檔，或從 JSON 檔匯入。
// 匯入是「合併」不是「覆蓋」，所以也能用來把兩支手機的紀錄併在一起。

import type { Table } from 'dexie'
import { toDateKey } from './dates'
import { db } from './db'
import { getDeviceId, setPref } from './device'
import { canShareFile, downloadFile, shareFile } from './files'
import {
  normalizeDailyLog,
  sanitizeBreath,
  sanitizeDailyLog,
  sanitizeMedLog,
  sanitizeMedication,
  sanitizeSettingRow,
  sanitizeWeight,
} from './sanitize'
import type { BackupFile, DailyLog } from './types'

const TABLES = ['breaths', 'dailyLogs', 'settings', 'weights', 'medications', 'medLogs'] as const
type TableName = (typeof TABLES)[number]

const PRIMARY_KEY: Record<TableName, 'id' | 'key'> = {
  breaths: 'id',
  dailyLogs: 'id',
  settings: 'key',
  weights: 'id',
  medications: 'id',
  medLogs: 'id',
}

const SANITIZE: Record<TableName, (raw: unknown) => object | null> = {
  breaths: sanitizeBreath,
  dailyLogs: sanitizeDailyLog,
  settings: sanitizeSettingRow,
  weights: sanitizeWeight,
  medications: sanitizeMedication,
  medLogs: sanitizeMedLog,
}

/**
 * 兩邊都有同一筆時怎麼合併：
 * - replace：整筆以比較新的為準（一次測量是一個人在一個時間點記的，不會兩邊各改一半）
 * - fill：以比較新的為主，但它沒填的欄位用另一邊的補上
 *   （每日紀錄可能一個人填咳嗽、另一個人填食慾；設定可能一支手機填了急診電話、另一支改了醫院名稱）
 */
const MERGE_MODE: Record<TableName, 'replace' | 'fill'> = {
  breaths: 'replace',
  dailyLogs: 'fill',
  settings: 'fill',
  weights: 'replace',
  medications: 'replace',
  medLogs: 'replace',
}

// ── 匯出 ────────────────────────────────────────────

export async function buildBackup(now: Date = new Date()): Promise<BackupFile> {
  // 已刪除的紀錄（deletedAt 有值）也一起匯出，合併時另一支手機才會知道這筆被刪了
  const [breaths, dailyLogs, settings, weights, medications, medLogs] = await Promise.all([
    db.breaths.toArray(),
    db.dailyLogs.toArray(),
    db.settings.toArray(),
    db.weights.toArray(),
    db.medications.toArray(),
    db.medLogs.toArray(),
  ])
  return {
    app: 'carbon-breath',
    formatVersion: 1,
    exportedAt: now.toISOString(),
    deviceId: getDeviceId(),
    data: { breaths, dailyLogs, settings, weights, medications, medLogs },
  }
}

export function backupFilename(now: Date = new Date()): string {
  return `carbon-breath-backup-${toDateKey(now)}.json`
}

/** 把目前所有資料包成一個備份檔（還沒送出去） */
export async function buildBackupFile(now: Date = new Date()): Promise<File> {
  const text = JSON.stringify(await buildBackup(now), null, 2)
  return new File([text], backupFilename(now), { type: 'application/json' })
}

export type ExportResult = 'shared' | 'downloaded' | 'cancelled'

/**
 * 把備份檔交給使用者。手機上優先用系統的分享選單（可以存到檔案、傳 LINE、AirDrop），不行就直接下載。
 *
 * 注意：瀏覽器規定「分享」必須緊接在使用者的點擊之後呼叫，中間不能先等別的事情做完。
 * 所以呼叫這個函式之前要先把檔案準備好（設定頁會在畫面一出現就先準備）。
 */
export async function deliverBackupFile(file: File): Promise<ExportResult> {
  if (canShareFile(file)) {
    const result = await shareFile(file)
    if (result === 'cancelled') return 'cancelled'
    if (result === 'shared') {
      setPref('lastExportAt', new Date().toISOString())
      return 'shared'
    }
    // 分享失敗就改用下載
  }
  downloadFile(file)
  setPref('lastExportAt', new Date().toISOString())
  return 'downloaded'
}

/** 匯出備份檔（現做現送）。出錯畫面等沒辦法事先準備檔案的地方用。 */
export async function exportBackup(): Promise<ExportResult> {
  return deliverBackupFile(await buildBackupFile())
}

// ── 匯入 ────────────────────────────────────────────

export interface ParsedBackup {
  backup: BackupFile
  /** 格式不對、被略過的列數 */
  dropped: number
}

/** 讀取並檢查備份檔內容；整個檔案不對會丟出中文錯誤訊息，個別壞掉的列會被略過。 */
export function parseBackup(text: string): ParsedBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('這個檔案不是有效的備份檔（無法讀取內容）。')
  }
  const file = parsed as Partial<BackupFile> | null
  if (!file || typeof file !== 'object' || file.app !== 'carbon-breath') {
    throw new Error('這個檔案不是這個 App 的備份檔。')
  }
  if (file.formatVersion !== 1) {
    throw new Error('這個備份檔是比較新的版本匯出的，請先把 App 更新到最新版再匯入。')
  }
  if (!file.data || typeof file.data !== 'object') {
    throw new Error('備份檔裡沒有資料。')
  }

  const data = file.data as Record<string, unknown>
  const clean: Record<string, object[]> = {}
  let dropped = 0
  for (const name of TABLES) {
    const rows = Array.isArray(data[name]) ? (data[name] as unknown[]) : []
    clean[name] = []
    for (const raw of rows) {
      const row = SANITIZE[name](raw)
      if (row) clean[name].push(row)
      else dropped++
    }
  }

  return {
    backup: {
      app: 'carbon-breath',
      formatVersion: 1,
      exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '',
      deviceId: typeof file.deviceId === 'string' ? file.deviceId : '',
      data: clean as unknown as BackupFile['data'],
    },
    dropped,
  }
}

const isBlank = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0)
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 以 newer 為主；newer 沒填的欄位（null、空字串、空陣列）用 older 的補上。巢狀的物件逐層處理。 */
export function fillBlanks<T>(newer: T, older: T): T {
  if (!isPlainObject(newer) || !isPlainObject(older)) return isBlank(newer) ? older : newer
  const out: Record<string, unknown> = { ...newer }
  for (const key of Object.keys(older)) {
    out[key] = key in newer ? fillBlanks(newer[key], older[key]) : older[key]
  }
  return out as T
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) if (!deepEqual(a[k], b[k])) return false
    return true
  }
  return false
}

/** 這些欄位描述的是「這一列本身」，不參與逐欄補空，一律跟著比較新的那一邊 */
const META_FIELDS = ['id', 'key', 'date', 'createdAt', 'updatedAt', 'deletedAt', 'deviceId']

export type MergeAction = 'add' | 'update' | 'skip'

type Row = { updatedAt: string }

/**
 * 決定一列資料合併之後的樣子。
 * 回傳 action：add＝手機裡沒有，新增；update＝內容有變，要寫入；skip＝手機裡的已經包含這些內容。
 */
export function mergeRow<T extends Row>(
  existing: T | undefined,
  incoming: T,
  mode: 'replace' | 'fill',
): { action: MergeAction; row: T } {
  if (!existing) return { action: 'add', row: incoming }

  const incomingIsNewer = incoming.updatedAt > existing.updatedAt
  if (mode === 'replace') {
    return incomingIsNewer ? { action: 'update', row: incoming } : { action: 'skip', row: existing }
  }

  const newer = incomingIsNewer ? incoming : existing
  const older = incomingIsNewer ? existing : incoming
  const merged = fillBlanks(newer, older) as Record<string, unknown>
  for (const field of META_FIELDS) {
    if (field in (newer as object)) merged[field] = (newer as Record<string, unknown>)[field]
  }
  let row = merged as unknown as T
  if ('coughContexts' in merged) row = normalizeDailyLog(merged as unknown as DailyLog) as unknown as T

  return deepEqual(row, existing) ? { action: 'skip', row: existing } : { action: 'update', row }
}

export interface ImportResult {
  added: number
  updated: number
  skipped: number
}

/** 把備份檔合併進手機裡的資料。 */
export async function importBackup(file: BackupFile): Promise<ImportResult> {
  const result: ImportResult = { added: 0, updated: 0, skipped: 0 }
  const tables = TABLES.map((name) => db[name])

  await db.transaction('rw', tables, async () => {
    for (const name of TABLES) {
      const pk = PRIMARY_KEY[name]
      const table = db[name] as unknown as Table<Row, string>
      for (const incoming of file.data[name] as unknown as Row[]) {
        const key = (incoming as unknown as Record<string, string>)[pk]
        const { action, row } = mergeRow(await table.get(key), incoming, MERGE_MODE[name])
        if (action === 'skip') {
          result.skipped++
          continue
        }
        await table.put(row)
        if (action === 'add') result.added++
        else result.updated++
      }
    }
  })
  return result
}
