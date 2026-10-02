// 用打字的方式輸入日期和時間：年、月、日、時、分各一格，24 小時制。
// 每一列右邊的按鈕可以改用手機的日曆、時間選擇器來選。
//
// 為什麼不直接用手機內建的日期時間欄位：
// 1. 手機上那種欄位只能用選的，不能直接打數字。
// 2. 手機設成 12 小時制的時候，00:12 會顯示成「上午 12:12」，很容易看成中午。
//    這裡一律顯示 24 小時制，下面再用「凌晨／早上／中午／下午／晚上」寫一次讓人確認。

import { CalendarDays, Clock } from 'lucide-react'
import { useId, useRef, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import {
  checkDateTimeParts,
  isDateKey,
  spokenDateTimeParts,
  toDateKey,
  type DateTimePart,
  type DateTimeParts,
} from '../lib/dates'
import { nextBoxValue, type DigitBoxRule } from '../lib/digitBox'

interface BoxSpec extends DigitBoxRule {
  part: DateTimePart
  /** 格子後面的單位，也是給螢幕閱讀器念的名稱 */
  unit: string
}

const BOXES: BoxSpec[] = [
  { part: 'year', unit: '年', max: 4, firstMax: 9 },
  { part: 'month', unit: '月', max: 2, firstMax: 1 },
  { part: 'day', unit: '日', max: 2, firstMax: 3 },
  { part: 'hour', unit: '時', max: 2, firstMax: 2 },
  { part: 'minute', unit: '分', max: 2, firstMax: 5 },
]

const BOX_CLASS =
  'h-12 min-w-0 rounded-[14px] border bg-surface px-1 text-center text-lg font-medium text-fg tabular-nums placeholder:text-fg-3'
const PICKER_CLASS =
  'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-surface-2 text-fg-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-fg'
// 蓋在按鈕上面、看不見的日期／時間欄位：點按鈕其實是點到它，手機就會跳出自己的選擇器。
// 字要 16px 以上，不然 iPhone 點下去會把整個畫面放大
const HIDDEN_PICKER_CLASS = 'absolute inset-0 h-full w-full text-base opacity-0'
const UNIT_CLASS = 'shrink-0 text-[15px] text-fg-2'

interface Props {
  value: DateTimeParts
  onChange: (next: DateTimeParts) => void
  /** 現在的時間：用來顯示「今天、昨天」，也是日曆最晚可以選到的日子 */
  now: Date
  /** 有給這段文字的話，填了未來的時間會顯示它 */
  futureMessage?: string
}

/**
 * 手機上點一下，瀏覽器自己就會跳出日曆或時間選擇器，不用另外處理。
 * 電腦上（用滑鼠）點這種欄位不一定會跳出來，要另外呼叫 showPicker。
 */
function openPicker(e: MouseEvent<HTMLInputElement>) {
  if (!window.matchMedia('(pointer: fine)').matches) return
  try {
    e.currentTarget.showPicker?.()
  } catch {
    // 已經開著，或這個瀏覽器不讓程式開：照瀏覽器原本的行為就好
  }
}

export function DateTimeInput({ value, onChange, now, futureMessage }: Props) {
  const id = useId()
  const refs = useRef<(HTMLInputElement | null)[]>([])
  /** 剛點進來、還沒打過字的格子：第一個打的數字會蓋掉原本的內容 */
  const fresh = useRef<boolean[]>([])
  // 最新的內容。同一下操作裡可能連續發生好幾件事（打完字 → 跳下一格 → 上一格失去焦點），
  // 後面的事要看得到前面剛改的結果，不能拿畫面更新前的舊資料來改，不然會把剛打的字蓋回去
  const latest = useRef(value)
  latest.current = value
  const commit = (patch: Partial<DateTimeParts>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    onChange(next)
  }

  const check = checkDateTimeParts(value)
  const inFuture = check.ok && check.date.getTime() > now.getTime() + 60_000
  /** 哪一格要標成紅色（只是還沒填完的不標） */
  const badPart = !check.ok && !check.empty ? check.part : null

  const focusBox = (index: number) => refs.current[index]?.focus()

  const onBoxChange = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const spec = BOXES[index]
    const result = nextBoxValue(latest.current[spec.part], e.target.value, spec, fresh.current[index] === true)
    if (result.touched) fresh.current[index] = false
    commit({ [spec.part]: result.value })
    if (result.done && index < BOXES.length - 1) focusBox(index + 1)
  }

  const onBoxKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && e.currentTarget.value === '' && index > 0) {
      // 空的格子再按一次刪除：回到上一格
      e.preventDefault()
      focusBox(index - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (index < BOXES.length - 1) focusBox(index + 1)
      else e.currentTarget.blur()
    }
  }

  // 點進格子：接下來打的數字會蓋掉原本的。把數字選起來只是讓人看得出來會被蓋掉，
  // 就算手機沒有真的選起來，上面的 fresh 記號也會讓第一個打的數字取代原本的內容
  const onBoxFocus = (index: number, e: FocusEvent<HTMLInputElement>) => {
    fresh.current[index] = true
    const el = e.currentTarget
    requestAnimationFrame(() => {
      try {
        // 已經開始打字就不要再選了，不然會把剛打的字選起來、被下一個字蓋掉
        if (fresh.current[index] && document.activeElement === el) el.setSelectionRange(0, el.value.length)
      } catch {
        // 有些瀏覽器不支援選取，沒關係
      }
    })
  }

  // 離開格子時，只打一位數的補成兩位（2 → 02）
  const onBoxBlur = (index: number) => {
    const spec = BOXES[index]
    const current = latest.current[spec.part]
    if (spec.max === 2 && current.length === 1) commit({ [spec.part]: `0${current}` })
  }

  const box = (index: number) => {
    const spec = BOXES[index]
    const bad = badPart === spec.part
    return (
      <>
        <input
          ref={(el) => {
            refs.current[index] = el
          }}
          className={`${BOX_CLASS} ${spec.part === 'year' ? 'flex-[1.5]' : 'flex-1'} ${bad ? 'border-danger' : 'border-line'}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint={index < BOXES.length - 1 ? 'next' : 'done'}
          aria-label={spec.unit}
          aria-invalid={bad || undefined}
          data-part={spec.part}
          value={value[spec.part]}
          onChange={(e) => onBoxChange(index, e)}
          onKeyDown={(e) => onBoxKeyDown(index, e)}
          onFocus={(e) => onBoxFocus(index, e)}
          onBlur={() => onBoxBlur(index)}
        />
        <span className={UNIT_CLASS} aria-hidden>
          {spec.unit}
        </span>
      </>
    )
  }

  // 手機選擇器要的格式；格子裡的數字還湊不成日期或時間時先給空的
  const dateKey = `${value.year}-${value.month.padStart(2, '0')}-${value.day.padStart(2, '0')}`
  const pickerDate = isDateKey(dateKey) ? dateKey : ''
  const timeOk =
    /^\d{1,2}$/.test(value.hour) && Number(value.hour) < 24 && /^\d{1,2}$/.test(value.minute) && Number(value.minute) < 60
  const pickerTime = timeOk ? `${value.hour.padStart(2, '0')}:${value.minute.padStart(2, '0')}` : ''

  const onPickDate = (picked: string) => {
    if (!isDateKey(picked)) return
    const [year, month, day] = picked.split('-')
    commit({ year, month, day })
  }
  const onPickTime = (picked: string) => {
    const match = /^(\d{2}):(\d{2})/.exec(picked)
    if (match) commit({ hour: match[1], minute: match[2] })
  }

  // 下面那一行：填好了就用白話再寫一次讓人確認；有問題就說哪裡要改
  const problem = !check.ok
    ? { text: check.message, tone: check.empty ? ('hint' as const) : ('bad' as const) }
    : inFuture && futureMessage
      ? { text: futureMessage, tone: 'bad' as const }
      : null
  const spoken = check.ok && !problem ? spokenDateTimeParts(check.date, now) : null
  const tone = problem ? problem.tone : 'ok'

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-labelledby={`${id}-date`}>
        <span id={`${id}-date`} className="mb-1.5 block text-[15px] font-medium text-fg-2">
          測量日期
        </span>
        <div className="flex items-center gap-1.5">
          {box(0)}
          {box(1)}
          {box(2)}
          <span className={`${PICKER_CLASS} ml-1`}>
            <CalendarDays size={22} aria-hidden />
            <input
              type="date"
              aria-label="用日曆選日期"
              className={HIDDEN_PICKER_CLASS}
              value={pickerDate}
              max={toDateKey(now)}
              onChange={(e) => onPickDate(e.target.value)}
              onClick={openPicker}
            />
          </span>
        </div>
      </div>

      <div role="group" aria-labelledby={`${id}-time`}>
        <span id={`${id}-time`} className="mb-1.5 block text-[15px] font-medium text-fg-2">
          測量時間（24 小時制）
        </span>
        <div className="flex items-center gap-1.5">
          {box(3)}
          {box(4)}
          <span className={`${PICKER_CLASS} ml-1`}>
            <Clock size={22} aria-hidden />
            <input
              type="time"
              aria-label="用選的設定時間"
              className={HIDDEN_PICKER_CLASS}
              value={pickerTime}
              onChange={(e) => onPickTime(e.target.value)}
              onClick={openPicker}
            />
          </span>
        </div>
        <p className="mt-1.5 text-sm text-fg-2">半夜 12 點多請填 0，下午 2 點請填 14。</p>
      </div>

      <p
        role="status"
        data-testid="when-status"
        data-tone={tone}
        className={`rounded-[14px] px-4 py-3 text-[15px] leading-relaxed ${
          tone === 'bad' ? 'bg-danger-bg font-medium text-danger' : tone === 'ok' ? 'bg-surface-2 font-medium' : 'bg-surface-2 text-fg-2'
        }`}
      >
        {spoken ? (
          <>
            <span className="font-normal text-fg-2">會記成：</span>
            {spoken.day}
            {spoken.day.endsWith('）') ? '' : ' '}
            {/* 「凌晨 00:12」這一段不要被拆成兩行 */}
            <span className="inline-block whitespace-nowrap">{spoken.time}</span>
          </>
        ) : (
          problem?.text
        )}
      </p>
    </div>
  )
}
