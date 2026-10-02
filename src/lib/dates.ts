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

/** Date → <input type="datetime-local"> 要的格式 */
export function toLocalInputValue(d: Date): string {
  return `${toDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
