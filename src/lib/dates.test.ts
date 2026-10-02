import { describe, expect, it } from 'vitest'
import {
  checkDateTimeParts,
  dayPeriod,
  formatDateTimeSpoken,
  toDateTimeParts,
  type DateTimeParts,
} from './dates'

const parts = (year: string, month: string, day: string, hour: string, minute: string): DateTimeParts => ({
  year,
  month,
  day,
  hour,
  minute,
})

describe('手動輸入日期時間：格子的內容', () => {
  it('Date → 每一格（月日時分補兩位，時間是 24 小時制）', () => {
    expect(toDateTimeParts(new Date(2026, 9, 2, 0, 12))).toEqual(parts('2026', '10', '02', '00', '12'))
    expect(toDateTimeParts(new Date(2026, 0, 5, 14, 5))).toEqual(parts('2026', '01', '05', '14', '05'))
    expect(toDateTimeParts(new Date(2026, 11, 31, 23, 59))).toEqual(parts('2026', '12', '31', '23', '59'))
  })

  it('轉成格子再檢查，會得到同一個時間', () => {
    for (const d of [new Date(2026, 9, 2, 0, 12), new Date(2024, 1, 29, 12, 0), new Date(2026, 9, 2, 23, 59)]) {
      const check = checkDateTimeParts(toDateTimeParts(d))
      expect(check.ok && check.date.getTime()).toBe(d.getTime())
    }
  })
})

describe('手動輸入日期時間：檢查', () => {
  it('00:12 是半夜十二點十二分（不是中午）', () => {
    const check = checkDateTimeParts(parts('2026', '10', '02', '00', '12'))
    expect(check.ok).toBe(true)
    if (check.ok) {
      expect(check.date.getHours()).toBe(0)
      expect(check.date.getMinutes()).toBe(12)
      expect(check.date.getDate()).toBe(2)
    }
  })

  it('12:12 是中午，下午 2 點要填 14', () => {
    const noon = checkDateTimeParts(parts('2026', '10', '02', '12', '12'))
    expect(noon.ok && noon.date.getHours()).toBe(12)
    const afternoon = checkDateTimeParts(parts('2026', '10', '02', '14', '00'))
    expect(afternoon.ok && afternoon.date.getHours()).toBe(14)
  })

  it('只打一位數也可以（2 月 3 日 7 點 5 分）', () => {
    const check = checkDateTimeParts(parts('2026', '2', '3', '7', '5'))
    expect(check.ok && check.date.getTime()).toBe(new Date(2026, 1, 3, 7, 5).getTime())
  })

  it('有格子沒填：說「請填完整」，而且知道是哪一格', () => {
    const check = checkDateTimeParts(parts('2026', '10', '', '00', '12'))
    expect(check).toMatchObject({ ok: false, part: 'day', empty: true })
    const first = checkDateTimeParts(parts('', '', '', '', ''))
    expect(first).toMatchObject({ ok: false, part: 'year', empty: true })
  })

  it('年份要四位數', () => {
    expect(checkDateTimeParts(parts('26', '10', '02', '00', '12'))).toMatchObject({ ok: false, part: 'year', empty: false })
    expect(checkDateTimeParts(parts('1999', '10', '02', '00', '12'))).toMatchObject({ ok: false, part: 'year' })
    expect(checkDateTimeParts(parts('20261', '10', '02', '00', '12'))).toMatchObject({ ok: false, part: 'year' })
  })

  it('月份 1–12、日期 1–31、小時 0–23、分鐘 0–59', () => {
    expect(checkDateTimeParts(parts('2026', '13', '02', '00', '12'))).toMatchObject({ ok: false, part: 'month' })
    expect(checkDateTimeParts(parts('2026', '0', '02', '00', '12'))).toMatchObject({ ok: false, part: 'month' })
    expect(checkDateTimeParts(parts('2026', '10', '32', '00', '12'))).toMatchObject({ ok: false, part: 'day' })
    expect(checkDateTimeParts(parts('2026', '10', '0', '00', '12'))).toMatchObject({ ok: false, part: 'day' })
    expect(checkDateTimeParts(parts('2026', '10', '02', '24', '00'))).toMatchObject({ ok: false, part: 'hour' })
    expect(checkDateTimeParts(parts('2026', '10', '02', '23', '60'))).toMatchObject({ ok: false, part: 'minute' })
    expect(checkDateTimeParts(parts('2026', '10', '02', '23', '59')).ok).toBe(true)
  })

  it('沒有這一天（2 月 30 日、4 月 31 日、平年的 2 月 29 日）', () => {
    const feb30 = checkDateTimeParts(parts('2026', '02', '30', '10', '00'))
    expect(feb30).toMatchObject({ ok: false, part: 'day', empty: false })
    expect(!feb30.ok && feb30.message).toBe('2026 年 2 月沒有 30 日。')
    expect(checkDateTimeParts(parts('2026', '04', '31', '10', '00'))).toMatchObject({ ok: false, part: 'day' })
    expect(checkDateTimeParts(parts('2026', '02', '29', '10', '00'))).toMatchObject({ ok: false, part: 'day' })
    expect(checkDateTimeParts(parts('2024', '02', '29', '10', '00')).ok).toBe(true)
  })

  it('不是數字的不收', () => {
    expect(checkDateTimeParts(parts('2026', '1a', '02', '00', '12'))).toMatchObject({ ok: false, part: 'month', empty: false })
    expect(checkDateTimeParts(parts('2026', '10', '02', '-1', '12'))).toMatchObject({ ok: false, part: 'hour' })
  })
})

describe('一天裡的哪一段', () => {
  it('凌晨、早上、中午、下午、晚上', () => {
    expect([0, 1, 4].map(dayPeriod)).toEqual(['凌晨', '凌晨', '凌晨'])
    expect([5, 8, 10].map(dayPeriod)).toEqual(['早上', '早上', '早上'])
    expect([11, 12].map(dayPeriod)).toEqual(['中午', '中午'])
    expect([13, 14, 17].map(dayPeriod)).toEqual(['下午', '下午', '下午'])
    expect([18, 21, 23].map(dayPeriod)).toEqual(['晚上', '晚上', '晚上'])
  })
})

describe('把日期時間寫成不會看錯的說法', () => {
  const now = new Date(2026, 9, 2, 22, 43) // 2026/10/2（五）22:43

  it('00:12 寫成「凌晨 00:12」，不會出現「上午 12:12」', () => {
    const text = formatDateTimeSpoken(new Date(2026, 9, 2, 0, 12), now)
    expect(text).toBe('今天（10/2 週五）凌晨 00:12')
    expect(text).not.toContain('上午')
    expect(text).not.toContain('12:12')
  })

  it('中午 12:12 和半夜 00:12 寫出來不一樣', () => {
    expect(formatDateTimeSpoken(new Date(2026, 9, 2, 12, 12), now)).toBe('今天（10/2 週五）中午 12:12')
  })

  it('昨天、前天、更早', () => {
    expect(formatDateTimeSpoken(new Date(2026, 9, 1, 23, 40), now)).toBe('昨天（10/1 週四）晚上 23:40')
    expect(formatDateTimeSpoken(new Date(2026, 8, 30, 14, 30), now)).toBe('前天（9/30 週三）下午 14:30')
    expect(formatDateTimeSpoken(new Date(2026, 8, 20, 7, 5), now)).toBe('9/20 週日 早上 07:05')
  })

  it('不是今年的會寫出年份', () => {
    expect(formatDateTimeSpoken(new Date(2025, 11, 31, 2, 0), now)).toBe('2025/12/31 週三 凌晨 02:00')
  })
})
