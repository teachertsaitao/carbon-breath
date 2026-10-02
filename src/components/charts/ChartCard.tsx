// 圖表外框：標題、圖／表切換。每張圖都有對應的表格（同樣的數字用表格看），
// 不方便看圖的時候可以切過去。

import { useState, type ReactNode } from 'react'

interface ChartCardProps {
  title: string
  subtitle?: string
  /** 圖表本體 */
  chart: ReactNode
  /** 同一份資料的表格版 */
  table: ReactNode
  /** 完全沒有資料時顯示的文字；有值就不畫圖也不顯示「看表格」 */
  empty?: string | null
  /** 標題下面的控制項（例如「只看熟睡／全部」），沒有資料時也會顯示 */
  controls?: ReactNode
}

export function ChartCard({ title, subtitle, chart, table, empty, controls }: ChartCardProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <figure className="rounded-3xl bg-surface p-4">
      <figcaption className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] leading-snug font-bold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-fg-2">{subtitle}</p>}
        </div>
        {!empty && (
          <button
            type="button"
            onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
            className="no-print -mt-1 -mr-1 h-10 shrink-0 rounded-xl px-3 text-sm font-bold text-fg-2 underline underline-offset-4"
          >
            {view === 'chart' ? '看表格' : '看圖表'}
          </button>
        )}
      </figcaption>
      {controls}
      <div className="mt-3">
        {empty ? (
          <p className="py-8 text-center text-[15px] text-fg-2">{empty}</p>
        ) : view === 'chart' ? (
          chart
        ) : (
          table
        )}
      </div>
    </figure>
  )
}

/** 圖表上方的讀數列：顯示目前選到那一天的數字（手指不會擋到）。 */
export function Readout({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm text-fg-2" aria-live="polite">
      <span className="font-bold text-fg">{label}</span>
      {children}
    </div>
  )
}

export function ReadoutValue({ name, value }: { name: string; value: ReactNode }) {
  return (
    <span>
      {name} <strong className="text-[17px] font-bold text-fg">{value}</strong>
    </span>
  )
}

export const TABLE_CLASS = 'w-full border-collapse text-[15px] tabular-nums'
export const TH_CLASS = 'border-b border-line py-2 text-left text-sm font-medium text-fg-2'
export const TD_CLASS = 'border-b border-line py-2.5'
