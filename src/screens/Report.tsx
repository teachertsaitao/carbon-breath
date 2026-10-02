// 回診報告：選一段期間 → 產生 PDF（摘要、趨勢圖、每日表格、個別紀錄），可以分享、下載或列印。
//
// PDF 會在背景先做好。手機的「分享」必須緊接在點擊之後呼叫，不能按了才開始做。

import { ChevronLeft } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, ChoiceGroup, Field, INPUT_CLASS } from '../components/ui'
import { addDays, formatDateFull, toDateKey } from '../lib/dates'
import { useBreaths, useDailyLogs, useSettings } from '../lib/db'
import { isIOS, isStandalone, usePref } from '../lib/device'
import { canShareFile, downloadFile, shareFile } from '../lib/files'
import { useNow, useScrollLock } from '../lib/hooks'
import { APPETITE_LABEL, APPETITES, COUGH_LABEL, COUGH_LEVELS, ENERGIES, ENERGY_LABEL } from '../lib/labels'
import { buildReport, checkReportRange, countsText, type ReportData } from '../lib/report'
import { renderReport } from '../lib/reportRender'
import { navigate } from '../lib/router'
import { formatRate } from '../lib/stats'

type Preset = '7' | '14' | '30' | 'custom'

const PRESETS: { value: Preset; label: string }[] = [
  { value: '7', label: '7 天' },
  { value: '14', label: '14 天' },
  { value: '30', label: '30 天' },
  { value: 'custom', label: '自訂' },
]

interface Output {
  file: File
  /** 每一頁預覽圖的網址 */
  urls: string[]
}

/** 這支手機能不能用分享選單送出 PDF（用一個空的 PDF 檔問瀏覽器） */
function pdfShareSupported(): boolean {
  try {
    return canShareFile(new File([''], 'report.pdf', { type: 'application/pdf' }))
  } catch {
    return false
  }
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-t border-line py-2.5 text-[15px] leading-relaxed">
      <dt className="w-20 shrink-0 text-fg-2">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium">{children}</dd>
    </div>
  )
}

function Summary({ data }: { data: ReportData }) {
  const { deep, alerts } = data
  return (
    <dl className="mt-4 border-b border-line">
      <SummaryRow label="熟睡呼吸">
        {deep.count > 0 && deep.median != null
          ? `${deep.count} 筆，中位數 ${formatRate(deep.median)}（最低 ${deep.min}、最高 ${deep.max}）`
          : '這段期間沒有熟睡時的紀錄'}
      </SummaryRow>
      <SummaryRow label="警示">
        紅色 {alerts.red} 次、黃色 {alerts.yellow} 次
      </SummaryRow>
      <SummaryRow label="咳嗽">{countsText(data.cough, COUGH_LABEL, COUGH_LEVELS) || '沒有紀錄'}</SummaryRow>
      <SummaryRow label="食慾">{countsText(data.appetite, APPETITE_LABEL, APPETITES) || '沒有紀錄'}</SummaryRow>
      <SummaryRow label="精神">{countsText(data.energy, ENERGY_LABEL, ENERGIES) || '沒有紀錄'}</SummaryRow>
    </dl>
  )
}

/** 把其中一頁放大來看：手機上的預覽圖很小，點一下可以用原本的大小上下左右滑著看 */
function PageZoom({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  useScrollLock(true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="no-print anim-fade-in fixed inset-0 z-50 flex flex-col bg-bg text-fg"
    >
      <div
        className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 pb-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
      >
        <p className="text-[15px] font-medium text-fg-2">{label}（可以上下左右滑動）</p>
        <button
          type="button"
          onClick={onClose}
          className="h-11 shrink-0 rounded-full bg-surface-2 px-5 text-[15px] font-bold"
        >
          關閉
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-surface-2">
        {/* 794 是報告排版時的寬度，用這個大小看，字跟印出來差不多大 */}
        <img src={url} alt={label} className="block bg-white" style={{ width: 794, maxWidth: 'none' }} />
      </div>
    </div>
  )
}

export function ReportScreen() {
  const settings = useSettings()
  const breaths = useBreaths()
  const logs = useDailyLogs()
  const today = toDateKey(useNow())

  const [rangePref, setRangePref] = usePref('reportRange', '14')
  const preset: Preset = rangePref === '7' || rangePref === '30' || rangePref === 'custom' ? rangePref : '14'
  const [customFrom, setCustomFrom] = useState(() => addDays(today, -13))
  const [customTo, setCustomTo] = useState(today)
  const from = preset === 'custom' ? customFrom : addDays(today, -(Number(preset) - 1))
  const to = preset === 'custom' ? customTo : today
  const rangeError = checkReportRange(from, to, today)

  const data = useMemo(
    () => (settings && breaths && logs && !rangeError ? buildReport(breaths, logs, settings, from, to, today) : null),
    [settings, breaths, logs, rangeError, from, to, today],
  )

  const [output, setOutput] = useState<Output | null>(null)
  const [failed, setFailed] = useState(false)
  const [message, setMessage] = useState('')
  /** 正在放大看第幾頁（從 0 開始算）；null 是沒有在放大 */
  const [zoom, setZoom] = useState<number | null>(null)

  // 報告內容一變，就在背景重新做一份 PDF
  useEffect(() => {
    setOutput(null)
    setFailed(false)
    setMessage('')
    setZoom(null)
    if (!data) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      renderReport(data)
        .then((result) => {
          if (cancelled) return
          setOutput({ file: result.file, urls: result.previews.map((blob) => URL.createObjectURL(blob)) })
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [data])

  // 換了一份報告或離開這一頁時，把舊的預覽圖釋放掉
  useEffect(() => {
    if (!output) return
    return () => output.urls.forEach((url) => URL.revokeObjectURL(url))
  }, [output])

  const shareable = useMemo(pdfShareSupported, [])
  const ios = isIOS()
  // iPhone 從主畫面開啟的 App 叫不出列印畫面，要列印請走分享選單裡的「列印」
  const canPrint = !(ios && isStandalone())
  const showDownload = !shareable || !ios

  // 分享選單還開著的時候再按一次，瀏覽器會回報失敗；用這個記號擋掉，才不會誤以為真的不能分享
  const sharing = useRef(false)
  const onShare = async () => {
    if (!output || sharing.current) return
    sharing.current = true
    setMessage('')
    try {
      const result = await shareFile(output.file)
      if (result === 'failed') {
        downloadFile(output.file)
        setMessage('這支手機開不了分享選單，已改成直接下載 PDF。')
      }
    } finally {
      sharing.current = false
    }
  }
  const onDownload = () => {
    if (!output) return
    downloadFile(output.file)
    setMessage('PDF 已下載，可以到手機的「下載」或「檔案」裡找到。')
  }
  const onPrint = () => {
    setMessage('')
    window.print()
  }

  return (
    <main
      className="report-screen mx-auto w-full max-w-[480px] px-5"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 92px)',
      }}
    >
      <div className="no-print">
        <button
          type="button"
          onClick={() => navigate('/trends')}
          className="-ml-2 flex h-11 items-center gap-0.5 pr-3 text-[15px] font-medium text-fg-2"
        >
          <ChevronLeft size={20} aria-hidden />
          趨勢
        </button>
        <h1 className="text-[28px] leading-tight font-bold">回診報告</h1>
        <p className="mt-1 mb-5 text-[15px] leading-relaxed text-fg-2">選一段期間，整理成 PDF 給獸醫師看。</p>

        <ChoiceGroup label="報告期間" options={PRESETS} value={preset} onChange={(v) => v && setRangePref(v)} />
        {preset === 'custom' && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="開始">
              <input
                className={INPUT_CLASS}
                type="date"
                value={customFrom}
                max={today}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </Field>
            <Field label="結束">
              <input
                className={INPUT_CLASS}
                type="date"
                value={customTo}
                max={today}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </Field>
          </div>
        )}
        {rangeError ? (
          <p className="mt-3 text-[15px] font-medium text-danger" role="alert">
            {rangeError}
          </p>
        ) : (
          <p className="mt-3 text-[15px] text-fg-2" data-testid="report-range">
            {formatDateFull(from)} – {formatDateFull(to)}
          </p>
        )}

        {data && <Summary data={data} />}

        {data && (
          <>
            <div className="mt-5 flex flex-col gap-2.5">
              {shareable ? (
                <Button disabled={!output} onClick={() => void onShare()}>
                  {ios ? '分享或儲存 PDF' : '分享 PDF'}
                </Button>
              ) : (
                <Button disabled={!output} onClick={onDownload}>
                  下載 PDF
                </Button>
              )}
              {(canPrint || (shareable && showDownload)) && (
                <div className="flex gap-2.5">
                  {shareable && showDownload && (
                    <Button variant="secondary" className="flex-1" disabled={!output} onClick={onDownload}>
                      下載 PDF
                    </Button>
                  )}
                  {canPrint && (
                    <Button variant="secondary" className="flex-1" disabled={!output} onClick={onPrint}>
                      列印
                    </Button>
                  )}
                </div>
              )}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-fg-2">
              {shareable && ios
                ? '分享選單裡可以選「儲存到檔案」、傳 LINE、AirDrop，或「列印」。'
                : shareable
                  ? '「分享」可以直接傳 LINE 或寄信；「下載」會把 PDF 存到手機。'
                  : 'PDF 會下載到這台裝置。'}
            </p>
            {message && (
              <p className="mt-3 rounded-2xl bg-ok-bg px-4 py-3 text-[15px]" role="status">
                {message}
              </p>
            )}
          </>
        )}
      </div>

      {data && (
        <section className="mt-7">
          <h2 className="no-print text-[17px] font-bold">預覽{output ? `（共 ${output.urls.length} 頁）` : ''}</h2>
          {output && <p className="no-print mt-1 text-sm text-fg-2">點一下頁面可以放大看。</p>}
          {failed ? (
            <p className="no-print mt-2 text-[15px] text-danger" role="alert">
              報告產生失敗。請重新整理後再試一次。
            </p>
          ) : !output ? (
            <p className="no-print mt-2 text-[15px] text-fg-2" role="status">
              正在產生報告…
            </p>
          ) : (
            <div className="report-pages mt-3 flex flex-col gap-3">
              {output.urls.map((url, i) => (
                <img
                  key={url}
                  src={url}
                  alt={`報告第 ${i + 1} 頁，點一下放大`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setZoom(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setZoom(i)
                    }
                  }}
                  className="report-page w-full cursor-zoom-in rounded-lg border border-line bg-white"
                />
              ))}
            </div>
          )}
        </section>
      )}

      {output && zoom != null && output.urls[zoom] && (
        <PageZoom
          url={output.urls[zoom]}
          label={`第 ${zoom + 1}／${output.urls.length} 頁`}
          onClose={() => setZoom(null)}
        />
      )}
    </main>
  )
}
