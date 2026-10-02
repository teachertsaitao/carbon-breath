// 每日紀錄：咳嗽、食慾、精神、活動耐受度、喝水、排尿、備註。
// 一天一筆，點了就自動儲存，不用按儲存鍵。
//
// 每個控制項只寫自己那一個欄位（update 只帶那個欄位），存檔時再跟資料庫裡現有的合起來，
// 所以不管點擊和打字的先後順序如何，都不會互相蓋掉。

import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Page } from '../components/Layout'
import { ChipGroup, ChoiceGroup, Field, INPUT_CLASS, Notice, Section, TEXTAREA_CLASS } from '../components/ui'
import { coughComparison } from '../lib/alerts'
import { addDays, formatDateLong, toDateKey } from '../lib/dates'
import { emptyDailyFields, saveDailyLog, useDailyLogs, type DailyFields } from '../lib/db'
import { useNow } from '../lib/hooks'
import {
  ACTIVITY_PRESETS,
  AMOUNTS,
  AMOUNT_LABEL,
  APPETITES,
  APPETITE_LABEL,
  COUGH_CONTEXTS,
  COUGH_CONTEXT_LABEL,
  COUGH_LABEL,
  COUGH_LEVELS,
  ENERGIES,
  ENERGY_LABEL,
} from '../lib/labels'
import { navigate } from '../lib/router'

const opts = <T extends string>(values: T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }))

/**
 * 會自動儲存的文字欄位：打字時先留在畫面上，停下來 0.6 秒或離開欄位時才寫入，
 * 避免每打一個字就存一次。
 */
function AutoSaveText({
  value,
  onCommit,
  multiline = false,
  placeholder,
  ariaLabel,
}: {
  value: string
  onCommit: (text: string) => void
  multiline?: boolean
  placeholder?: string
  ariaLabel: string
}) {
  const [text, setText] = useState(value)
  const focused = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef({ text, onCommit, saved: value })
  latest.current = { text, onCommit, saved: value }

  // 資料庫的內容變了（例如匯入了備份），而且使用者沒有正在打字，才把畫面同步過來
  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])

  const flush = () => {
    window.clearTimeout(timer.current)
    const { text: t, onCommit: commit, saved } = latest.current
    if (t !== saved) commit(t)
  }
  // 離開頁面（或換一天）時，把還沒存的內容存進去
  useEffect(() => flush, [])

  const props = {
    value: text,
    placeholder,
    'aria-label': ariaLabel,
    onFocus: () => {
      focused.current = true
    },
    onBlur: () => {
      focused.current = false
      flush()
    },
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setText(e.target.value)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, 600)
    },
  }
  return multiline ? <textarea className={TEXTAREA_CLASS} {...props} /> : <input className={INPUT_CLASS} {...props} />
}

const RECOVERY_PRESETS = [0, 1, 3, 5, 10, 15]
const RECOVERY_OPTIONS = RECOVERY_PRESETS.map((m) => ({
  value: String(m),
  label: m === 0 ? '沒有喘' : `${m} 分鐘`,
}))

/**
 * 活動後喘多久才恢復：可以點常用的時間，也可以自己輸入分鐘數，兩者寫的是同一個欄位。
 * 點選項時會把輸入框清空、輸入數字時選項會取消，每次操作都立刻存，最後一次操作的結果就是存下來的值。
 */
function RecoveryField({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const customOf = (v: number | null) => (v != null && !RECOVERY_PRESETS.includes(v) ? String(v) : '')
  const [text, setText] = useState(() => customOf(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(customOf(value))
  }, [value])

  return (
    <>
      <ChoiceGroup
        label="活動後喘多久才恢復"
        columns={3}
        clearable
        options={RECOVERY_OPTIONS}
        value={value != null && text === '' && RECOVERY_PRESETS.includes(value) ? String(value) : null}
        onChange={(m) => {
          setText('')
          onChange(m == null ? null : Number(m))
        }}
      />
      <div className="mt-3">
        <Field label="其他時間（分鐘）">
          <input
            className={INPUT_CLASS}
            inputMode="numeric"
            placeholder="例如 20"
            aria-label="活動後喘多久才恢復（分鐘）"
            value={text}
            onFocus={() => {
              focused.current = true
            }}
            onBlur={() => {
              focused.current = false
              // 輸入的數字剛好是常用選項（例如 5）時，改成顯示在上面的選項裡
              setText(customOf(text === '' ? null : Number(text)))
            }}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 3)
              setText(digits)
              onChange(digits === '' ? null : Number(digits))
            }}
          />
        </Field>
      </div>
    </>
  )
}

export function DailyScreen({ date }: { date: string | null }) {
  const now = useNow()
  const today = toDateKey(now)
  const current = date && date <= today ? date : today
  const logs = useDailyLogs()
  const [savedFlash, setSavedFlash] = useState(false)
  const flashTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  if (!logs) return <Page title="每日紀錄">{null}</Page>

  const log = logs.find((l) => l.date === current)
  const v: DailyFields = log ?? emptyDailyFields()
  const cough = coughComparison(logs, current)

  const update = (patch: Partial<DailyFields>) => {
    void saveDailyLog(current, patch).then(() => {
      setSavedFlash(true)
      window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1800)
    })
  }

  const go = (key: string) => navigate(key === today ? '/daily' : `/daily/${key}`, { replace: true })

  return (
    <Page title="每日紀錄">
      {/* 換日期 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="前一天"
          onClick={() => go(addDays(current, -1))}
          className="flex size-12 items-center justify-center rounded-full bg-surface-2"
        >
          <ChevronLeft size={24} aria-hidden />
        </button>
        <div className="text-center">
          <p className="text-lg leading-snug font-bold" data-testid="daily-date">
            {current === today ? '今天' : formatDateLong(current)}
          </p>
          <p className="text-sm text-fg-2">{current === today ? formatDateLong(current) : '補填之前的紀錄'}</p>
        </div>
        <button
          type="button"
          aria-label="後一天"
          disabled={current >= today}
          onClick={() => go(addDays(current, 1))}
          className="flex size-12 items-center justify-center rounded-full bg-surface-2 disabled:opacity-35"
        >
          <ChevronRight size={24} aria-hidden />
        </button>
      </div>
      <p className="mb-4 flex h-6 items-center justify-center gap-1 text-sm text-fg-2" role="status">
        {savedFlash ? (
          <>
            <Check size={16} strokeWidth={3} className="text-ok" aria-hidden />
            已儲存
          </>
        ) : (
          '點選後會自動儲存，沒有的項目可以不填'
        )}
      </p>

      <Section title="咳嗽" hint="今天大約咳了幾次">
        <ChoiceGroup
          label="咳嗽次數"
          columns={2}
          clearable
          options={opts(COUGH_LEVELS, COUGH_LABEL)}
          value={v.cough}
          onChange={(cough) => update({ cough, ...(cough === 'none' || cough === null ? { coughContexts: [] } : {}) })}
        />
        {v.cough != null && v.cough !== 'none' && (
          <div className="mt-4">
            <p className="mb-2 text-[15px] font-medium text-fg-2">常在什麼時候咳（可複選）</p>
            <ChipGroup
              label="咳嗽的情境"
              options={opts(COUGH_CONTEXTS, COUGH_CONTEXT_LABEL)}
              values={v.coughContexts}
              onChange={(coughContexts) => update({ coughContexts })}
            />
          </div>
        )}
        {cough.more && (
          <div className="mt-4">
            <Notice tone="warn">咳嗽比過去 7 天平均多，請同時留意睡眠呼吸次數。</Notice>
          </div>
        )}
      </Section>

      <Section title="食慾">
        <ChoiceGroup
          label="食慾"
          clearable
          options={opts(APPETITES, APPETITE_LABEL)}
          value={v.appetite}
          onChange={(appetite) => update({ appetite })}
        />
      </Section>

      <Section title="精神">
        <ChoiceGroup
          label="精神"
          clearable
          options={opts(ENERGIES, ENERGY_LABEL)}
          value={v.energy}
          onChange={(energy) => update({ energy })}
        />
      </Section>

      <Section title="活動" hint="今天做了什麼活動，活動後喘多久才恢復">
        <ChipGroup
          label="活動內容"
          options={ACTIVITY_PRESETS.map((a) => ({ value: a, label: a }))}
          values={v.activities}
          onChange={(activities) => update({ activities })}
        />
        <div className="mt-3">
          <AutoSaveText
            key={`act-${current}`}
            ariaLabel="其他活動"
            placeholder="其他活動，例如：上下樓梯"
            value={v.activityNote}
            onCommit={(activityNote) => update({ activityNote })}
          />
        </div>

        <p className="mt-5 mb-2 text-[15px] font-medium text-fg-2">活動後喘多久才恢復</p>
        <RecoveryField key={`rec-${current}`} value={v.recoveryMin} onChange={(recoveryMin) => update({ recoveryMin })} />
      </Section>

      <Section title="喝水" hint="選填">
        <ChoiceGroup
          label="喝水"
          clearable
          options={opts(AMOUNTS, AMOUNT_LABEL)}
          value={v.water}
          onChange={(water) => update({ water })}
        />
      </Section>

      <Section title="排尿" hint="選填">
        <ChoiceGroup
          label="排尿"
          clearable
          options={opts(AMOUNTS, AMOUNT_LABEL)}
          value={v.urine}
          onChange={(urine) => update({ urine })}
        />
      </Section>

      <Section title="備註">
        <AutoSaveText
          key={`note-${current}`}
          multiline
          ariaLabel="備註"
          placeholder="今天有什麼特別的事"
          value={v.note}
          onCommit={(note) => update({ note })}
        />
      </Section>
    </Page>
  )
}
