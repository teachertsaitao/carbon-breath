// 日期工具。所有「每天」的計算都用手機當地日期（YYYY-MM-DD 字串），不用 UTC，
// 這樣半夜量的紀錄會算在正確的那一天。

const pad = (n: number) => String(n).padStart(2, '0')

/** Date → 當地日期字串 YYYY-MM-DD */
export function toDateKey(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 是不是 YYYY-MM-DD 格式、而且真的有這一天 */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return toDateKey(parseDateKey(value)) === value
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now)
}

/** YYYY-MM-DD → 當地時間該日 00:00 的 Date */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 日期加減天數 */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return toDateKey(new Date(y, m - 1, d + n))
}

/** b 比 a 晚幾天（同一天為 0） */
export function daysBetween(a: string, b: string): number {
  const ms = parseDateKey(b).getTime() - parseDateKey(a).getTime()
  return Math.round(ms / 86_400_000)
}

/** 從 from 到 to（含頭尾）的每一天 */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  const n = daysBetween(from, to)
  for (let i = 0; i <= n; i++) out.push(addDays(from, i))
  return out
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 「10月2日 週五」 */
export function formatDateLong(key: string): string {
  const d = parseDateKey(key)
  return `${d.getMonth() + 1}月${d.getDate()}日 週${WEEKDAYS[d.getDay()]}`
}

/** 「10/2」 */
export function formatDateShort(key: string): string {
  const d = parseDateKey(key)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 「2026/10/2（五）」 */
export function formatDateFull(key: string): string {
  const d = parseDateKey(key)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`
}

/** 「10/2（五）」 */
export function formatDateWeekday(key: string): string {
  const d = parseDateKey(key)
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`
}

/** 從生日算到某一天的年齡，例如「12 歲 7 個月」。生日沒填或不合理時回傳空字串。 */
export function ageText(birthday: string, at: string): string {
  if (!isDateKey(birthday) || !isDateKey(at) || birthday > at) return ''
  const b = parseDateKey(birthday)
  const a = parseDateKey(at)
  let months = (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth())
  if (a.getDate() < b.getDate()) months--
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return `${rest} 個月`
  return rest === 0 ? `${years} 歲` : `${years} 歲 ${rest} 個月`
}

/** 「今天」「昨天」，更早的顯示「10月2日 週五」 */
export function formatDateRelative(key: string, today: string = todayKey()): string {
  const diff = daysBetween(key, today)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return formatDateLong(key)
}

/** ISO 時間 → 「02:14」（24 小時制） */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO 時間 → 「今天 02:14」「昨天 23:40」「9月30日 週三 21:05」 */
export function formatDateTimeRelative(iso: string, now: Date = new Date()): string {
  const key = toDateKey(new Date(iso))
  return `${formatDateRelative(key, toDateKey(now))} ${formatTime(iso)}`
}

// ── 用打字的方式輸入日期時間（手動補登用）──────────────

/** 手動輸入的年、月、日、時、分：使用者在每一格打的字，還沒檢查過 */
export interface DateTimeParts {
  year: string
  month: string
  day: string
  hour: string
  minute: string
}

export type DateTimePart = keyof DateTimeParts

const PART_ORDER: DateTimePart[] = ['year', 'month', 'day', 'hour', 'minute']

/** Date → 每一格要顯示的字（月、日、時、分補成兩位數；時是 24 小時制） */
export function toDateTimeParts(d: Date): DateTimeParts {
  return {
    year: String(d.getFullYear()),
    month: pad(d.getMonth() + 1),
    day: pad(d.getDate()),
    hour: pad(d.getHours()),
    minute: pad(d.getMinutes()),
  }
}

export type DateTimeCheck =
  | { ok: true; date: Date }
  | {
      ok: false
      /** 有問題的是哪一格 */
      part: DateTimePart
      /** 只是還沒填（不是填錯） */
      empty: boolean
      /** 要顯示給使用者看的說明 */
      message: string
    }

/**
 * 檢查手動輸入的日期時間（24 小時制，00:12 是半夜十二點十二分）。
 * 沒問題回傳當地時間的 Date；有問題回傳是哪一格、要顯示的說明。
 */
export function checkDateTimeParts(p: DateTimeParts): DateTimeCheck {
  for (const part of PART_ORDER) {
    if (p[part].trim() === '') return { ok: false, part, empty: true, message: '請把日期和時間填完整。' }
    if (!/^\d+$/.test(p[part])) return { ok: false, part, empty: false, message: '日期和時間只能填數字。' }
  }
  const year = Number(p.year)
  const month = Number(p.month)
  const day = Number(p.day)
  const hour = Number(p.hour)
  const minute = Number(p.minute)
  const bad = (part: DateTimePart, message: string): DateTimeCheck => ({ ok: false, part, empty: false, message })

  if (p.year.length !== 4 || year < 2000) return bad('year', '年份請填四位數，例如 2026。')
  if (month < 1 || month > 12) return bad('month', '月份請填 1 到 12。')
  if (day < 1 || day > 31) return bad('day', '日期請填 1 到 31。')
  if (hour > 23) return bad('hour', '小時請填 0 到 23（24 小時制：半夜 12 點多是 0，下午 2 點是 14）。')
  if (minute > 59) return bad('minute', '分鐘請填 0 到 59。')

  const date = new Date(year, month - 1, day, hour, minute, 0, 0)
  // 真的有這一天嗎（例如 2 月 30 日、4 月 31 日會被 Date 自動進位到下個月）
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return bad('day', `${year} 年 ${month} 月沒有 ${day} 日。`)
  }
  return { ok: true, date }
}

/** 這個小時是一天裡的哪一段，用平常講話的說法 */
export function dayPeriod(hour: number): string {
  if (hour < 5) return '凌晨'
  if (hour < 11) return '早上'
  if (hour < 13) return '中午'
  if (hour < 18) return '下午'
  return '晚上'
}

/**
 * 把日期時間寫成一看就懂、不會看錯的說法，分成「哪一天」和「幾點」兩段，例如
 * 「今天（10/2 週五）」＋「凌晨 00:12」、「9/20 週日」＋「下午 14:30」。
 * 時間一律 24 小時制，前面再加上「凌晨／早上／中午／下午／晚上」。
 */
export function spokenDateTimeParts(d: Date, now: Date = new Date()): { day: string; time: string } {
  const diff = daysBetween(toDateKey(d), toDateKey(now))
  const year = d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}/` : ''
  const dateText = `${year}${d.getMonth() + 1}/${d.getDate()} 週${WEEKDAYS[d.getDay()]}`
  const day =
    diff === 0 ? `今天（${dateText}）` : diff === 1 ? `昨天（${dateText}）` : diff === 2 ? `前天（${dateText}）` : dateText
  return { day, time: `${dayPeriod(d.getHours())} ${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

/** 同上，接成一句：「今天（10/2 週五）凌晨 00:12」「9/20 週日 下午 14:30」 */
export function formatDateTimeSpoken(d: Date, now: Date = new Date()): string {
  const { day, time } = spokenDateTimeParts(d, now)
  return day.endsWith('）') ? `${day}${time}` : `${day} ${time}`
}
