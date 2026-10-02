// 量呼吸：計數 → 填狀態 → 看結果。整個流程固定用最暗的夜間配色、完全不發出聲音。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCard } from '../components/AlertCard'
import { BreathDial } from '../components/Dial'
import { RecordFields, type RecordFieldValues } from '../components/RecordFields'
import { Button, ChoiceGroup, Notice } from '../components/ui'
import { evaluateAgainstHistory, isImplausible, rateFromQuick, rateFromTimed } from '../lib/alerts'
import { formatTime } from '../lib/dates'
import { addBreath, useBreaths, useSettings } from '../lib/db'
import { PLAUSIBLE_MAX, PLAUSIBLE_MIN } from '../lib/defaults'
import { usePref, useWakeLock, vibrate, type WakeState } from '../lib/device'
import { useArmed, useNightThemeColor } from '../lib/hooks'
import { STATE_LABEL } from '../lib/labels'
import { navigate } from '../lib/router'
import type { BreathRecord, Settings } from '../lib/types'

type ModeKey = 'timed30' | 'timed60' | 'quick'

/** 兩下點擊間隔小於這個毫秒數視為誤觸（手指和手掌同時碰到），不計入。 */
const MIN_TAP_GAP_MS = 120

interface CountResult {
  mode: 'timed' | 'quick'
  rate: number
  breaths: number
  durationSec: number
  measuredAt: Date
}

export function MeasureScreen() {
  const settings = useSettings()
  const [phase, setPhase] = useState<'count' | 'result' | 'review' | 'done'>('count')
  const [result, setResult] = useState<CountResult | null>(null)
  const [saved, setSaved] = useState<BreathRecord | null>(null)
  const [round, setRound] = useState(0)
  useNightThemeColor()

  // 只有在看著狗數呼吸的時候需要螢幕恆亮
  const wake = useWakeLock(phase === 'count')

  const exit = useCallback(() => navigate('/', { replace: true }), [])
  const restart = useCallback(() => {
    setResult(null)
    setSaved(null)
    setPhase('count')
    setRound((n) => n + 1)
  }, [])

  return (
    <div
      className="night fixed inset-0 z-40 flex flex-col bg-bg text-fg"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col">
        {!settings ? null : phase === 'count' ? (
          <Counter
            key={round}
            quickTarget={settings.counter.quickTarget}
            wake={wake}
            onExit={exit}
            onDone={(r) => {
              setResult(r)
              setPhase('result')
            }}
          />
        ) : phase === 'result' && result ? (
          <Result result={result} onNext={() => setPhase('review')} onRedo={restart} onExit={exit} />
        ) : phase === 'review' && result ? (
          <Review
            result={result}
            onRedo={restart}
            onExit={exit}
            onSaved={(record) => {
              setSaved(record)
              setPhase('done')
            }}
          />
        ) : saved ? (
          <Done record={saved} settings={settings} onAgain={restart} onExit={exit} />
        ) : null}
      </div>
    </div>
  )
}

// ── 計數 ────────────────────────────────────────────

interface CounterProps {
  quickTarget: number
  wake: WakeState
  onDone: (result: CountResult) => void
  onExit: () => void
}

function Counter({ quickTarget, wake, onDone, onExit }: CounterProps) {
  const [storedMode, setStoredMode] = usePref('countMode', 'timed30')
  const modeKey: ModeKey = storedMode === 'timed60' || storedMode === 'quick' ? storedMode : 'timed30'
  const isTimed = modeKey !== 'quick'
  const seconds = modeKey === 'timed60' ? 60 : 30

  const [running, setRunning] = useState(false)
  const [count, setCount] = useState(0)
  const [ticks, setTicks] = useState<number[]>([])
  const [remaining, setRemaining] = useState(seconds)
  const [pulseKey, setPulseKey] = useState(0)
  const [interrupted, setInterrupted] = useState(false)
  // 這個畫面剛出現時先不接受點擊：連點兩下「量呼吸」時，第二下不會讓計時直接開始
  const armed = useArmed(600)

  // 計時用的數值放在 ref，點擊當下立刻讀寫，不等畫面重繪
  const runningRef = useRef(false)
  const finishedRef = useRef(false)
  const startRef = useRef(0)
  const lastTapRef = useRef(-Infinity)
  const tapsRef = useRef<number[]>([])

  const reset = useCallback(() => {
    runningRef.current = false
    finishedRef.current = false
    tapsRef.current = []
    lastTapRef.current = -Infinity
    setRunning(false)
    setCount(0)
    setTicks([])
    setPulseKey(0)
  }, [])

  const finishTimed = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    runningRef.current = false
    const breaths = tapsRef.current.length
    vibrate([60, 70, 60])
    onDone({
      mode: 'timed',
      rate: rateFromTimed(breaths, seconds),
      breaths,
      durationSec: seconds,
      measuredAt: new Date(),
    })
  }, [onDone, seconds])

  const finishQuick = useCallback(
    (elapsedMs: number) => {
      if (finishedRef.current) return
      finishedRef.current = true
      runningRef.current = false
      vibrate([60, 70, 60])
      onDone({
        mode: 'quick',
        rate: rateFromQuick(quickTarget, elapsedMs),
        breaths: quickTarget,
        durationSec: Math.round(elapsedMs / 100) / 10,
        measuredAt: new Date(),
      })
    },
    [onDone, quickTarget],
  )

  // 計時模式：更新剩餘秒數，時間到就結束
  useEffect(() => {
    if (!running || !isTimed) return
    const id = window.setInterval(() => {
      const elapsed = performance.now() - startRef.current
      if (elapsed >= seconds * 1000) finishTimed()
      else setRemaining(Math.ceil(seconds - elapsed / 1000))
    }, 100)
    return () => window.clearInterval(id)
  }, [running, isTimed, seconds, finishTimed])

  // 數到一半畫面被切走（來電、切到別的 App）：計時已經不準，直接作廢重來
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && runningRef.current) {
        reset()
        setInterrupted(true)
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [reset])

  const handleTap = useCallback(() => {
    const now = performance.now()

    if (!runningRef.current) {
      if (finishedRef.current || !armed()) return
      // 第一下：開始計時，這一下不算呼吸次數
      runningRef.current = true
      startRef.current = now
      lastTapRef.current = now
      tapsRef.current = []
      setInterrupted(false)
      setRemaining(seconds)
      setCount(0)
      setTicks([])
      setRunning(true)
      setPulseKey((k) => k + 1)
      vibrate(15)
      return
    }

    if (now - lastTapRef.current < MIN_TAP_GAP_MS) return
    lastTapRef.current = now
    const offset = now - startRef.current

    if (isTimed) {
      if (offset >= seconds * 1000) {
        finishTimed()
        return
      }
      tapsRef.current.push(offset)
      setTicks(tapsRef.current.map((t) => t / (seconds * 1000)))
    } else {
      tapsRef.current.push(offset)
    }

    const n = tapsRef.current.length
    setCount(n)
    setPulseKey((k) => k + 1)
    vibrate(15)
    if (!isTimed && n >= quickTarget) finishQuick(offset)
  }, [armed, finishQuick, finishTimed, isTimed, quickTarget, seconds])

  const hint = running
    ? '胸口一起一伏算一次。整個畫面都可以點，眼睛看著牠就好。'
    : isTimed
      ? `點一下開始倒數 ${seconds} 秒，之後胸口每起伏一次就點一下。`
      : `看到胸口起伏時點第一下開始計時，之後每起伏一次點一下，點滿 ${quickTarget} 次會自動算出結果。`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between px-2">
        <button type="button" onClick={onExit} className="h-12 px-3 text-base font-medium text-fg-2">
          取消
        </button>
        {running && (
          <button type="button" onClick={reset} className="h-12 px-3 text-base font-medium text-fg-2">
            重來
          </button>
        )}
      </div>

      {/* 這一整塊都是點擊區。開始之後，上面的選項會隱藏但位置保留（畫面不會跳動），
          點到那裡一樣算一次。 */}
      <div
        data-testid="tap-surface"
        className="tap-surface flex min-h-0 flex-1 flex-col"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          handleTap()
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className={`shrink-0 px-5 ${running ? 'invisible' : ''}`}
          onPointerDown={(e) => {
            if (!running) e.stopPropagation()
          }}
        >
          <ChoiceGroup
            label="計數方式"
            options={[
              { value: 'timed30', label: '30 秒' },
              { value: 'timed60', label: '60 秒' },
              { value: 'quick', label: `數 ${quickTarget} 次` },
            ]}
            value={modeKey}
            onChange={(v) => v && armed() && setStoredMode(v)}
          />
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label={running ? '每呼吸一次點一下' : '點一下開始'}
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-6 outline-none"
          onKeyDown={(e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
              e.preventDefault()
              handleTap()
            }
          }}
        >
          {interrupted && !running && (
            <p className="text-center text-[15px] text-warn" role="status">
              剛才畫面被切走，那次測量已作廢，請重新開始。
            </p>
          )}
          <BreathDial
            mode={isTimed ? 'timed' : 'quick'}
            running={running}
            seconds={seconds}
            ticks={ticks}
            target={quickTarget}
            filled={count}
            pulseKey={pulseKey}
          >
            {running ? (
              <>
                <span className="text-[92px] leading-none font-bold" data-testid="count">
                  {count}
                </span>
                <span className="mt-3 text-base text-fg-2">
                  {isTimed ? `還剩 ${remaining} 秒` : `還要 ${Math.max(quickTarget - count, 0)} 次`}
                </span>
              </>
            ) : (
              <span className="text-[26px] leading-snug font-bold">
                點一下
                <br />
                開始
              </span>
            )}
          </BreathDial>
          <p className="max-w-[19em] text-center text-[15px] leading-relaxed text-fg-2">{hint}</p>
        </div>

        {(wake === 'unsupported' || wake === 'failed') && (
          <p className="shrink-0 px-6 pb-3 text-center text-sm leading-relaxed text-fg-2" role="status">
            這支手機無法讓螢幕保持恆亮。數的時候持續點擊，螢幕就不會自己變暗。
          </p>
        )}
      </div>
    </div>
  )
}

// ── 數完了：先只顯示數字 ────────────────────────────
//
// 數呼吸的時候眼睛是看著狗、不是看著螢幕，時間到了之後手指常常還會再多點幾下。
// 所以數完不直接進填寫畫面（不然多點的那幾下會誤觸到「狀態」或「呼吸費力徵象」），
// 而是先停在這一頁：畫面中間點了沒有任何作用，要按最下面的按鈕才會往下走。

function detailText(result: CountResult): string {
  return result.mode === 'timed'
    ? `${result.durationSec} 秒內數到 ${result.breaths} 次`
    : `${result.breaths} 次呼吸花了 ${result.durationSec} 秒`
}

function TopBar({ onExit, onRedo }: { onExit: () => void; onRedo?: () => void }) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between px-2">
      <button type="button" onClick={onExit} className="h-12 px-3 text-base font-medium text-fg-2">
        取消
      </button>
      {onRedo && (
        <button type="button" onClick={onRedo} className="h-12 px-3 text-base font-medium text-fg-2">
          重新量
        </button>
      )}
    </div>
  )
}

interface ResultProps {
  result: CountResult
  onNext: () => void
  onRedo: () => void
  onExit: () => void
}

function Result({ result, onNext, onRedo, onExit }: ResultProps) {
  // 剛出現的前 0.8 秒不接受點擊，擋掉「最後一下」連帶產生的點擊
  const armed = useArmed(800)
  const guarded = (fn: () => void) => () => {
    if (armed()) fn()
  }
  const odd = isImplausible(result.rate)

  return (
    <div className="anim-finish-glow flex min-h-0 flex-1 flex-col">
      <TopBar onExit={guarded(onExit)} onRedo={guarded(onRedo)} />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center select-none">
        <p className="text-lg font-medium text-fg-2">數完了，每分鐘</p>
        <p className="mt-3 flex items-baseline gap-2">
          <span className="text-[112px] leading-none font-bold" data-testid="result-rate">
            {result.rate}
          </span>
          <span className="text-2xl font-medium text-fg-2">次</span>
        </p>
        <p className="mt-4 text-base text-fg-2">{detailText(result)}</p>

        {odd && (
          <div className="mt-6 text-left">
            <Notice tone="warn">
              <p className="font-bold">這個數字看起來不太對</p>
              <p className="mt-1">
                {result.rate < PLAUSIBLE_MIN ? `低於 ${PLAUSIBLE_MIN}` : `高於 ${PLAUSIBLE_MAX}`}
                ，可能是漏點或多點了。建議按右上角的「重新量」。
              </p>
            </Notice>
          </div>
        )}
      </div>

      <div className="shrink-0 px-5 pt-3 pb-4">
        <Button className="w-full" onClick={guarded(onNext)}>
          {odd ? '數字沒錯，繼續填寫' : '下一步：填寫狀態'}
        </Button>
      </div>
    </div>
  )
}

// ── 填寫狀態 ────────────────────────────────────────

interface ReviewProps {
  result: CountResult
  onSaved: (record: BreathRecord) => void
  onRedo: () => void
  onExit: () => void
}

function Review({ result, onSaved, onRedo, onExit }: ReviewProps) {
  const [fields, setFields] = useState<RecordFieldValues>({ state: null, signs: [], note: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!fields.state || saving) return
    setSaving(true)
    setError('')
    try {
      const record = await addBreath({
        measuredAt: result.measuredAt,
        rate: result.rate,
        mode: result.mode,
        breaths: result.breaths,
        durationSec: result.durationSec,
        state: fields.state,
        signs: fields.signs,
        note: fields.note,
      })
      onSaved(record)
    } catch {
      setError('儲存失敗，請再按一次「儲存」。')
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar onExit={onExit} onRedo={onRedo} />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <p className="mb-5 flex items-baseline gap-2">
          <span className="text-[56px] leading-none font-bold">{result.rate}</span>
          <span className="text-lg font-medium text-fg-2">次／分</span>
          <span className="ml-2 text-[15px] text-fg-2">{detailText(result)}</span>
        </p>

        <RecordFields value={fields} onChange={setFields} />
        {error && (
          <p className="mt-2 text-[15px] text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-5 pt-3 pb-4">
        <Button className="w-full" disabled={!fields.state || saving} onClick={save}>
          {fields.state ? '儲存' : '先選牠剛才的狀態'}
        </Button>
      </div>
    </div>
  )
}

// ── 結果 ────────────────────────────────────────────

/** 某個時間的幾分鐘之後，顯示成 02:25 */
function clockAfter(iso: string, minutes: number): string {
  return formatTime(new Date(Date.parse(iso) + minutes * 60_000).toISOString())
}

interface DoneProps {
  record: BreathRecord
  settings: Settings
  onAgain: () => void
  onExit: () => void
}

function Done({ record, settings, onAgain, onExit }: DoneProps) {
  // 剛出現時先不接受點擊：連點兩下「儲存」時，第二下不會直接按到「完成」而跳過警示結果
  const armed = useArmed(800)
  // 跟之前的紀錄比對，判斷這一筆的警示燈號
  const breaths = useBreaths()
  const alert = useMemo(
    () => (breaths ? evaluateAgainstHistory(record, breaths, settings.thresholds) : null),
    [breaths, record, settings.thresholds],
  )
  if (!alert) return null

  const fastWhileNotAsleep =
    record.state !== 'deep' && alert.level === 'none' && record.rate >= settings.thresholds.yellowRate

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-8 pb-6">
        <p className="text-base text-fg-2">
          已儲存 {formatTime(record.measuredAt)} 的紀錄（{STATE_LABEL[record.state]}）
        </p>
        <p className="mt-1 mb-5 flex items-baseline gap-2">
          <span className="text-[76px] leading-none font-bold">{record.rate}</span>
          <span className="text-xl font-medium text-fg-2">次／分</span>
        </p>

        <AlertCard record={record} alert={alert} contacts={settings.contacts} />

        {alert.level === 'yellow' && (
          <p className="mt-3 px-1 text-base leading-relaxed">
            建議在 <strong>{clockAfter(record.measuredAt, 10)}</strong> 到{' '}
            <strong>{clockAfter(record.measuredAt, 15)}</strong> 之間再量一次。
          </p>
        )}

        {fastWhileNotAsleep && (
          <div className="mt-3">
            <Notice>
              清醒或淺眠時呼吸本來就比較快。等牠熟睡後再量一次會比較準；如果休息時一直很喘，請聯絡醫師。
            </Notice>
          </div>
        )}
      </div>

      <div className="flex shrink-0 gap-3 border-t border-line px-5 pt-3 pb-4">
        <Button variant="secondary" onClick={() => armed() && onAgain()}>
          再量一次
        </Button>
        <Button className="flex-1" onClick={() => armed() && onExit()}>
          完成
        </Button>
      </div>
    </div>
  )
}
