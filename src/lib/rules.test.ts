import { describe, expect, it } from 'vitest'
import {
  consecutiveElevated,
  coughComparison,
  evaluateAgainstHistory,
  evaluateAll,
  evaluateRecord,
  homeStatus,
  isImplausible,
  rateFromQuick,
  rateFromTimed,
} from './alerts'
import { addDays, dateRange, daysBetween, parseDateKey, toDateKey } from './dates'
import { DEFAULT_SETTINGS } from './defaults'
import { baselineBefore, currentBaseline, dailyDeepSummaries, dailyOtherRates, median, priorBaseline } from './stats'
import type { BreathRecord, CoughLevel, DailyLog, EffortSign, SleepState } from './types'

const T = DEFAULT_SETTINGS.thresholds

let seq = 0
/** 產生一筆測試用紀錄；time 是當地時間 HH:MM */
function rec(
  date: string,
  rate: number,
  opts: { state?: SleepState; signs?: EffortSign[]; time?: string; deleted?: boolean } = {},
): BreathRecord {
  const id = `r${++seq}`
  const [h, m] = (opts.time ?? '23:00').split(':').map(Number)
  const d = parseDateKey(date)
  d.setHours(h, m, 0, 0)
  const state = opts.state ?? 'deep'
  const signs = opts.signs ?? []
  return {
    id,
    createdAt: d.toISOString(),
    updatedAt: d.toISOString(),
    deletedAt: opts.deleted ? d.toISOString() : null,
    deviceId: 'test',
    measuredAt: d.toISOString(),
    date,
    rate,
    mode: 'timed',
    breaths: rate / 2,
    durationSec: 30,
    state,
    signs,
    note: '',
    recorder: '',
  }
}

function log(date: string, cough: CoughLevel | null): DailyLog {
  return {
    id: date,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    deviceId: 'test',
    date,
    cough,
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

describe('日期工具', () => {
  it('跨月、跨年加減天數', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
  it('兩個日期相差幾天', () => {
    expect(daysBetween('2026-09-28', '2026-10-02')).toBe(4)
    expect(daysBetween('2026-10-02', '2026-10-02')).toBe(0)
  })
  it('日期範圍含頭尾', () => {
    expect(dateRange('2026-09-30', '2026-10-02')).toEqual(['2026-09-30', '2026-10-01', '2026-10-02'])
  })
  it('半夜的紀錄算在當地日期', () => {
    const d = new Date(2026, 9, 2, 0, 30)
    expect(toDateKey(d)).toBe('2026-10-02')
  })
})

describe('呼吸數換算', () => {
  it('計時模式：30 秒 12 次 = 24 次/分；60 秒 21 次 = 21 次/分', () => {
    expect(rateFromTimed(12, 30)).toBe(24)
    expect(rateFromTimed(21, 60)).toBe(21)
  })
  it('快速模式：N ÷ 經過秒數 × 60', () => {
    expect(rateFromQuick(10, 30_000)).toBe(20)
    expect(rateFromQuick(10, 25_000)).toBe(24)
    expect(rateFromQuick(10, 14_600)).toBe(41)
  })
  it('低於 8 或高於 120 要先確認', () => {
    expect(isImplausible(7)).toBe(true)
    expect(isImplausible(8)).toBe(false)
    expect(isImplausible(120)).toBe(false)
    expect(isImplausible(121)).toBe(true)
  })
})

describe('中位數', () => {
  it('奇數筆、偶數筆、空的', () => {
    expect(median([22, 18, 20])).toBe(20)
    expect(median([18, 20, 22, 30])).toBe(21)
    expect(median([])).toBeNull()
  })
})

describe('基準值', () => {
  const today = '2026-10-10'

  it('不到 3 筆熟睡紀錄不顯示', () => {
    const records = [rec('2026-10-09', 20), rec('2026-10-10', 22)]
    const b = currentBaseline(records, today, T)
    expect(b.value).toBeNull()
    expect(b.count).toBe(2)
  })

  it('最近 7 天（含今天）熟睡紀錄的中位數', () => {
    const records = [
      rec('2026-10-03', 40), // 8 天前，不在範圍內
      rec('2026-10-04', 18), // 剛好第 7 天
      rec('2026-10-07', 20),
      rec('2026-10-10', 24),
    ]
    const b = currentBaseline(records, today, T)
    expect(b.from).toBe('2026-10-04')
    expect(b.to).toBe('2026-10-10')
    expect(b.count).toBe(3)
    expect(b.value).toBe(20)
  })

  it('淺眠、清醒休息、已刪除的紀錄都不算', () => {
    const records = [
      rec('2026-10-08', 20),
      rec('2026-10-09', 22),
      rec('2026-10-09', 50, { state: 'light' }),
      rec('2026-10-10', 60, { state: 'awake' }),
      rec('2026-10-10', 70, { deleted: true }),
      rec('2026-10-10', 24),
    ]
    const b = currentBaseline(records, today, T)
    expect(b.count).toBe(3)
    expect(b.value).toBe(22)
  })

  it('判斷某一筆紀錄用的基準值：只算比它早的，不含它自己和之後的', () => {
    const a = rec('2026-10-08', 20, { time: '23:00' })
    const b = rec('2026-10-09', 22, { time: '23:00' })
    const c = rec('2026-10-10', 24, { time: '01:00' })
    const target = rec('2026-10-10', 38, { time: '02:00' })
    const later = rec('2026-10-10', 40, { time: '02:15' })
    const all = [a, b, c, target, later]
    const base = baselineBefore(all, target, T)
    expect(base.count).toBe(3)
    expect(base.value).toBe(22)
    // 最早的那一筆之前沒有任何紀錄
    expect(baselineBefore(all, a, T).value).toBeNull()
    // 超過 7 天前的不算
    const old = rec('2026-10-03', 10, { time: '23:00' })
    expect(baselineBefore([old, ...all], target, T).count).toBe(3)
  })

  it('priorBaseline 不含當天', () => {
    const records = [rec('2026-10-07', 20), rec('2026-10-08', 20), rec('2026-10-09', 22), rec('2026-10-10', 40)]
    const b = priorBaseline(records, today, T)
    expect(b.from).toBe('2026-10-03')
    expect(b.to).toBe('2026-10-09')
    expect(b.value).toBe(20)
  })

  it('每日統計：中位數、最低、最高、第一筆和最後一筆的時間', () => {
    const records = [
      rec('2026-10-10', 20, { time: '02:00' }),
      rec('2026-10-10', 26, { time: '23:10' }),
      rec('2026-10-10', 22, { time: '00:30' }),
      rec('2026-10-09', 19),
    ]
    const s = dailyDeepSummaries(records)
    const day = s.get('2026-10-10')!
    expect(day).toMatchObject({ date: '2026-10-10', median: 22, min: 20, max: 26, count: 3 })
    expect(day.firstAt).toBe(records[2].measuredAt)
    expect(day.lastAt).toBe(records[1].measuredAt)
    expect(s.get('2026-10-09')?.median).toBe(19)
    expect(s.has('2026-10-08')).toBe(false)
  })
})

describe('趨勢圖「全部」用的資料：不是熟睡時量的紀錄', () => {
  it('依日期分成淺眠、清醒休息，照測量時間排；熟睡和已刪除的不算', () => {
    const records = [
      rec('2026-10-10', 36, { state: 'awake', time: '15:00' }),
      rec('2026-10-10', 30, { state: 'light', time: '22:00' }),
      rec('2026-10-10', 34, { state: 'awake', time: '09:00' }),
      rec('2026-10-10', 22, { state: 'deep', time: '02:00' }),
      rec('2026-10-10', 50, { state: 'light', time: '23:00', deleted: true }),
      rec('2026-10-09', 28, { state: 'light', time: '21:00' }),
    ]
    const o = dailyOtherRates(records)
    expect(o.get('2026-10-10')).toEqual({ light: [30], awake: [34, 36] })
    expect(o.get('2026-10-09')).toEqual({ light: [28], awake: [] })
    expect(o.size).toBe(2)
  })

  it('只有熟睡紀錄的日子不會出現；這些紀錄也不會跑進熟睡的每日統計', () => {
    const records = [rec('2026-10-10', 22), rec('2026-10-10', 40, { state: 'awake' })]
    expect(dailyOtherRates([records[0]]).size).toBe(0)
    expect(dailyDeepSummaries(records).get('2026-10-10')).toMatchObject({ median: 22, min: 22, max: 22, count: 1 })
  })
})

describe('單筆紀錄的警示', () => {
  it('熟睡 29 次、沒有基準值 → 正常', () => {
    expect(evaluateRecord({ rate: 29, state: 'deep', signs: [] }, null, T).level).toBe('none')
  })

  it('熟睡 ≥ 30 → 黃色', () => {
    const a = evaluateRecord({ rate: 30, state: 'deep', signs: [] }, null, T)
    expect(a.level).toBe('yellow')
    expect(a.reasons).toEqual(['rateYellow'])
  })

  it('熟睡 ≥ 40 → 紅色', () => {
    const a = evaluateRecord({ rate: 40, state: 'deep', signs: [] }, null, T)
    expect(a.level).toBe('red')
    expect(a.reasons).toEqual(['rateRed'])
  })

  it('比基準值高 25% 以上 → 黃色（基準 20，量到 25）', () => {
    expect(evaluateRecord({ rate: 24, state: 'deep', signs: [] }, 20, T).level).toBe('none')
    const a = evaluateRecord({ rate: 25, state: 'deep', signs: [] }, 20, T)
    expect(a.level).toBe('yellow')
    expect(a.reasons).toEqual(['aboveBaseline'])
    expect(a.baseline).toBe(20)
  })

  it('基準值是小數時的邊界（基準 21.5 → 26.875，27 才算）', () => {
    expect(evaluateRecord({ rate: 26, state: 'deep', signs: [] }, 21.5, T).level).toBe('none')
    expect(evaluateRecord({ rate: 27, state: 'deep', signs: [] }, 21.5, T).level).toBe('yellow')
  })

  it('淺眠或清醒休息時呼吸數再高也不觸發呼吸數警示', () => {
    expect(evaluateRecord({ rate: 55, state: 'light', signs: [] }, 20, T).level).toBe('none')
    expect(evaluateRecord({ rate: 55, state: 'awake', signs: [] }, 20, T).level).toBe('none')
  })

  it('勾了任何呼吸費力徵象 → 紅色，不管是不是熟睡', () => {
    expect(evaluateRecord({ rate: 20, state: 'deep', signs: ['abdominal'] }, 20, T).level).toBe('red')
    const awake = evaluateRecord({ rate: 28, state: 'awake', signs: ['sitting', 'openMouth'] }, null, T)
    expect(awake.level).toBe('red')
    expect(awake.reasons).toEqual(['signs'])
  })

  it('門檻可以調整（獸醫建議改成 35／45）', () => {
    const custom = { ...T, yellowRate: 35, redRate: 45 }
    expect(evaluateRecord({ rate: 32, state: 'deep', signs: [] }, null, custom).level).toBe('none')
    expect(evaluateRecord({ rate: 36, state: 'deep', signs: [] }, null, custom).level).toBe('yellow')
    expect(evaluateRecord({ rate: 45, state: 'deep', signs: [] }, null, custom).level).toBe('red')
  })

  it('判斷結果會附上當時用的門檻（顯示說明文字用）', () => {
    const a = evaluateRecord({ rate: 20, state: 'deep', signs: [] }, 19, T)
    expect(a).toMatchObject({ yellowRate: 30, redRate: 40, baselinePct: 25, baseline: 19 })
  })

  it('對照歷史紀錄判斷：自己不算進基準值', () => {
    const history = [rec('2026-10-08', 20), rec('2026-10-09', 20), rec('2026-10-10', 20, { time: '01:00' })]
    const fresh = rec('2026-10-10', 26, { time: '03:00' })
    const a = evaluateAgainstHistory(fresh, [...history, fresh], T)
    expect(a.level).toBe('yellow')
    expect(a.baseline).toBe(20)
  })
})

describe('全部紀錄一起判斷（警示不存檔，每次現算）', () => {
  const history = [
    rec('2026-10-07', 20, { time: '23:00' }),
    rec('2026-10-08', 21, { time: '23:00' }),
    rec('2026-10-09', 22, { time: '23:00' }),
  ]

  it('之後才量到的紀錄，不會回頭改變先前那一筆的判斷', () => {
    const first = rec('2026-10-10', 27, { time: '02:00' }) // 基準 21 → 26.25 以上是黃色
    const before = evaluateAll([...history, first], T).get(first.id)!
    expect(before.level).toBe('yellow')
    const later = [rec('2026-10-10', 30, { time: '02:15' }), rec('2026-10-10', 31, { time: '02:30' })]
    const after = evaluateAll([...history, first, ...later], T).get(first.id)!
    expect(after).toEqual(before)
  })

  it('調整門檻之後，所有紀錄都用新門檻重新判斷', () => {
    const r32 = rec('2026-10-10', 32, { time: '02:00' })
    const all = [...history, r32]
    expect(evaluateAll(all, T).get(r32.id)!.level).toBe('yellow')
    const vet = { ...T, yellowRate: 35, redRate: 45, baselinePct: 60 }
    expect(evaluateAll(all, vet).get(r32.id)!.level).toBe('none')
    const strict = { ...T, redRate: 32 }
    expect(evaluateAll(all, strict).get(r32.id)!.level).toBe('red')
  })

  it('補登比較早的紀錄，會算進之後那些紀錄的基準值', () => {
    const r25 = rec('2026-10-10', 25, { time: '02:00' })
    // 只有兩筆歷史 → 沒有基準值 → 25 是正常
    const two = history.slice(0, 2)
    expect(evaluateAll([...two, r25], T).get(r25.id)!.level).toBe('none')
    // 補登一筆 10/9 的 19 → 基準值 20 → 25 變成黃色
    const backfill = rec('2026-10-09', 19, { time: '22:00' })
    const result = evaluateAll([...two, backfill, r25], T).get(r25.id)!
    expect(result.baseline).toBe(20)
    expect(result.level).toBe('yellow')
  })

  it('一次判斷全部的結果，跟逐筆判斷完全一樣（隨機產生 300 筆、含不同時區的紀錄來比對）', () => {
    // 固定種子的亂數，每次跑的資料都一樣
    let seed = 20261002
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const states: SleepState[] = ['deep', 'deep', 'deep', 'light', 'awake']
    const many: BreathRecord[] = []
    for (let i = 0; i < 300; i++) {
      const day = addDays('2026-08-01', Math.floor(rand() * 60))
      const time = `${String(Math.floor(rand() * 24)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`
      many.push(
        rec(day, 14 + Math.floor(rand() * 32), {
          time,
          state: states[Math.floor(rand() * states.length)],
          signs: rand() < 0.05 ? ['abdominal'] : [],
          deleted: rand() < 0.05,
        }),
      )
    }
    // 模擬另一支不同時區的手機：有些紀錄的「當地日期」比時間先後差了一天
    for (const r of many) {
      const roll = rand()
      if (roll < 0.1) r.date = addDays(r.date, 1)
      else if (roll < 0.2) r.date = addDays(r.date, -1)
    }
    const all = evaluateAll(many, T)
    const liveOnes = many.filter((r) => !r.deletedAt)
    expect(all.size).toBe(liveOnes.length)
    for (const r of liveOnes) expect(all.get(r.id)).toEqual(evaluateAgainstHistory(r, many, T))
    // 確認這批資料真的有測到三種燈號
    const levels = new Set([...all.values()].map((a) => a.level))
    expect(levels).toEqual(new Set(['none', 'yellow', 'red']))
  })

  it('已刪除的紀錄不判斷、也不算進別人的基準值', () => {
    const gone = rec('2026-10-09', 60, { time: '21:00', deleted: true })
    const r = rec('2026-10-10', 24, { time: '02:00' })
    const out = evaluateAll([...history, gone, r], T)
    expect(out.has(gone.id)).toBe(false)
    expect(out.get(r.id)!.baseline).toBe(21)
  })
})

describe('連續兩天偏高', () => {
  const today = '2026-10-10'

  it('今天和昨天的中位數都 ≥ 30 → 提醒', () => {
    const records = [rec('2026-10-09', 31), rec('2026-10-09', 33), rec('2026-10-10', 30)]
    const c = consecutiveElevated(records, today, T)
    expect(c.active).toBe(true)
    expect(c.days.map((d) => d.date)).toEqual(['2026-10-09', '2026-10-10'])
  })

  it('只有一天偏高 → 不提醒', () => {
    const records = [rec('2026-10-09', 22), rec('2026-10-10', 34)]
    expect(consecutiveElevated(records, today, T).active).toBe(false)
  })

  it('看的是每天的中位數，不是單筆最高值', () => {
    const records = [
      rec('2026-10-09', 22),
      rec('2026-10-09', 24),
      rec('2026-10-09', 36),
      rec('2026-10-10', 23),
      rec('2026-10-10', 35),
      rec('2026-10-10', 25),
    ]
    expect(consecutiveElevated(records, today, T).active).toBe(false)
  })

  it('今天還沒量 → 看昨天和前天', () => {
    const records = [rec('2026-10-08', 32), rec('2026-10-09', 31)]
    expect(consecutiveElevated(records, today, T).active).toBe(true)
  })

  it('今天量了而且正常 → 提醒解除', () => {
    const records = [rec('2026-10-08', 32), rec('2026-10-09', 31), rec('2026-10-10', 22)]
    expect(consecutiveElevated(records, today, T).active).toBe(false)
  })

  it('中間隔了一天沒量 → 不算連續', () => {
    const records = [rec('2026-10-08', 32), rec('2026-10-10', 31)]
    expect(consecutiveElevated(records, today, T).active).toBe(false)
  })

  it('沒到 30，但兩天都比先前的基準值高 25% 以上 → 提醒', () => {
    const records = [
      rec('2026-10-05', 18),
      rec('2026-10-06', 18),
      rec('2026-10-07', 18),
      rec('2026-10-08', 18),
      rec('2026-10-09', 23), // 18 × 1.25 = 22.5
      rec('2026-10-10', 24),
    ]
    expect(consecutiveElevated(records, today, T).active).toBe(true)
  })

  it('只算熟睡紀錄', () => {
    const records = [rec('2026-10-09', 45, { state: 'light' }), rec('2026-10-10', 45, { state: 'awake' })]
    expect(consecutiveElevated(records, today, T).active).toBe(false)
  })

  it('半夜 23:50 偏高、00:10 再量還是偏高：是同一個晚上，不算連續兩天', () => {
    const records = [rec('2026-10-09', 32, { time: '23:50' }), rec('2026-10-10', 33, { time: '00:10' })]
    expect(consecutiveElevated(records, today, T).active).toBe(false)
  })

  it('…但到了 10/10 晚上再量還是偏高，就算連續兩天了', () => {
    const records = [
      rec('2026-10-09', 32, { time: '23:50' }),
      rec('2026-10-10', 33, { time: '00:10' }),
      rec('2026-10-10', 31, { time: '23:30' }),
    ]
    expect(consecutiveElevated(records, today, T).active).toBe(true)
  })

  it('兩天各在睡前量一次（相隔約一天）→ 算連續兩天', () => {
    const records = [rec('2026-10-09', 31, { time: '01:00' }), rec('2026-10-10', 32, { time: '00:30' })]
    expect(consecutiveElevated(records, today, T).active).toBe(true)
  })
})

describe('首頁燈號', () => {
  const now = new Date(2026, 9, 10, 8, 0) // 10/10 早上 8 點

  it('24 小時內沒有紀錄 → 還沒量', () => {
    const s = homeStatus([rec('2026-10-07', 20)], now, T)
    expect(s.light).toBe('idle')
    expect(s.latestDeep?.rate).toBe(20)
  })

  it('最新的熟睡紀錄正常 → 綠燈', () => {
    const s = homeStatus([rec('2026-10-09', 22, { time: '23:30' })], now, T)
    expect(s.light).toBe('green')
  })

  it('先黃燈、15 分鐘後再量正常 → 綠燈，但 24 小時內的警示次數還看得到', () => {
    const s = homeStatus(
      [rec('2026-10-10', 33, { time: '02:00' }), rec('2026-10-10', 24, { time: '02:15' })],
      now,
      T,
    )
    expect(s.light).toBe('green')
    expect(s.last24h).toEqual({ red: 0, yellow: 1 })
  })

  it('熟睡黃燈之後補了一筆清醒休息的紀錄 → 還是黃燈', () => {
    const s = homeStatus(
      [rec('2026-10-10', 33, { time: '02:00' }), rec('2026-10-10', 26, { time: '07:30', state: 'awake' })],
      now,
      T,
    )
    expect(s.light).toBe('yellow')
    expect(s.decisive?.rate).toBe(33)
  })

  it('清醒時勾了費力徵象 → 紅燈', () => {
    const s = homeStatus(
      [rec('2026-10-10', 22, { time: '02:00' }), rec('2026-10-10', 30, { time: '07:00', state: 'awake', signs: ['openMouth'] })],
      now,
      T,
    )
    expect(s.light).toBe('red')
  })

  it('連續兩天偏高，即使今天還沒量也亮黃燈', () => {
    const s = homeStatus([rec('2026-10-08', 32, { time: '03:00' }), rec('2026-10-09', 31, { time: '03:00' })], now, T)
    expect(s.consecutive.active).toBe(true)
    expect(s.light).toBe('yellow')
  })

  it('統計今天量了幾次', () => {
    const s = homeStatus(
      [rec('2026-10-10', 22, { time: '01:00' }), rec('2026-10-10', 30, { time: '07:00', state: 'light' }), rec('2026-10-09', 20)],
      now,
      T,
    )
    expect(s.today).toEqual({ total: 2, deep: 1 })
  })

  it('已刪除的紀錄不影響燈號', () => {
    const s = homeStatus([rec('2026-10-10', 45, { time: '02:00', deleted: true })], now, T)
    expect(s.light).toBe('idle')
  })
})

describe('咳嗽比較', () => {
  it('前 7 天沒有紀錄 → 不比較', () => {
    expect(coughComparison([log('2026-10-10', 'many')], '2026-10-10').more).toBe(false)
  })

  it('今天比前 7 天平均多 → 提示', () => {
    const logs = [log('2026-10-07', 'none'), log('2026-10-08', 'few'), log('2026-10-09', 'few'), log('2026-10-10', 'some')]
    const c = coughComparison(logs, '2026-10-10')
    expect(c.priorDays).toBe(3)
    expect(c.priorAverage).toBeCloseTo(4 / 3)
    expect(c.more).toBe(true)
  })

  it('跟平常一樣 → 不提示', () => {
    const logs = [log('2026-10-08', 'few'), log('2026-10-09', 'few'), log('2026-10-10', 'few')]
    expect(coughComparison(logs, '2026-10-10').more).toBe(false)
  })

  it('超過 7 天前的紀錄不算；今天還沒填也不提示', () => {
    const logs = [log('2026-10-02', 'none'), log('2026-10-10', 'few')]
    expect(coughComparison(logs, '2026-10-10').priorDays).toBe(0)
    expect(coughComparison([log('2026-10-09', 'none'), log('2026-10-10', null)], '2026-10-10').more).toBe(false)
  })
})
