// 呼吸次數趨勢圖，可以切換「只看熟睡」和「全部」。
//
// 只看熟睡（預設）：每天一個點（當天熟睡紀錄的中位數）＋一條細直線（當天最低到最高），
//                   加上黃色、紅色門檻線和基準值線。
// 全部：再把淺眠、清醒休息時量的每一筆用空心的點畫上去。
//       線、門檻和基準值仍然只算熟睡的紀錄，兩種數字不會混在一起算。

import { useMemo, useState } from 'react'
import { estimateTextWidth, placeLineLabels } from '../../lib/chartLabels'
import { addDays, dateRange, formatDateLong, formatDateShort } from '../../lib/dates'
import { usePref } from '../../lib/device'
import { useMeasuredWidth } from '../../lib/hooks'
import { STATE_LABEL } from '../../lib/labels'
import { dailyDeepSummaries, dailyOtherRates, formatRate } from '../../lib/stats'
import type { BreathRecord, Thresholds } from '../../lib/types'
import { ChoiceGroup } from '../ui'
import { ChartCard, Readout, ReadoutValue, TABLE_CLASS, TD_CLASS, TH_CLASS } from './ChartCard'

interface Props {
  breaths: BreathRecord[]
  days: number
  today: string
  thresholds: Thresholds
  baseline: number | null
}

type Scope = 'deep' | 'all'

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'deep', label: '只看熟睡' },
  { value: 'all', label: '全部' },
]

const H = 232
const M = { top: 16, right: 12, bottom: 26, left: 30 }
const LABEL_HALO = { paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 4, strokeLinejoin: 'round' } as const

function markerFill(median: number, t: Thresholds): string {
  if (median >= t.redRate) return 'var(--danger-fill)'
  if (median >= t.yellowRate) return 'var(--warn-fill)'
  return 'var(--fg)'
}

/** 不是熟睡時量的紀錄：淺眠是空心圓，清醒休息是空心菱形 */
function OtherMarker({ kind, cx, cy }: { kind: 'light' | 'awake'; cx: number; cy: number }) {
  const style = { fill: 'var(--surface)', stroke: 'var(--fg-2)', strokeWidth: 2 }
  if (kind === 'light') return <circle data-kind="light" cx={cx} cy={cy} r={4} {...style} />
  const r = 5.5
  return (
    <path
      data-kind="awake"
      d={`M${cx},${cy - r}L${cx + r},${cy}L${cx},${cy + r}L${cx - r},${cy}Z`}
      strokeLinejoin="round"
      {...style}
    />
  )
}

export function SrrChart({ breaths, days, today, thresholds: t, baseline }: Props) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const [picked, setPicked] = useState<string | null>(null)
  const [scopePref, setScopePref] = usePref('trendScope', 'deep')
  const scope: Scope = scopePref === 'all' ? 'all' : 'deep'
  const showOther = scope === 'all'

  const points = useMemo(() => {
    const summaries = dailyDeepSummaries(breaths)
    const others = dailyOtherRates(breaths)
    return dateRange(addDays(today, -(days - 1)), today).map((date, i) => ({
      i,
      date,
      /** 當天熟睡紀錄的統計 */
      s: summaries.get(date) ?? null,
      /** 當天淺眠、清醒休息時量的紀錄 */
      o: others.get(date) ?? null,
    }))
  }, [breaths, days, today])

  const withDeep = points.filter((p) => p.s)
  const withOther = points.filter((p) => p.o)
  const otherCount = withOther.reduce((n, p) => n + p.o!.light.length + p.o!.awake.length, 0)
  /** 目前的顯示方式下，有東西可以看的日子 */
  const visible = showOther ? points.filter((p) => p.s || p.o) : withDeep

  const controls = (
    <div className="mt-3">
      <ChoiceGroup
        label="要看哪些紀錄"
        size="sm"
        options={SCOPE_OPTIONS}
        value={scope}
        onChange={(v) => v && setScopePref(v)}
      />
      <p className="mt-2 text-sm leading-relaxed text-fg-2">
        {showOther
          ? '空心的點是淺眠或清醒休息時量的。線、門檻和基準值只算熟睡的紀錄。'
          : '每天一個點，是當天熟睡紀錄的中位數。'}
      </p>
    </div>
  )

  if (visible.length === 0) {
    const empty = showOther
      ? `最近 ${days} 天還沒有呼吸紀錄。`
      : otherCount > 0
        ? `最近 ${days} 天還沒有熟睡時的紀錄。另外有 ${otherCount} 筆淺眠或清醒休息時量的，選「全部」可以看到。`
        : `最近 ${days} 天還沒有熟睡時的紀錄。`
    return <ChartCard title="呼吸次數" controls={controls} chart={null} table={null} empty={empty} />
  }

  // 預設顯示最近一個有資料的日子；點圖表可以換一天
  const active = points.find((p) => p.date === picked) ?? visible[visible.length - 1]

  const plotW = Math.max(width - M.left - M.right, 60)
  const plotH = H - M.top - M.bottom
  const band = plotW / days

  // Y 軸範圍要容得下所有畫出來的點
  const shown: number[] = []
  for (const p of withDeep) shown.push(p.s!.min, p.s!.max)
  if (showOther) for (const p of withOther) shown.push(...p.o!.light, ...p.o!.awake)
  const dataMax = Math.max(...shown)
  const dataMin = Math.min(...shown)
  const yMax = Math.ceil((Math.max(dataMax, t.redRate) + 3) / 5) * 5
  const yMin = Math.max(0, Math.min(10, Math.floor((dataMin - 3) / 5) * 5))
  const x = (i: number) => M.left + band * (i + 0.5)
  const y = (v: number) => M.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH

  const tickStep = yMax - yMin > 60 ? 20 : 10
  const yTicks: number[] = []
  for (let v = Math.ceil(yMin / tickStep) * tickStep; v <= yMax; v += tickStep) yTicks.push(v)

  const labelStep = days <= 7 ? 1 : days <= 14 ? 2 : 5
  const xLabels = points.filter((p) => (days - 1 - p.i) % labelStep === 0)

  // 只把「連續的日子」連成線；中間有幾天沒量就斷開，不假裝那幾天有數字
  const segments: string[] = []
  let run: string[] = []
  for (const p of points) {
    if (p.s) {
      run.push(`${x(p.i).toFixed(1)},${y(p.s.median).toFixed(1)}`)
    } else {
      if (run.length > 1) segments.push(`M${run.join('L')}`)
      run = []
    }
  }
  if (run.length > 1) segments.push(`M${run.join('L')}`)

  // 同一天也有熟睡紀錄時，空心的點往右移一點，才不會整個蓋在中位數的點上
  const otherDx = Math.min(band * 0.24, 9)

  const pickAt = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect()
    const i = Math.floor((clientX - rect.left - M.left) / band)
    setPicked(points[Math.min(days - 1, Math.max(0, i))].date)
  }

  const yellowY = y(t.yellowRate)
  const redY = y(t.redRate)
  const baselineShown = baseline != null && baseline >= yMin && baseline <= yMax

  // 三條橫線的名稱。基準值升到門檻附近時兩條線會靠得很近，名稱的位置要錯開才不會互相蓋住
  const LABEL_SIZE = 12
  const lineLabels = [
    { text: `紅色門檻 ${t.redRate}`, y: redY, prefer: 'above' as const },
    { text: `黃色門檻 ${t.yellowRate}`, y: yellowY, prefer: 'above' as const },
    ...(baselineShown ? [{ text: `基準值 ${formatRate(baseline)}`, y: y(baseline), prefer: 'below' as const }] : []),
  ]
  const labelPlaces = placeLineLabels(
    lineLabels.map((l) => ({ y: l.y, width: estimateTextWidth(l.text, LABEL_SIZE), prefer: l.prefer })),
    { fontSize: LABEL_SIZE, top: 0, bottom: M.top + plotH },
  )

  const chart = (
    <div ref={ref}>
      <Readout label={formatDateLong(active.date)}>
        {active.s ? (
          <>
            <ReadoutValue name={showOther ? '熟睡中位數' : '中位數'} value={formatRate(active.s.median)} />
            {active.s.count > 1 && (
              <span>
                最低 {active.s.min}，最高 {active.s.max}
              </span>
            )}
            <span>共 {active.s.count} 筆</span>
          </>
        ) : (
          <span>沒有熟睡時的紀錄</span>
        )}
        {showOther && active.o && active.o.light.length > 0 && (
          <span>
            {STATE_LABEL.light} {active.o.light.join('、')}
          </span>
        )}
        {showOther && active.o && active.o.awake.length > 0 && (
          <span>
            {STATE_LABEL.awake} {active.o.awake.join('、')}
          </span>
        )}
      </Readout>

      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={`最近 ${days} 天的呼吸次數趨勢圖（${showOther ? '全部紀錄' : '只看熟睡'}），數字請看表格`}
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
        {/* 格線與 Y 軸刻度 */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={M.left - 8} y={y(v)} dy="0.35em" textAnchor="end" fontSize={12} fill="var(--fg-3)" className="tabular-nums">
              {v}
            </text>
          </g>
        ))}

        {/* 目前選到的那一天 */}
        <line
          x1={x(active.i)}
          x2={x(active.i)}
          y1={M.top}
          y2={M.top + plotH}
          stroke="var(--fg-3)"
          strokeWidth={1}
        />

        {/* 門檻線（虛線）與基準值（實線） */}
        <line x1={M.left} x2={width - M.right} y1={yellowY} y2={yellowY} stroke="var(--warn-fill)" strokeWidth={1.5} strokeDasharray="5 4" />
        <line x1={M.left} x2={width - M.right} y1={redY} y2={redY} stroke="var(--danger-fill)" strokeWidth={1.5} strokeDasharray="5 4" />
        {baselineShown && (
          <line x1={M.left} x2={width - M.right} y1={y(baseline)} y2={y(baseline)} stroke="var(--fg-3)" strokeWidth={1.5} />
        )}

        {/* X 軸日期 */}
        {xLabels.map((p) => (
          <text key={p.date} x={x(p.i)} y={H - 7} textAnchor="middle" fontSize={12} fill="var(--fg-3)" className="tabular-nums">
            {formatDateShort(p.date)}
          </text>
        ))}

        {/* 熟睡：當天最低到最高 */}
        {withDeep.map(
          (p) =>
            p.s!.max > p.s!.min && (
              <line
                key={p.date}
                x1={x(p.i)}
                x2={x(p.i)}
                y1={y(p.s!.max)}
                y2={y(p.s!.min)}
                stroke="var(--fg-3)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            ),
        )}

        {/* 淺眠、清醒休息時量的每一筆（選「全部」才畫） */}
        {showOther &&
          withOther.map((p) => {
            const cx = x(p.i) + (p.s ? otherDx : 0)
            return (
              <g key={p.date}>
                {p.o!.light.map((rate, k) => (
                  <OtherMarker key={`l${k}`} kind="light" cx={cx} cy={y(rate)} />
                ))}
                {p.o!.awake.map((rate, k) => (
                  <OtherMarker key={`a${k}`} kind="awake" cx={cx} cy={y(rate)} />
                ))}
              </g>
            )
          })}

        {/* 熟睡：每日中位數 */}
        {segments.map((d) => (
          <path key={d} d={d} fill="none" stroke="var(--fg)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {withDeep.map((p) => (
          <circle
            key={p.date}
            data-kind="deep"
            cx={x(p.i)}
            cy={y(p.s!.median)}
            r={p.date === active.date ? 6 : 4.5}
            fill={markerFill(p.s!.median, t)}
            stroke="var(--surface)"
            strokeWidth={2}
          />
        ))}

        {/* 線的名稱直接標在線旁邊 */}
        {lineLabels.map((l, i) => (
          <text
            key={l.text}
            data-line-label={labelPlaces[i].side}
            x={M.left + 4 + labelPlaces[i].dx}
            y={labelPlaces[i].baseline}
            fontSize={LABEL_SIZE}
            fill="var(--fg-2)"
            {...LABEL_HALO}
          >
            {l.text}
          </text>
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-2">
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="10" aria-hidden>
            <line x1="0" y1="5" x2="22" y2="5" stroke="var(--fg)" strokeWidth="2" />
            <circle cx="11" cy="5" r="4" fill="var(--fg)" stroke="var(--surface)" strokeWidth="1.5" />
          </svg>
          {showOther ? '熟睡（每日中位數）' : '每日中位數'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="6" height="14" aria-hidden>
            <line x1="3" y1="1" x2="3" y2="13" stroke="var(--fg-3)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {showOther ? '熟睡當天最低到最高' : '當天最低到最高'}
        </span>
        {showOther && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <svg width="14" height="14" aria-hidden>
                <OtherMarker kind="light" cx={7} cy={7} />
              </svg>
              {STATE_LABEL.light}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="14" height="14" aria-hidden>
                <OtherMarker kind="awake" cx={7} cy={7} />
              </svg>
              {STATE_LABEL.awake}
            </span>
          </>
        )}
      </div>
    </div>
  )

  const table = showOther ? (
    <table className={TABLE_CLASS}>
      <thead>
        <tr>
          <th className={TH_CLASS}>日期</th>
          <th className={`${TH_CLASS} text-right`}>熟睡中位數</th>
          <th className={`${TH_CLASS} text-right`}>{STATE_LABEL.light}</th>
          <th className={`${TH_CLASS} text-right`}>{STATE_LABEL.awake}</th>
        </tr>
      </thead>
      <tbody>
        {[...visible].reverse().map((p) => (
          <tr key={p.date}>
            <td className={TD_CLASS}>{formatDateLong(p.date)}</td>
            <td className={`${TD_CLASS} text-right font-bold`}>{p.s ? formatRate(p.s.median) : '—'}</td>
            <td className={`${TD_CLASS} text-right`}>{p.o && p.o.light.length > 0 ? p.o.light.join('、') : '—'}</td>
            <td className={`${TD_CLASS} text-right`}>{p.o && p.o.awake.length > 0 ? p.o.awake.join('、') : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <table className={TABLE_CLASS}>
      <thead>
        <tr>
          <th className={TH_CLASS}>日期</th>
          <th className={`${TH_CLASS} text-right`}>中位數</th>
          <th className={`${TH_CLASS} text-right`}>最低</th>
          <th className={`${TH_CLASS} text-right`}>最高</th>
          <th className={`${TH_CLASS} text-right`}>筆數</th>
        </tr>
      </thead>
      <tbody>
        {[...withDeep].reverse().map((p) => (
          <tr key={p.date}>
            <td className={TD_CLASS}>{formatDateLong(p.date)}</td>
            <td className={`${TD_CLASS} text-right font-bold`}>{formatRate(p.s!.median)}</td>
            <td className={`${TD_CLASS} text-right`}>{p.s!.min}</td>
            <td className={`${TD_CLASS} text-right`}>{p.s!.max}</td>
            <td className={`${TD_CLASS} text-right`}>{p.s!.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <ChartCard
      title="呼吸次數"
      subtitle="每分鐘次數，點圖表可以看某一天"
      controls={controls}
      chart={chart}
      table={table}
    />
  )
}
