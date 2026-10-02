import { describe, expect, it, vi } from 'vitest'

// 這裡只測「純邏輯」（檔案檢查、合併規則），不需要真的資料庫
vi.mock('./db', () => ({ db: {} }))

import { backupFilename, fillBlanks, mergeRow, parseBackup } from './backup'
import { DEFAULT_SETTINGS } from './defaults'
import { sanitizeBreath, sanitizeDailyLog, sanitizeSettingRow } from './sanitize'
import { cleanSettings, dialNumber, hasPhone, mergeSettings, telHref } from './settings'
import type { BreathRecord, DailyLog, SettingRow } from './types'

const T1 = '2026-10-01T10:00:00.000Z'
const T2 = '2026-10-02T10:00:00.000Z'

const goodBreath = {
  id: 'b1',
  createdAt: T1,
  updatedAt: T1,
  deletedAt: null,
  deviceId: 'phone-a',
  measuredAt: '2026-10-01T15:30:00.000Z',
  date: '2026-10-01',
  rate: 22,
  mode: 'timed',
  breaths: 11,
  durationSec: 30,
  state: 'deep',
  signs: [],
  note: '',
  recorder: '',
}

function dailyLog(patch: Partial<DailyLog>): DailyLog {
  return {
    id: '2026-10-02',
    date: '2026-10-02',
    createdAt: T1,
    updatedAt: T1,
    deletedAt: null,
    deviceId: 'phone-a',
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
    ...patch,
  }
}

const wrap = (data: object) => JSON.stringify({ app: 'carbon-breath', formatVersion: 1, exportedAt: T2, deviceId: 'x', data })

describe('備份檔檢查：整個檔案', () => {
  it('不是 JSON → 說明原因', () => {
    expect(() => parseBackup('hello')).toThrow('無法讀取')
  })
  it('別的 App 的 JSON → 拒絕', () => {
    expect(() => parseBackup(JSON.stringify({ foo: 1 }))).toThrow('不是這個 App')
  })
  it('比較新的格式 → 請使用者先更新', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'carbon-breath', formatVersion: 2, data: {} }))).toThrow('更新到最新版')
  })
  it('缺少的資料表補成空陣列', () => {
    const { backup, dropped } = parseBackup(wrap({ breaths: [goodBreath] }))
    expect(backup.data.breaths).toHaveLength(1)
    expect(backup.data.dailyLogs).toEqual([])
    expect(backup.data.medLogs).toEqual([])
    expect(dropped).toBe(0)
  })
  it('完整的紀錄原樣通過', () => {
    expect(sanitizeBreath(goodBreath)).toEqual(goodBreath)
  })
})

describe('備份檔檢查：壞掉的列不能進到 App 裡', () => {
  it('缺少必要欄位的呼吸紀錄會被略過，並回報略過幾筆', () => {
    const { rate: _r, ...noRate } = goodBreath
    const { measuredAt: _m, ...noTime } = goodBreath
    const { state: _s, ...noState } = goodBreath
    const text = wrap({
      breaths: [goodBreath, noRate, noTime, noState, null, 'x', { ...goodBreath, id: '' }, { ...goodBreath, updatedAt: 'not a date' }],
    })
    const { backup, dropped } = parseBackup(text)
    expect(backup.data.breaths).toHaveLength(1)
    expect(dropped).toBe(7)
  })

  it('缺少 signs、note 等次要欄位 → 補成空的，不會讓畫面壞掉', () => {
    const { signs: _a, note: _b, recorder: _c, mode: _d, ...partial } = goodBreath
    const r = sanitizeBreath(partial)!
    expect(r.signs).toEqual([])
    expect(r.note).toBe('')
    expect(r.recorder).toBe('')
    expect(r.mode).toBe('manual')
  })

  it('不認得的徵象、狀態會被濾掉或拒絕', () => {
    expect(sanitizeBreath({ ...goodBreath, signs: ['abdominal', 'hacked', 3] })!.signs).toEqual(['abdominal'])
    expect(sanitizeBreath({ ...goodBreath, state: 'sleeping' })).toBeNull()
    expect(sanitizeBreath({ ...goodBreath, rate: 'fast' })).toBeNull()
    expect(sanitizeBreath({ ...goodBreath, rate: Number.NaN })).toBeNull()
  })

  it('日期跟測量時間對不上（例如年份打成 26）→ 用測量時間重算', () => {
    const r = sanitizeBreath({ ...goodBreath, date: '26-10-01' })!
    expect(r.date).toMatch(/^2026-10-0[12]$/)
    const far = sanitizeBreath({ ...goodBreath, date: '2026-03-01' })!
    expect(far.date).toMatch(/^2026-10-0[12]$/)
    // 測量時間本身的年份不合理 → 整筆拒絕
    expect(sanitizeBreath({ ...goodBreath, measuredAt: '0026-10-01T15:30:00.000Z' })).toBeNull()
  })

  it('每日紀錄：缺的欄位補預設值，日期不對的拒絕', () => {
    const log = sanitizeDailyLog({ id: '2026-10-02', date: '2026-10-02', updatedAt: T1, cough: 'few' })!
    expect(log.activities).toEqual([])
    expect(log.activityNote).toBe('')
    expect(log.coughContexts).toEqual([])
    expect(log.note).toBe('')
    expect(log.appetite).toBeNull()
    expect(sanitizeDailyLog({ id: 'abc', updatedAt: T1 })).toBeNull()
    expect(sanitizeDailyLog({ id: '2026-02-30', date: '2026-02-30', updatedAt: T1 })).toBeNull()
  })

  it('每日紀錄：沒有咳嗽就不會留著咳嗽情境', () => {
    const log = sanitizeDailyLog({ id: '2026-10-02', date: '2026-10-02', updatedAt: T1, cough: 'none', coughContexts: ['night'] })!
    expect(log.coughContexts).toEqual([])
  })

  it('設定：壞掉的門檻不會進來（換回預設值）', () => {
    const row = sanitizeSettingRow({ key: 'thresholds', updatedAt: T1, value: { yellowRate: null, redRate: 45, baselinePct: 'x' } })!
    expect(row.value).toEqual({ ...DEFAULT_SETTINGS.thresholds, redRate: 45 })
    expect(sanitizeSettingRow({ key: 'unknown', updatedAt: T1, value: {} })).toBeNull()
    const contacts = sanitizeSettingRow({ key: 'contacts', updatedAt: T1, value: { regular: { name: 5, phone: 12345 } } })!
    expect(contacts.value).toEqual(DEFAULT_SETTINGS.contacts)
  })
})

describe('合併：呼吸紀錄整筆以比較新的為準', () => {
  const older = { ...goodBreath, updatedAt: T1 } as unknown as BreathRecord
  const newer = { ...goodBreath, updatedAt: T2, state: 'light' } as unknown as BreathRecord

  it('手機裡沒有 → 新增', () => {
    expect(mergeRow(undefined, older, 'replace')).toEqual({ action: 'add', row: older })
  })
  it('備份檔比較新 → 更新', () => {
    expect(mergeRow(older, newer, 'replace')).toEqual({ action: 'update', row: newer })
  })
  it('手機裡比較新或一樣 → 不動', () => {
    expect(mergeRow(newer, older, 'replace').action).toBe('skip')
    expect(mergeRow(newer, newer, 'replace').action).toBe('skip')
  })
  it('刪除會傳過去；舊的備份不會讓已刪除的紀錄復活', () => {
    const deleted = { ...older, deletedAt: T2, updatedAt: T2 }
    expect(mergeRow(older, deleted, 'replace').row.deletedAt).toBe(T2)
    expect(mergeRow(deleted, older, 'replace').action).toBe('skip')
  })
})

describe('合併：每日紀錄逐欄補上（兩個人各填一部分）', () => {
  const a = dailyLog({ updatedAt: T1, deviceId: 'phone-a', cough: 'few', coughContexts: ['night'], note: 'A 的備註' })
  const b = dailyLog({ updatedAt: T2, deviceId: 'phone-b', appetite: 'reduced', activities: ['散步'], recoveryMin: 0 })

  it('B 匯入 A：B 自己填的保留，A 填的咳嗽補進來', () => {
    const { action, row } = mergeRow(b, a, 'fill')
    expect(action).toBe('update')
    expect(row).toMatchObject({
      cough: 'few',
      coughContexts: ['night'],
      appetite: 'reduced',
      activities: ['散步'],
      recoveryMin: 0,
      note: 'A 的備註',
      updatedAt: T2,
      deviceId: 'phone-b',
    })
  })

  it('A 匯入 B：結果跟上面一模一樣（兩支手機最後會一致）', () => {
    expect(mergeRow(a, b, 'fill').row).toEqual(mergeRow(b, a, 'fill').row)
  })

  it('合併完再匯入一次 → 沒有變化', () => {
    const merged = mergeRow(b, a, 'fill').row
    expect(mergeRow(merged, a, 'fill').action).toBe('skip')
    expect(mergeRow(merged, b, 'fill').action).toBe('skip')
    expect(mergeRow(merged, merged, 'fill').action).toBe('skip')
  })

  it('兩邊都填了同一欄 → 以比較新的為準', () => {
    const a2 = dailyLog({ updatedAt: T1, appetite: 'normal', energy: 'low' })
    const b2 = dailyLog({ updatedAt: T2, appetite: 'none' })
    expect(mergeRow(a2, b2, 'fill').row).toMatchObject({ appetite: 'none', energy: 'low' })
  })

  it('比較新的那邊填「0 次咳嗽」→ 不會被舊的咳嗽情境補回來', () => {
    const older = dailyLog({ updatedAt: T1, cough: 'some', coughContexts: ['night', 'excited'] })
    const newer = dailyLog({ updatedAt: T2, cough: 'none' })
    expect(mergeRow(older, newer, 'fill').row).toMatchObject({ cough: 'none', coughContexts: [] })
  })
})

describe('合併：設定也是逐欄補上', () => {
  const contacts = (updatedAt: string, value: object): SettingRow =>
    ({ key: 'contacts', updatedAt, deviceId: 'x', value }) as unknown as SettingRow

  it('一支手機填了急診電話、另一支後來改了醫院名稱 → 兩個都留著', () => {
    const a = contacts(T1, { regular: { name: '安可動物醫院', phone: '03-3015232' }, emergency: { name: '急診', phone: '03-1112222' } })
    const b = contacts(T2, { regular: { name: '安可（新名稱）', phone: '03-3015232' }, emergency: { name: '', phone: '' } })
    const expected = { regular: { name: '安可（新名稱）', phone: '03-3015232' }, emergency: { name: '急診', phone: '03-1112222' } }
    expect(mergeRow(a, b, 'fill').row.value).toEqual(expected)
    expect(mergeRow(b, a, 'fill').row.value).toEqual(expected)
  })

  it('門檻是成組的數字，整組跟著比較新的那邊', () => {
    const row = (updatedAt: string, yellowRate: number, redRate: number): SettingRow =>
      ({ key: 'thresholds', updatedAt, deviceId: 'x', value: { ...DEFAULT_SETTINGS.thresholds, yellowRate, redRate } }) as SettingRow
    expect(mergeRow(row(T1, 30, 40), row(T2, 35, 45), 'fill').row.value).toMatchObject({ yellowRate: 35, redRate: 45 })
    expect(mergeRow(row(T2, 35, 45), row(T1, 30, 40), 'fill').action).toBe('skip')
  })

  it('fillBlanks：null、空字串、空陣列算沒填；0 算有填', () => {
    expect(fillBlanks({ a: null, b: '', c: [], d: 0, e: 'x' }, { a: 1, b: 'y', c: [2], d: 9, e: 'z' })).toEqual({
      a: 1,
      b: 'y',
      c: [2],
      d: 0,
      e: 'x',
    })
  })
})

describe('設定的整理', () => {
  it('沒存過的項目用預設值，存過的蓋上去；舊版資料缺的欄位自動補上', () => {
    const s = mergeSettings([
      { key: 'thresholds', value: { yellowRate: 35, redRate: 45 } as never, updatedAt: '', deviceId: '' },
      {
        key: 'contacts',
        value: { regular: { name: '安可動物醫院', phone: '03-3015232' }, emergency: { name: '急診', phone: '03-1234567' } },
        updatedAt: '',
        deviceId: '',
      },
    ])
    expect(s.thresholds).toEqual({ yellowRate: 35, redRate: 45, baselinePct: 25, baselineDays: 7, baselineMinCount: 3 })
    expect(s.contacts.emergency.phone).toBe('03-1234567')
    expect(s.pet.name).toBe('Carbon')
    expect(s.counter.quickTarget).toBe(10)
  })

  it('壞掉的門檻（null、0、NaN、黃色 ≥ 紅色）不會讓警示規則失靈', () => {
    const d = DEFAULT_SETTINGS.thresholds
    expect(cleanSettings({ thresholds: { yellowRate: null, redRate: Number.NaN, baselinePct: 0, baselineDays: 0, baselineMinCount: -1 } }).thresholds).toEqual(d)
    expect(cleanSettings({ thresholds: { yellowRate: 50, redRate: 40 } }).thresholds).toMatchObject({ yellowRate: 30, redRate: 40 })
    expect(cleanSettings({ thresholds: 'oops' }).thresholds).toEqual(d)
    expect(cleanSettings({}).thresholds).toEqual(d)
  })

  it('使用者把醫院名稱清空 → 尊重使用者，不會被預設值蓋回來', () => {
    const s = cleanSettings({ contacts: { regular: { name: '', phone: '' }, emergency: { name: '', phone: '' } } })
    expect(s.contacts.regular).toEqual({ name: '', phone: '' })
  })
})

describe('電話', () => {
  it('轉成撥號連結', () => {
    expect(telHref('03-3015232')).toBe('tel:033015232')
    expect(telHref(' (02) 2345 6789 ')).toBe('tel:0223456789')
    expect(telHref('+886 3 301 5232')).toBe('tel:+88633015232')
  })
  it('分機不會接在號碼後面', () => {
    expect(dialNumber('03-3015232 #12')).toBe('033015232')
    expect(dialNumber('03-3015232轉12')).toBe('033015232')
    expect(dialNumber('03-3015232 分機 12')).toBe('033015232')
    expect(dialNumber('03-3015232 ext. 12')).toBe('033015232')
  })
  it('一欄填了兩支電話 → 只撥第一支', () => {
    expect(dialNumber('03-3015232 / 0912-345-678')).toBe('033015232')
    expect(dialNumber('03-3015232、0912345678')).toBe('033015232')
    expect(dialNumber('03-3015232 或 0912345678')).toBe('033015232')
  })
  it('有沒有填電話', () => {
    expect(hasPhone('')).toBe(false)
    expect(hasPhone('還沒填')).toBe(false)
    expect(hasPhone('110')).toBe(true)
  })
})

describe('其他', () => {
  it('備份檔名帶日期', () => {
    expect(backupFilename(new Date(2026, 9, 2))).toBe('carbon-breath-backup-2026-10-02.json')
  })
})
