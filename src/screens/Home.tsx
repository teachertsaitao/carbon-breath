// 首頁：燈號、最近一次熟睡呼吸數、基準值、今天的紀錄狀態，以及「量呼吸」大按鈕。

import { ChevronRight, CircleCheck, Siren, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { AlertCard, CallButtons } from '../components/AlertCard'
import { StatusDial } from '../components/Dial'
import { InstallHint } from '../components/InstallHint'
import { Page } from '../components/Layout'
import { Button, Notice, Sheet } from '../components/ui'
import { coughComparison, homeStatus, type Light } from '../lib/alerts'
import { formatDateLong, formatDateShort, formatDateTimeRelative, toDateKey } from '../lib/dates'
import { dailyFilledCount, useBreaths, useDailyLogs, useSettings } from '../lib/db'
import { useNow } from '../lib/hooks'
import { DISCLAIMER, YELLOW_ADVICE, describeAlert } from '../lib/labels'
import { navigate } from '../lib/router'
import { hasPhone } from '../lib/settings'
import { formatRate } from '../lib/stats'

const LIGHT_TEXT: Record<Light, { label: string; icon: ReactNode }> = {
  green: { label: '正常', icon: <CircleCheck size={22} strokeWidth={2.5} className="text-ok" aria-hidden /> },
  yellow: { label: '偏高，請留意', icon: <TriangleAlert size={22} strokeWidth={2.5} className="text-warn" aria-hidden /> },
  red: { label: '請立即聯絡醫師', icon: <Siren size={22} strokeWidth={2.5} className="text-danger" aria-hidden /> },
  idle: { label: '24 小時內沒有熟睡紀錄', icon: null },
}

function Row({ label, detail, value, onClick }: { label: string; detail?: string; value: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium">{label}</span>
        {detail && <span className="mt-0.5 block text-sm text-fg-2">{detail}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-base font-bold">
        {value}
        {onClick && <ChevronRight size={20} className="text-fg-3" aria-hidden />}
      </span>
    </>
  )
  const cls = 'flex min-h-16 w-full items-center gap-3 border-t border-line py-3 text-left'
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function HomeScreen() {
  const settings = useSettings()
  const breaths = useBreaths()
  const logs = useDailyLogs()
  const now = useNow()
  const [callOpen, setCallOpen] = useState(false)

  if (!settings || !breaths || !logs) return <Page title=" ">{null}</Page>

  const t = settings.thresholds
  const today = toDateKey(now)
  const status = homeStatus(breaths, now, t)
  const { latestDeep, decisive, decisiveAlert, baseline, consecutive } = status
  const light = LIGHT_TEXT[status.light]
  const todayLog = logs.find((l) => l.date === today)
  const filled = dailyFilledCount(todayLog)
  const cough = coughComparison(logs, today)
  const missing = t.baselineMinCount - baseline.count

  return (
    <>
      <Page title={settings.pet.name.trim() || '呼吸紀錄'} aside={formatDateLong(today)} extraBottom={84}>
        <InstallHint />

        <div className="flex items-center gap-5">
          <StatusDial tone={status.light}>
            {latestDeep ? (
              <>
                <span className="text-[46px] leading-none font-bold" data-testid="latest-rate">
                  {latestDeep.rate}
                </span>
                <span className="mt-1.5 text-sm text-fg-2">次／分</span>
              </>
            ) : (
              <span className="text-[15px] leading-snug text-fg-2">
                還沒有
                <br />
                紀錄
              </span>
            )}
          </StatusDial>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xl leading-snug font-bold" data-testid="light" data-light={status.light}>
              {light.icon}
              {light.label}
            </p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-fg-2">
              {latestDeep ? (
                <>
                  最近一次熟睡呼吸
                  <br />
                  {formatDateTimeRelative(latestDeep.measuredAt, now)}
                </>
              ) : (
                '等牠熟睡後量第一次，這裡會顯示結果。'
              )}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          {status.light === 'red' && decisive && decisiveAlert && (
            <AlertCard record={decisive} alert={decisiveAlert} contacts={settings.contacts} />
          )}

          {status.light === 'yellow' && decisive && decisiveAlert?.level === 'yellow' && (
            <Notice tone="warn" icon={<TriangleAlert size={20} className="text-warn" aria-hidden />}>
              <p className="font-bold">{formatDateTimeRelative(decisive.measuredAt, now)} 量到偏快</p>
              <ul className="mt-1">
                {describeAlert(decisive, decisiveAlert).reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mt-1">{YELLOW_ADVICE}</p>
            </Notice>
          )}

          {consecutive.active && (
            <Notice tone="warn" icon={<TriangleAlert size={20} className="text-warn" aria-hidden />}>
              <p className="font-bold">連續兩天熟睡呼吸都偏高</p>
              <p className="mt-1">
                {consecutive.days
                  .map((d) => `${formatDateShort(d.date)} 中位數 ${formatRate(d.median)}`)
                  .join('，')}
                。持續偏高請聯絡醫師。
              </p>
            </Notice>
          )}

          {status.light === 'green' && (status.last24h.red > 0 || status.last24h.yellow > 0) && (
            <Notice>
              過去 24 小時有
              {status.last24h.red > 0 && ` ${status.last24h.red} 次紅色警示`}
              {status.last24h.red > 0 && status.last24h.yellow > 0 && '、'}
              {status.last24h.yellow > 0 && ` ${status.last24h.yellow} 次黃色警示`}
              ，之後再量已回到正常。
            </Notice>
          )}

          {cough.more && <Notice tone="warn">今天咳嗽比過去 7 天平均多，請同時留意睡眠呼吸次數。</Notice>}
        </div>

        <div className="mt-5 border-b border-line">
          <Row
            label="基準值"
            detail={
              baseline.value != null
                ? `近 ${t.baselineDays} 天 ${baseline.count} 筆熟睡紀錄的中位數`
                : `近 ${t.baselineDays} 天要有 ${t.baselineMinCount} 筆熟睡紀錄才會顯示，還差 ${missing} 筆`
            }
            value={baseline.value != null ? `${formatRate(baseline.value)} 次／分` : '—'}
          />
          <Row
            label="今天量呼吸"
            detail={status.today.total > 0 ? `其中熟睡時 ${status.today.deep} 次` : undefined}
            value={status.today.total > 0 ? `${status.today.total} 次` : '還沒量'}
            onClick={() => navigate('/trends')}
          />
          <Row
            label="今天的每日紀錄"
            detail="咳嗽、食慾、精神、活動"
            value={filled > 0 ? `已填 ${filled} 項` : '還沒填'}
            onClick={() => navigate('/daily')}
          />
          <Row
            label="聯絡醫院"
            detail={
              [settings.contacts.emergency, settings.contacts.regular]
                .filter((c) => hasPhone(c.phone))
                .map((c) => c.name.trim())
                .filter(Boolean)
                .join('、') || '還沒有設定電話'
            }
            value="撥號"
            onClick={() => setCallOpen(true)}
          />
          <Row
            label="回診報告"
            detail="整理成 PDF 給獸醫師看"
            value="製作"
            onClick={() => navigate('/report')}
          />
        </div>

        <p className="mt-6 text-sm leading-relaxed text-fg-2">{DISCLAIMER}</p>
      </Page>

      <Sheet open={callOpen} title="聯絡醫院" onClose={() => setCallOpen(false)}>
        <CallButtons contacts={settings.contacts} urgent={false} />
        {!hasPhone(settings.contacts.emergency.phone) && !hasPhone(settings.contacts.regular.phone) && (
          <p className="text-base text-fg-2">還沒有設定醫院電話。</p>
        )}
        <div className="mt-2.5 flex flex-col gap-2.5">
          <Button
            variant="secondary"
            onClick={() => {
              setCallOpen(false)
              navigate('/settings')
            }}
          >
            修改電話
          </Button>
          <Button variant="ghost" size="md" onClick={() => setCallOpen(false)}>
            關閉
          </Button>
        </div>
      </Sheet>

      {/* 固定在分頁列上方：拇指最好按的位置 */}
      <div
        className="no-print pointer-events-none fixed inset-x-0 z-20 bg-linear-to-t from-bg from-70% to-transparent pt-6"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)' }}
      >
        <div className="pointer-events-auto mx-auto max-w-[480px] px-5 pb-3">
          <Button className="w-full" onClick={() => navigate('/measure')}>
            量呼吸
          </Button>
        </div>
      </div>
    </>
  )
}
