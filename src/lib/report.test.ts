import { describe, expect, it } from 'vitest'
import { ageText, formatDateFull, formatDateWeekday, parseDateKey } from './dates'
import { DEFAULT_SETTINGS } from './defaults'
import { APPETITE_LABEL, APPETITES, COUGH_LABEL, COUGH_LEVELS } from './labels'
import { buildPdf } from './pdf'
import {
  buildReport,
  checkReportRange,
  countsText,
  isEmptyDay,
  reportFilename,
  reportRows,
  reportTitle,
  REPORT_MAX_DAYS,
} from './report'
import type { BreathRecord, DailyLog, EffortSign, SleepState } from './types'

let seq = 0
function rec(
  date: string,
  time: string,
  rate: number,
  opts: { state?: SleepState; signs?: EffortSign[]; note?: string; deleted?: boolean } = {},
): BreathRecord {
  const [h, m] = time.split(':').map(Number)
  const d = parseDateKey(date)
  d.setHours(h, m, 0, 0)
  const iso = d.toISOString()
  return {
    id: `r${++seq}`,
    createdAt: iso,
    updatedAt: iso,
    deletedAt: opts.deleted ? iso : null,
    deviceId: 'test',
    measuredAt: iso,
    date,
    rate,
    mode: 'timed',
    breaths: rate / 2,
    durationSec: 30,
    state: opts.state ?? 'deep',
    signs: opts.signs ?? [],
    note: opts.note ?? '',
    recorder: '',
  }
}

function log(date: string, patch: Partial<DailyLog>): DailyLog {
  return {
    id: date,
    date,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    deviceId: 'test',
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

const S = DEFAULT_SETTINGS

describe('報告的日期範圍', () => {
  const today = '2026-10-10'
  it('正常的範圍 → 沒有問題', () => {
    expect(checkReportRange('2026-09-27', '2026-10-10', today)).toBeNull()
    expect(checkReportRange('2026-10-10', '2026-10-10', today)).toBeNull()
  })
  it('沒選日期、開始比結束晚、結束是未來、超過上限 → 各有說明', () => {
    expect(checkReportRange('', '2026-10-10', today)).toContain('請選擇')
    expect(checkReportRange('2026-10-10', '2026-10-01', today)).toContain('開始日期要在結束日期之前')
    expect(checkReportRange('2026-10-01', '2026-10-11', today)).toContain('不能是未來')
    expect(checkReportRange('2026-01-01', '2026-10-10', today)).toContain(`最多 ${REPORT_MAX_DAYS} 天`)
  })
  it('剛好 120 天可以，121 天不行', () => {
    expect(checkReportRange('2026-06-13', '2026-10-10', today)).toBeNull()
    expect(checkReportRange('2026-06-12', '2026-10-10', today)).not.toBeNull()
  })
})

describe('報告內容', () => {
  const breaths = [
    // 報告期間之前：只用來當基準值
    rec('2026-10-01', '23:00', 20),
    rec('2026-10-02', '23:00', 20),
    rec('2026-10-03', '23:00', 20),
    // 期間內（10/4–10/7）
    rec('2026-10-04', '01:00', 22),
    rec('2026-10-04', '23:30', 26, { note: '睡在門口' }), // 基準 20 → 25 以上是黃色
    rec('2026-10-05', '02:00', 31),
    rec('2026-10-05', '02:15', 24),
    rec('2026-10-05', '15:00', 38, { state: 'awake' }),
    rec('2026-10-06', '03:00', 44, { deleted: true }),
    rec('2026-10-07', '09:00', 28, { state: 'light', signs: ['abdominal', 'sitting'] }),
    // 期間之後
    rec('2026-10-08', '01:00', 50),
  ]
  const logs = [
    log('2026-10-03', { cough: 'many' }),
    log('2026-10-04', { cough: 'few', appetite: 'normal', energy: 'normal', recoveryMin: 3 }),
    log('2026-10-05', { cough: 'some', appetite: 'reduced', energy: 'low', note: '下午比較喘' }),
    log('2026-10-07', { cough: 'few', appetite: 'normal', activityNote: '上下樓梯' }),
  ]
  const r = buildReport(breaths, logs, S, '2026-10-04', '2026-10-07', '2026-10-10')

  it('每一天都有一列，沒有紀錄的日子也在', () => {
    expect(r.dayCount).toBe(4)
    expect(r.days.map((d) => d.date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'])
    expect(r.days[2]).toMatchObject({ deep: null, red: 0, yellow: 0, otherCount: 0, log: null })
    // 10/6 只有一筆已刪除的紀錄 → 算完全沒有紀錄；10/5、10/7 各有一筆不是熟睡時量的
    expect(r.days.map((d) => d.otherCount)).toEqual([0, 1, 0, 1])
    expect(r.days.map(isEmptyDay)).toEqual([false, false, true, false])
  })

  it('熟睡統計只算期間內、熟睡、沒被刪除的紀錄', () => {
    expect(r.deep).toEqual({ count: 4, days: 2, median: 25, min: 22, max: 31 })
    expect(r.otherCount).toBe(2)
    expect(r.days[0].deep).toMatchObject({ median: 24, min: 22, max: 26, count: 2 })
    expect(r.days[1].deep).toMatchObject({ median: 27.5, min: 24, max: 31, count: 2 })
  })

  it('警示次數：用到期間之前的紀錄當基準值；費力徵象算紅色', () => {
    // 10/4 23:30 的 26：比基準值 20 高 25% 以上 → 黃
    // 10/5 02:00 的 31：≥ 30 → 黃；02:15 的 24：基準值已變成 20.5，沒超過 → 正常
    // 10/7 淺眠但有費力徵象 → 紅
    expect(r.alerts).toEqual({ red: 1, yellow: 2 })
    expect(r.days.map((d) => [d.red, d.yellow])).toEqual([
      [0, 1],
      [0, 1],
      [0, 0],
      [1, 0],
    ])
  })

  it('咳嗽、食慾、精神的天數（只算期間內）', () => {
    expect(r.cough).toEqual({ none: 0, few: 2, some: 1, many: 0 })
    expect(r.appetite).toEqual({ normal: 2, reduced: 1, none: 0 })
    expect(r.energy).toEqual({ normal: 1, low: 1, veryLow: 0 })
    expect(r.days[0].log?.recoveryMin).toBe(3)
  })

  it('個別紀錄：列出有警示的、不是熟睡的、有備註的；照時間排，每日備註排在當天最後', () => {
    expect(r.entries).toEqual([
      { date: '2026-10-04', time: '23:30', level: 'yellow', text: '熟睡 26 次／分；備註：睡在門口' },
      { date: '2026-10-05', time: '02:00', level: 'yellow', text: '熟睡 31 次／分' },
      { date: '2026-10-05', time: '15:00', level: 'none', text: '清醒休息 38 次／分' },
      { date: '2026-10-05', time: null, level: 'none', text: '每日備註：下午比較喘' },
      { date: '2026-10-07', time: '09:00', level: 'red', text: '淺眠 28 次／分；呼吸費力：肚子用力呼吸、坐著不肯躺下' },
      { date: '2026-10-07', time: null, level: 'none', text: '活動：上下樓梯' },
    ])
  })

  it('基準值算到報告最後一天為止', () => {
    // 10/1–10/7 的熟睡紀錄：20、20、20、22、26、31、24 → 中位數 22
    expect(r.baseline.value).toBe(22)
    expect(r.baseline.to).toBe('2026-10-07')
  })

  it('完全沒有紀錄的期間也做得出報告', () => {
    const empty = buildReport([], [], S, '2026-10-01', '2026-10-03', '2026-10-10')
    expect(empty.deep).toEqual({ count: 0, days: 0, median: null, min: null, max: null })
    expect(empty.alerts).toEqual({ red: 0, yellow: 0 })
    expect(empty.entries).toEqual([])
    expect(empty.days).toHaveLength(3)
    expect(empty.baseline.value).toBeNull()
  })
})

describe('每日表格：連續沒有紀錄的日子合成一列', () => {
  it('連續 2 天以上沒有紀錄 → 合成一列；只有 1 天就照常列出來', () => {
    const breaths = [rec('2026-10-03', '02:00', 22), rec('2026-10-07', '02:00', 24), rec('2026-10-09', '02:00', 23)]
    const r = buildReport(breaths, [], S, '2026-10-01', '2026-10-10', '2026-10-10')
    expect(reportRows(r.days).map((row) => (row.kind === 'gap' ? `gap ${row.from}~${row.to} (${row.count})` : row.day.date))).toEqual([
      'gap 2026-10-01~2026-10-02 (2)',
      '2026-10-03',
      'gap 2026-10-04~2026-10-06 (3)',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ])
  })

  it('整段期間都沒有紀錄 → 只有一列', () => {
    const r = buildReport([], [], S, '2026-10-01', '2026-10-14', '2026-10-14')
    expect(reportRows(r.days)).toEqual([{ kind: 'gap', from: '2026-10-01', to: '2026-10-14', count: 14 }])
  })

  it('只有不是熟睡時量的紀錄、或只寫了備註的日子，不算沒有紀錄', () => {
    const breaths = [rec('2026-10-02', '15:00', 36, { state: 'awake' })]
    const logs = [log('2026-10-04', { note: '今天很乖' }), log('2026-10-05', {})]
    const r = buildReport(breaths, logs, S, '2026-10-01', '2026-10-06', '2026-10-10')
    expect(r.days.map(isEmptyDay)).toEqual([true, false, true, false, true, true])
    // 10/1、10/3 各自只有一天 → 照常列出來；10/5–10/6 連續兩天 → 合成一列
    expect(reportRows(r.days).map((row) => row.kind)).toEqual(['day', 'day', 'day', 'day', 'gap'])
  })
})

describe('報告的文字', () => {
  it('標題和檔名', () => {
    expect(reportTitle({ name: 'Carbon', breed: '', birthday: '' })).toBe('Carbon 呼吸紀錄報告')
    expect(reportTitle({ name: '  ', breed: '', birthday: '' })).toBe('呼吸紀錄報告')
    expect(reportFilename({ name: 'Carbon', breed: '', birthday: '' }, '2026-09-19', '2026-10-02')).toBe(
      'Carbon-呼吸紀錄報告-2026-09-19_2026-10-02.pdf',
    )
    expect(reportFilename({ name: '小 黑/2號?', breed: '', birthday: '' }, '2026-10-01', '2026-10-02')).toBe(
      '小-黑-2號-呼吸紀錄報告-2026-10-01_2026-10-02.pdf',
    )
    expect(reportFilename({ name: '', breed: '', birthday: '' }, '2026-10-01', '2026-10-02')).toBe(
      '呼吸紀錄報告-2026-10-01_2026-10-02.pdf',
    )
  })

  it('各選項的天數', () => {
    expect(countsText({ none: 3, few: 5, some: 2, many: 0 }, COUGH_LABEL, COUGH_LEVELS)).toBe('0 次 3 天、1–3 次 5 天、4–10 次 2 天')
    expect(countsText({ normal: 0, reduced: 0, none: 0 }, APPETITE_LABEL, APPETITES)).toBe('')
  })

  it('日期格式和年齡', () => {
    expect(formatDateFull('2026-10-02')).toBe('2026/10/2（五）')
    expect(formatDateWeekday('2026-09-27')).toBe('9/27（日）')
    expect(ageText('2014-03-01', '2026-10-02')).toBe('12 歲 7 個月')
    expect(ageText('2014-10-02', '2026-10-02')).toBe('12 歲')
    expect(ageText('2014-10-03', '2026-10-02')).toBe('11 歲 11 個月')
    expect(ageText('2026-07-15', '2026-10-02')).toBe('2 個月')
    expect(ageText('', '2026-10-02')).toBe('')
    expect(ageText('2027-01-01', '2026-10-02')).toBe('')
  })
})

describe('PDF 檔', () => {
  // 假的 JPEG 內容（含大於 127 的位元組和換行），只用來檢查檔案結構
  const jpegA = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x0a, 0x0d, 0x00, 0x80, 0xff, 0xd9])
  const jpegB = new Uint8Array(300).map((_, i) => (i * 7) % 256)
  const pdf = buildPdf(
    [
      { jpeg: jpegA, width: 1588, height: 2246 },
      { jpeg: jpegB, width: 1588, height: 2246 },
    ],
    { title: 'Carbon 呼吸紀錄報告', created: new Date(Date.UTC(2026, 9, 2, 11, 15, 0)) },
  )
  const text = new TextDecoder('latin1').decode(pdf)

  it('開頭和結尾正確', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.endsWith('%%EOF\n')).toBe(true)
  })

  it('xref 表裡每個物件的位置都指到正確的地方', () => {
    const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1])
    expect(text.slice(xrefAt, xrefAt + 5)).toBe('xref\n')
    const lines = text.slice(xrefAt).split('\n')
    expect(lines[1]).toBe('0 10') // 3 個固定物件 + 2 頁 × 3 個 + 第 0 個
    expect(lines[2]).toBe('0000000000 65535 f ')
    for (let n = 1; n <= 9; n++) {
      const entry = lines[2 + n]
      expect(entry).toMatch(/^\d{10} 00000 n $/)
      const offset = Number(entry.slice(0, 10))
      expect(text.slice(offset, offset + `${n} 0 obj\n`.length)).toBe(`${n} 0 obj\n`)
    }
    expect(text).toContain('/Size 10 /Root 1 0 R /Info 3 0 R')
  })

  it('兩頁 A4，圖片內容原封不動放進去', () => {
    expect(text).toContain('/Type /Pages /Count 2 /Kids [4 0 R 7 0 R]')
    expect(text.match(/\/MediaBox \[0 0 595\.28 841\.89\]/g)).toHaveLength(2)
    expect(text).toContain(`/Width 1588 /Height 2246 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegA.length} >>`)
    const at = text.indexOf(`/Length ${jpegB.length} >>\nstream\n`) + `/Length ${jpegB.length} >>\nstream\n`.length
    expect(Array.from(pdf.slice(at, at + jpegB.length))).toEqual(Array.from(jpegB))
    expect(text.slice(at + jpegB.length, at + jpegB.length + 10)).toBe('\nendstream')
  })

  it('中文標題寫成 UTF-16、日期是 UTC', () => {
    // 把檔案裡的十六進位字串解回來，應該跟原本的標題一樣
    const hex = /\/Title <FEFF([0-9A-F]+)>/.exec(text)![1]
    const units = hex.match(/.{4}/g)!.map((h) => Number.parseInt(h, 16))
    expect(String.fromCharCode(...units)).toBe('Carbon 呼吸紀錄報告')
    expect(text).toContain('/CreationDate (D:20261002111500Z)')
  })

  it('沒有頁面會報錯', () => {
    expect(() => buildPdf([], { title: 'x', created: new Date() })).toThrow()
  })
})
