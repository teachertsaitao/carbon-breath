// 設定：寵物資料、警示門檻、聯絡電話、計數方式、外觀、備份。改了就自動儲存。

import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Page } from '../components/Layout'
import { Button, ChoiceGroup, Field, INPUT_CLASS, Section } from '../components/ui'
import { buildBackupFile, deliverBackupFile, importBackup, parseBackup } from '../lib/backup'
import { formatDateTimeRelative } from '../lib/dates'
import { resetSetting, saveSetting, useBreaths, useDailyLogs, useSettings } from '../lib/db'
import { canVibrate, usePref } from '../lib/device'
import { DISCLAIMER } from '../lib/labels'
import { navigate } from '../lib/router'
import { APP_VERSION } from '../lib/version'

/** 文字欄位：離開欄位時才儲存 */
function TextSetting({
  value,
  onCommit,
  type = 'text',
  inputMode,
  placeholder,
}: {
  value: string
  onCommit: (v: string) => void
  type?: 'text' | 'tel' | 'date'
  inputMode?: 'tel' | 'text'
  placeholder?: string
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      className={INPUT_CLASS}
      type={type}
      inputMode={inputMode}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        // 日期欄位是用選的，選完直接存
        if (type === 'date') onCommit(e.target.value)
      }}
      onBlur={() => {
        if (text.trim() !== value) onCommit(text.trim())
      }}
    />
  )
}

/** 數字欄位（整數）：離開欄位時檢查範圍，不合理就還原 */
function NumberSetting({
  value,
  min,
  max,
  suffix,
  onCommit,
  onEdit,
}: {
  value: number
  min: number
  max: number
  suffix: string
  /** 回傳 false 表示沒有接受這個值 */
  onCommit: (v: number) => boolean | void
  /** 使用者開始改這一欄（用來清掉之前的錯誤訊息） */
  onEdit?: () => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = Math.round(Number(text))
    const valid = text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max
    const accepted = valid && (n === value || onCommit(n) !== false)
    // 不管有沒有接受，欄位都顯示實際生效的數字（例如打 30.4 會顯示 30）
    setText(String(accepted ? n : value))
  }
  return (
    <div className="relative">
      <input
        className={`${INPUT_CLASS} pr-20 tabular-nums`}
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onEdit?.()
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[15px] text-fg-2">
        {suffix}
      </span>
    </div>
  )
}

export function SettingsScreen() {
  const settings = useSettings()
  const breaths = useBreaths()
  const logs = useDailyLogs()
  const [theme, setTheme] = usePref('theme', 'auto')
  const [haptics, setHaptics] = usePref('haptics', 'on')
  const [recorder, setRecorder] = usePref('recorder', '')
  const [lastExport] = usePref('lastExportAt', '')
  const [thresholdError, setThresholdError] = useState('')
  const [backupMessage, setBackupMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // 備份檔先準備好：手機的「分享」必須緊接在點擊之後呼叫，不能按了才開始讀資料庫。
  // 資料一有變動就重新準備一份。
  const prepared = useRef<File | null>(null)
  useEffect(() => {
    let cancelled = false
    prepared.current = null
    buildBackupFile()
      .then((file) => {
        if (!cancelled) prepared.current = file
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [settings, breaths, logs])

  if (!settings) return <Page title="設定">{null}</Page>
  const { pet, thresholds: t, contacts, counter } = settings

  const clearThresholdError = () => setThresholdError('')

  const setThreshold = (patch: Partial<typeof t>): boolean => {
    const next = { ...t, ...patch }
    if (next.yellowRate >= next.redRate) {
      setThresholdError('黃色門檻要比紅色門檻低，沒有儲存這次修改。')
      return false
    }
    setThresholdError('')
    void saveSetting('thresholds', next)
    return true
  }

  const onExport = async () => {
    setBackupMessage(null)
    try {
      const result = await deliverBackupFile(prepared.current ?? (await buildBackupFile()))
      if (result !== 'cancelled') setBackupMessage({ tone: 'ok', text: '備份檔已匯出。' })
    } catch {
      setBackupMessage({ tone: 'error', text: '匯出失敗，請再試一次。' })
    }
  }

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    setBackupMessage(null)
    try {
      const { backup, dropped } = parseBackup(await file.text())
      const result = await importBackup(backup)
      setBackupMessage({
        tone: 'ok',
        text:
          `匯入完成：新增 ${result.added} 筆、更新 ${result.updated} 筆，另外 ${result.skipped} 筆手機裡已經是最新的。` +
          (dropped > 0 ? `檔案裡有 ${dropped} 筆格式不對，已略過。` : ''),
      })
    } catch (err) {
      setBackupMessage({ tone: 'error', text: err instanceof Error ? err.message : '匯入失敗。' })
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <Page title="設定">
      <Section title="寵物資料">
        <div className="flex flex-col gap-4">
          <Field label="名字">
            <TextSetting value={pet.name} onCommit={(name) => void saveSetting('pet', { ...pet, name })} />
          </Field>
          <Field label="品種">
            <TextSetting value={pet.breed} onCommit={(breed) => void saveSetting('pet', { ...pet, breed })} />
          </Field>
          <Field label="生日">
            <TextSetting type="date" value={pet.birthday} onCommit={(birthday) => void saveSetting('pet', { ...pet, birthday })} />
          </Field>
        </div>
      </Section>

      <Section title="警示門檻" hint="只用「熟睡」的紀錄判斷。請依獸醫師的建議調整。">
        <div className="flex flex-col gap-4">
          <Field label="黃色警示：熟睡呼吸數達到">
            <NumberSetting value={t.yellowRate} min={10} max={100} suffix="次／分" onEdit={clearThresholdError} onCommit={(yellowRate) => setThreshold({ yellowRate })} />
          </Field>
          <Field label="紅色警示：熟睡呼吸數達到">
            <NumberSetting value={t.redRate} min={10} max={150} suffix="次／分" onEdit={clearThresholdError} onCommit={(redRate) => setThreshold({ redRate })} />
          </Field>
          <Field label="黃色警示：比基準值高出" hint={`例如基準值 20、設定 ${t.baselinePct}%，量到 ${Math.ceil(20 * (1 + t.baselinePct / 100))} 以上就會提醒。`}>
            <NumberSetting value={t.baselinePct} min={5} max={100} suffix="% 以上" onEdit={clearThresholdError} onCommit={(baselinePct) => setThreshold({ baselinePct })} />
          </Field>
          <Field label="基準值取最近">
            <NumberSetting value={t.baselineDays} min={3} max={30} suffix="天" onEdit={clearThresholdError} onCommit={(baselineDays) => setThreshold({ baselineDays })} />
          </Field>
          <Field label="至少要有幾筆熟睡紀錄才顯示基準值">
            <NumberSetting value={t.baselineMinCount} min={1} max={30} suffix="筆" onEdit={clearThresholdError} onCommit={(baselineMinCount) => setThreshold({ baselineMinCount })} />
          </Field>
          {thresholdError && (
            <p className="text-[15px] font-medium text-danger" role="alert">
              {thresholdError}
            </p>
          )}
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              setThresholdError('')
              void resetSetting('thresholds')
            }}
          >
            恢復預設門檻
          </Button>
        </div>
      </Section>

      <Section title="聯絡電話" hint="出現紅色警示時可以一鍵撥號。">
        <div className="flex flex-col gap-4">
          <Field label="常規醫院名稱">
            <TextSetting
              value={contacts.regular.name}
              onCommit={(name) => void saveSetting('contacts', { ...contacts, regular: { ...contacts.regular, name } })}
            />
          </Field>
          <Field label="常規醫院電話" hint="一欄填一支電話。分機不用填，撥通後再按。">
            <TextSetting
              type="tel"
              inputMode="tel"
              value={contacts.regular.phone}
              onCommit={(phone) => void saveSetting('contacts', { ...contacts, regular: { ...contacts.regular, phone } })}
            />
          </Field>
          <Field label="24 小時急診醫院名稱">
            <TextSetting
              placeholder="還沒填"
              value={contacts.emergency.name}
              onCommit={(name) => void saveSetting('contacts', { ...contacts, emergency: { ...contacts.emergency, name } })}
            />
          </Field>
          <Field label="24 小時急診醫院電話">
            <TextSetting
              type="tel"
              inputMode="tel"
              placeholder="還沒填"
              value={contacts.emergency.phone}
              onCommit={(phone) => void saveSetting('contacts', { ...contacts, emergency: { ...contacts.emergency, phone } })}
            />
          </Field>
        </div>
      </Section>

      <Section title="量呼吸">
        <div className="flex flex-col gap-4">
          <Field label="「數幾次」模式要點滿">
            <NumberSetting
              value={counter.quickTarget}
              min={5}
              max={30}
              suffix="次"
              onCommit={(quickTarget) => void saveSetting('counter', { ...counter, quickTarget })}
            />
          </Field>
          <div>
            <p className="mb-1.5 text-[15px] font-medium text-fg-2">點擊時震動</p>
            {canVibrate ? (
              <ChoiceGroup
                label="點擊時震動"
                options={[
                  { value: 'on', label: '開' },
                  { value: 'off', label: '關' },
                ]}
                value={haptics === 'off' ? 'off' : 'on'}
                onChange={(v) => v && setHaptics(v)}
              />
            ) : (
              <p className="text-[15px] text-fg-2">這支手機的瀏覽器不支援震動（iPhone 都不支援），點擊時只有畫面回饋。</p>
            )}
          </div>
          <Field label="這支手機的記錄者（選填）" hint="家人各自用自己的手機記錄時，填名字方便分辨是誰量的。">
            <TextSetting value={recorder} placeholder="例如：爸爸" onCommit={setRecorder} />
          </Field>
        </div>
      </Section>

      <Section title="外觀" hint="量呼吸的畫面固定是最暗的夜間配色。">
        <ChoiceGroup
          label="外觀"
          options={[
            { value: 'auto', label: '跟隨手機' },
            { value: 'light', label: '淺色' },
            { value: 'dark', label: '深色' },
          ]}
          value={theme === 'light' || theme === 'dark' ? theme : 'auto'}
          onChange={(v) => v && setTheme(v)}
        />
      </Section>

      <Section
        title="備份"
        hint="資料只存在這支手機裡。換手機前、或想把兩支手機的紀錄合在一起時，先匯出再到另一支手機匯入。"
      >
        <p className="mb-3 text-[15px] text-fg-2">
          目前有 {breaths?.length ?? 0} 筆呼吸紀錄、{logs?.length ?? 0} 天的每日紀錄。
          {lastExport ? `上次匯出：${formatDateTimeRelative(lastExport)}。` : '還沒有匯出過備份。'}
        </p>
        <div className="flex flex-col gap-2.5">
          <Button onClick={() => void onExport()}>匯出備份檔</Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            從備份檔匯入
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="選擇備份檔"
            onChange={(e) => void onImportFile(e.target.files?.[0])}
          />
        </div>
        <p className="mt-3 text-sm text-fg-2">
          匯入不會蓋掉手機裡原有的紀錄：手機裡沒有的會加進來；兩邊都有的呼吸紀錄以比較新的為準；同一天的每日紀錄和設定，一邊沒填的會用另一邊的補上。
        </p>
        {backupMessage && (
          <p
            className={`mt-3 rounded-2xl px-4 py-3 text-[15px] ${backupMessage.tone === 'ok' ? 'bg-ok-bg' : 'bg-danger-bg'}`}
            role={backupMessage.tone === 'ok' ? 'status' : 'alert'}
          >
            {backupMessage.text}
          </p>
        )}
      </Section>

      <Section title="說明">
        <button
          type="button"
          onClick={() => navigate('/guide')}
          className="flex min-h-14 w-full items-center justify-between border-b border-line text-left text-base font-medium"
        >
          怎麼量睡眠呼吸次數
          <ChevronRight size={20} className="text-fg-3" aria-hidden />
        </button>
        <p className="mt-4 text-[15px] leading-relaxed text-fg-2">{DISCLAIMER}</p>
        <p className="mt-3 text-sm text-fg-3">版本 {APP_VERSION}</p>
      </Section>
    </Page>
  )
}
