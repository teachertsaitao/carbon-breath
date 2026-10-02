// 咳嗽趨勢圖：每天一根柱子，高度是當天選的次數範圍（0／1–3／4–10／10 次以上）。
// 有填「0 次」的日子畫一個小點，跟「那天沒填」區分開來。

import { useMemo, useState } from 'react'
import { addDays, dateRange, formatDateLong, formatDateShort } from '../../lib/dates'
import { useMeasuredWidth } from '../../lib/hooks'
import { COUGH_CONTEXT_LABEL, COUGH_LABEL } from '../../lib/labels'
import type { CoughLevel, DailyLog } from '../../lib/types'
import { ChartCard, Readout, ReadoutValue, TABLE_CLASS, TD_CLASS, TH_CLASS } from './ChartCard'

interface Props {
  logs: DailyLog[]
  days: number
  today: string
}

const H = 176
const M = { top: 12, right: 12, bottom: 26, left: 44 }
const LEVEL_INDEX: Record<CoughLevel, number> = { none: 0, few: 1, some: 2, many: 3 }
const LEVEL_TICKS = ['0', '1–3', '4–10', '10+']

/** 上方圓角、底部貼齊基線的柱子 */
function columnPath(cx: number, w: number, top: number, bottom: number): string {
  const r = Math.min(4, w / 2, (bottom - top) / 2)
  const l = cx - w / 2
  const rt = cx + w / 2
  return `M${l},${bottom}V${top + r}Q${l},${top} ${l + r},${top}H${rt - r}Q${rt},${top} ${rt},${top + r}V${bottom}Z`
}

export function CoughChart({ logs, days, today }: Props) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const [picked, setPicked] = useState<string | null>(null)

  const points = useMemo(() => {
    const byDate = new Map(logs.filter((l) => l.cough != null).map((l) => [l.date, l]))
    return dateRange(addDays(today, -(days - 1)), today).map((date, i) => ({
      i,
      date,
      log: byDate.get(date) ?? null,
    }))
  }, [logs, days, today])

  const withData = points.filter((p) => p.log)
  if (withData.length === 0) {
    return <ChartCard title="咳嗽" chart={null} table={null} empty={`最近 ${days} 天還沒有填咳嗽紀錄。`} />
  }

  const active = points.find((p) => p.date === picked) ?? withData[withData.length - 1]

  const plotW = Math.max(width - M.left - M.right, 60)
  const plotH = H - M.top - M.bottom
  const band = plotW / days
  const barW = Math.max(3, Math.min(24, band - 2))
  const baseY = M.top + plotH
  const x = (i: number) => M.left + band * (i + 0.5)
  const y = (level: number) => baseY - (level / 3) * plotH

  const labelStep = days <= 7 ? 1 : days <= 14 ? 2 : 5
  const xLabels = points.filter((p) => (days - 1 - p.i) % labelStep === 0)

  const pickAt = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect()
    const i = Math.floor((clientX - rect.left - M.left) / band)
    setPicked(points[Math.min(days - 1, Math.max(0, i))].date)
  }

  const contextsOf = (log: DailyLog) => log.coughContexts.map((c) => COUGH_CONTEXT_LABEL[c]).join('、')

  const chart = (
    <div ref={ref}>
      <Readout label={formatDateLong(active.date)}>
        {active.log ? (
          <>
            <ReadoutValue name="咳嗽" value={COUGH_LABEL[active.log.cough!]} />
            {active.log.coughContexts.length > 0 && <span>常在{contextsOf(active.log)}</span>}
          </>
        ) : (
          <span>這天沒有填</span>
        )}
      </Readout>

      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`最近 ${days} 天的咳嗽次數圖，數字請看表格`}
        tabIndex={0}
        className="block touch-pan-y outline-none select-none focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-fg"
        onPointerDown={(e) => pickAt(e.clientX, e.currentTarget)}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse' || e.buttons > 0) pickAt(e.clientX, e.currentTarget)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          const next = active.i + (e.key === 'ArrowLeft' ? -1 : 1)
          setPicked(points[Math.min(days - 1, Math.max(0, next))].date)
        }}
      >
        {LEVEL_TICKS.map((label, level) => (
          <g key={label}>
            <line x1={M.left} x2={width - M.right} y1={y(level)} y2={y(level)} stroke="var(--line)" strokeWidth={1} />
            <text x={M.left - 8} y={y(level)} dy="0.35em" textAnchor="end" fontSize={12} fill="var(--fg-3)" className="tabular-nums">
              {label}
            </text>
          </g>
        ))}

        {/* 目前選到的那一天：柱子後面墊一塊淡底 */}
        <rect x={x(active.i) - band / 2} y={M.top} width={band} height={plotH} fill="var(--surface-2)" opacity={0.7} />

        {xLabels.map((p) => (
          <text key={p.date} x={x(p.i)} y={H - 7} textAnchor="middle" fontSize={12} fill="var(--fg-3)" className="tabular-nums">
            {formatDateShort(p.date)}
          </text>
        ))}

        {withData.map((p) => {
          const level = LEVEL_INDEX[p.log!.cough!]
          return level === 0 ? (
            <circle key={p.date} cx={x(p.i)} cy={baseY} r={3} fill="var(--fg-3)" />
          ) : (
            <path key={p.date} d={columnPath(x(p.i), barW, y(level), baseY)} fill="var(--fg)" />
          )
        })}
      </svg>
    </div>
  )

  const table = (
    <table className={TABLE_CLASS}>
      <thead>
        <tr>
          <th className={TH_CLASS}>日期</th>
          <th className={TH_CLASS}>咳嗽</th>
          <th className={TH_CLASS}>常發生在</th>
        </tr>
      </thead>
      <tbody>
        {[...withData].reverse().map((p) => (
          <tr key={p.date}>
            <td className={TD_CLASS}>{formatDateLong(p.date)}</td>
            <td className={`${TD_CLASS} font-bold`}>{COUGH_LABEL[p.log!.cough!]}</td>
            <td className={TD_CLASS}>{contextsOf(p.log!) || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return <ChartCard title="咳嗽" subtitle="每天大約幾次" chart={chart} table={table} />
}
