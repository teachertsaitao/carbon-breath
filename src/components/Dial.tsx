// 呼吸錶盤：計數畫面中間那個大圓。
// 計時模式：外圈是倒數進度，每點一下會在當下的位置留一個刻度，
//           數完可以看到這段時間的呼吸節奏（刻度間隔平均＝呼吸規律）。
// 快速模式：外圈是 N 個點，每點一下亮一個，全部亮起就完成。

import type { CSSProperties, ReactNode } from 'react'

const C = 100 // 圓心
const R = 92 // 外圈半徑
const CIRC = 2 * Math.PI * R

function polar(radius: number, fraction: number): [number, number] {
  const angle = fraction * 2 * Math.PI - Math.PI / 2 // 從 12 點鐘方向開始，順時針
  return [C + radius * Math.cos(angle), C + radius * Math.sin(angle)]
}

interface BreathDialProps {
  mode: 'timed' | 'quick'
  running: boolean
  /** 計時模式的總秒數 */
  seconds: number
  /** 計時模式：每一下點擊發生在整段時間的哪個位置（0–1） */
  ticks: number[]
  /** 快速模式：總共要點幾次、已經點了幾次 */
  target: number
  filled: number
  /** 每點一下加 1，用來重新觸發按壓和漣漪動畫 */
  pulseKey: number
  children: ReactNode
}

export function BreathDial({ mode, running, seconds, ticks, target, filled, pulseKey, children }: BreathDialProps) {
  return (
    <div className="relative aspect-square w-[min(78vw,44dvh,340px)]">
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        {mode === 'timed' ? (
          <>
            <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line)" strokeWidth={2.5} />
            {running && (
              <circle
                cx={C}
                cy={C}
                r={R}
                fill="none"
                stroke="var(--fg-2)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={CIRC}
                transform={`rotate(-90 ${C} ${C})`}
                style={
                  {
                    '--circ': CIRC,
                    animation: `cb-sweep ${seconds}s linear forwards`,
                  } as CSSProperties
                }
              />
            )}
            {ticks.map((t, i) => {
              const [x1, y1] = polar(R - 9, t)
              const [x2, y2] = polar(R + 9, t)
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--fg)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
              )
            })}
          </>
        ) : (
          Array.from({ length: target }, (_, i) => {
            const [x, y] = polar(R, i / target)
            const on = i < filled
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={on ? 5 : 3.5}
                fill={on ? 'var(--fg)' : 'var(--line)'}
              />
            )
          })
        )}
      </svg>

      {/* 漣漪：每點一下往外擴散一圈再淡掉 */}
      {pulseKey > 0 && (
        <span
          key={`ripple-${pulseKey}`}
          aria-hidden
          className="anim-ripple absolute inset-[11%] rounded-full border-2 border-fg-2"
        />
      )}

      {/* 中間的圓盤：每點一下輕輕壓一下 */}
      <div
        key={`disc-${pulseKey}`}
        className={`absolute inset-[11%] flex flex-col items-center justify-center rounded-full bg-surface text-center ${
          pulseKey > 0 ? 'anim-pop' : ''
        }`}
      >
        {children}
      </div>
    </div>
  )
}

// ── 首頁的狀態燈 ────────────────────────────────────

export type LightTone = 'red' | 'yellow' | 'green' | 'idle'

const LIGHT_STROKE: Record<LightTone, string> = {
  red: 'var(--danger-fill)',
  yellow: 'var(--warn-fill)',
  green: 'var(--ok-fill)',
  idle: 'var(--line)',
}

/** 小一點的錶盤，外圈顏色＝目前的警示燈號，中間放數字或圖示。 */
export function StatusDial({ tone, children }: { tone: LightTone; children: ReactNode }) {
  return (
    <div className="relative size-[132px] shrink-0">
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden>
        <circle cx={C} cy={C} r={R} fill="var(--surface)" stroke={LIGHT_STROKE[tone]} strokeWidth={tone === 'idle' ? 4 : 10} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}
