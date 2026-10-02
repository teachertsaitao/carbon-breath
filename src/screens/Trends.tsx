// 趨勢：呼吸次數和咳嗽的圖表（7／14／30 天），下面是這段期間的每一筆呼吸紀錄。

import { Plus, Siren, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AlertCard } from '../components/AlertCard'
import { CoughChart } from '../components/charts/CoughChart'
import { SrrChart } from '../components/charts/SrrChart'
import { Page } from '../components/Layout'
import { RecordFields, type RecordFieldValues } from '../components/RecordFields'
import { Button, ChoiceGroup, Notice, Sheet } from '../components/ui'
import { evaluateAll } from '../lib/alerts'
import { addDays, formatDateRelative, formatTime, toDateKey } from '../lib/dates'
import { deleteBreath, restoreBreath, updateBreath, useBreaths, useDailyLogs, useSettings } from '../lib/db'
import { usePref } from '../lib/device'
import { useNow } from '../lib/hooks'
import { MODE_LABEL, STATE_LABEL } from '../lib/labels'
import { navigate } from '../lib/router'
import { currentBaseline } from '../lib/stats'
import type { AlertLevel, AlertResult, BreathRecord, Settings } from '../lib/types'

const RANGES = [
  { value: '7', label: '7 天' },
  { value: '14', label: '14 天' },
  { value: '30', label: '30 天' },
]

function RecordRow({ record, level, onOpen }: { record: BreathRecord; level: AlertLevel; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-16 w-full items-center gap-4 border-t border-line py-3 text-left"
    >
      <span className="w-12 shrink-0 text-[15px] text-fg-2 tabular-nums">{formatTime(record.measuredAt)}</span>
      <span className="w-20 shrink-0">
        <span className="text-2xl leading-none font-bold">{record.rate}</span>
        <span className="ml-1 text-sm text-fg-2">次／分</span>
      </span>
      <span className="min-w-0 flex-1 text-[15px]">
        <span className={record.state === 'deep' ? 'font-medium' : 'text-fg-2'}>
          {STATE_LABEL[record.state]}
          {record.state !== 'deep' && '（不列入）'}
        </span>
        {level !== 'none' && (
          <span className={`mt-0.5 flex items-center gap-1 text-sm font-bold ${level === 'red' ? 'text-danger' : 'text-warn'}`}>
            {level === 'red' ? <Siren size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
            {level === 'red' ? '紅色警示' : '黃色警示'}
          </span>
        )}
        {record.note && <span className="mt-0.5 block truncate text-sm text-fg-2">{record.note}</span>}
      </span>
    </button>
  )
}

interface RecordSheetProps {
  record: BreathRecord
  alert: AlertResult
  settings: Settings
  onClose: () => void
  onDeleted: (id: string) => void
}

function RecordSheet({ record, alert, settings, onClose, onDeleted }: RecordSheetProps) {
  const [fields, setFields] = useState<RecordFieldValues>({
    state: record.state,
    signs: record.signs,
    note: record.note,
  })
  // 開始確認刪除的時間；0 表示還沒按「刪除這筆紀錄」
  const [confirmingSince, setConfirmingSince] = useState(0)
  const confirming = confirmingSince > 0
  const [busy, setBusy] = useState(false)

  const changed =
    fields.state !== record.state ||
    fields.note !== record.note ||
    fields.signs.length !== record.signs.length ||
    fields.signs.some((s) => !record.signs.includes(s))

  const save = async () => {
    if (!fields.state || busy) return
    setBusy(true)
    await updateBreath(record.id, { state: fields.state, signs: fields.signs, note: fields.note })
    onClose()
  }
  const remove = async () => {
    // 確認鈕剛出現的 0.6 秒內不接受點擊：連點兩下「刪除這筆紀錄」不會直接刪掉
    if (busy || performance.now() - confirmingSince < 600) return
    setBusy(true)
    await deleteBreath(record.id)
    onDeleted(record.id)
    onClose()
  }

  const how =
    record.mode === 'manual'
      ? MODE_LABEL.manual
      : record.mode === 'timed'
        ? `${MODE_LABEL.timed} ${record.durationSec} 秒，數到 ${record.breaths} 次`
        : `${MODE_LABEL.quick}，${record.breaths} 次花了 ${record.durationSec} 秒`

  return (
    <Sheet open title={`${formatDateRelative(record.date)} ${formatTime(record.measuredAt)}`} onClose={onClose}>
      <p className="flex items-baseline gap-2">
        <span className="text-[56px] leading-none font-bold">{record.rate}</span>
        <span className="text-lg font-medium text-fg-2">次／分</span>
      </p>
      <p className="mt-1.5 mb-4 text-sm text-fg-2">
        {how}
        {record.recorder && `，${record.recorder} 記錄`}
      </p>

      {alert.level !== 'none' && (
        <div className="mb-5">
          <AlertCard record={record} alert={alert} contacts={settings.contacts} />
        </div>
      )}

      <RecordFields value={fields} onChange={setFields} />

      {confirming ? (
        <div className="mt-2 rounded-2xl bg-danger-bg p-4">
          <p className="text-base font-bold">確定要刪除這筆紀錄嗎？</p>
          <div className="mt-3 flex gap-2.5">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => setConfirmingSince(0)}>
              不要刪
            </Button>
            <Button variant="danger" size="md" className="flex-1" disabled={busy} onClick={remove}>
              刪除
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2.5">
          <Button disabled={!changed || busy} onClick={save}>
            儲存修改
          </Button>
          <Button variant="secondary" onClick={onClose}>
            關閉
          </Button>
          <Button variant="ghost" size="md" className="text-danger" onClick={() => setConfirmingSince(performance.now())}>
            刪除這筆紀錄
          </Button>
        </div>
      )}
    </Sheet>
  )
}

export function TrendsScreen() {
  const settings = useSettings()
  const breaths = useBreaths()
  const logs = useDailyLogs()
  const now = useNow()
  const [range, setRange] = usePref('trendRange', '7')
  const [openId, setOpenId] = useState<string | null>(null)
  // 剛刪掉的那一筆：畫面上留 10 秒的「復原」
  const [deletedId, setDeletedId] = useState<string | null>(null)
  useEffect(() => {
    if (!deletedId) return
    const id = window.setTimeout(() => setDeletedId(null), 10_000)
    return () => window.clearTimeout(id)
  }, [deletedId])
  // 每一筆紀錄的警示燈號，用目前的門檻現算
  const alerts = useMemo(
    () => (settings && breaths ? evaluateAll(breaths, settings.thresholds) : null),
    [settings, breaths],
  )

  if (!settings || !breaths || !logs || !alerts) return <Page title="趨勢">{null}</Page>

  const today = toDateKey(now)
  const days = range === '14' ? 14 : range === '30' ? 30 : 7
  const from = addDays(today, -(days - 1))
  const baseline = currentBaseline(breaths, today, settings.thresholds).value

  const inRange = breaths.filter((r) => r.date >= from && r.date <= today)
  const byDate = new Map<string, BreathRecord[]>()
  for (const r of [...inRange].reverse()) {
    const list = byDate.get(r.date)
    if (list) list.push(r)
    else byDate.set(r.date, [r])
  }
  const open = openId ? breaths.find((r) => r.id === openId) : undefined
  const openAlert = open ? alerts.get(open.id) : undefined

  return (
    <Page
      title="趨勢"
      aside={
        <button
          type="button"
          onClick={() => navigate('/report')}
          className="h-10 rounded-xl bg-surface-2 px-3.5 text-[15px] font-bold text-fg"
        >
          回診報告
        </button>
      }
    >
      <ChoiceGroup label="顯示期間" options={RANGES} value={String(days)} onChange={(v) => v && setRange(v)} />

      <div className="mt-4 flex flex-col gap-4">
        <SrrChart breaths={breaths} days={days} today={today} thresholds={settings.thresholds} baseline={baseline} />
        <CoughChart logs={logs} days={days} today={today} />
      </div>

      <section className="mt-7">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-bold">呼吸紀錄</h2>
          <button
            type="button"
            onClick={() => navigate('/manual')}
            className="flex h-11 items-center gap-1 text-[15px] font-bold text-fg-2 underline underline-offset-4"
          >
            <Plus size={18} strokeWidth={2.5} aria-hidden />
            手動補登
          </button>
        </div>

        {byDate.size === 0 ? (
          <p className="mt-2 border-t border-line py-6 text-[15px] text-fg-2">
            最近 {days} 天還沒有呼吸紀錄。回首頁按「量呼吸」開始第一筆。
          </p>
        ) : (
          [...byDate.entries()].map(([date, list]) => (
            <div key={date} className="mt-4">
              <h3 className="mb-1 text-[15px] font-bold text-fg-2">{formatDateRelative(date, today)}</h3>
              <div className="border-b border-line">
                {list.map((r) => (
                  <RecordRow
                    key={r.id}
                    record={r}
                    level={alerts.get(r.id)?.level ?? 'none'}
                    onOpen={() => setOpenId(r.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {open && openAlert && (
        <RecordSheet
          key={open.id}
          record={open}
          alert={openAlert}
          settings={settings}
          onClose={() => setOpenId(null)}
          onDeleted={setDeletedId}
        />
      )}

      {deletedId && (
        <div
          className="no-print fixed inset-x-0 z-30 px-5"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}
          role="status"
        >
          <div className="mx-auto max-w-[440px] shadow-lg">
            <Notice>
              <div className="flex items-center justify-between gap-3">
                <span>已刪除 1 筆紀錄</span>
                <button
                  type="button"
                  className="h-10 px-2 font-bold underline underline-offset-4"
                  onClick={() => {
                    void restoreBreath(deletedId)
                    setDeletedId(null)
                  }}
                >
                  復原
                </button>
              </div>
            </Notice>
          </div>
        </div>
      )}
    </Page>
  )
}
