// 只存在「這一支手機」上的偏好（localStorage），不會跟著備份或同步走。

import { useCallback, useEffect, useState } from 'react'

const KEYS = {
  deviceId: 'cb.deviceId',
  recorder: 'cb.recorder',
  onboarded: 'cb.onboarded',
  haptics: 'cb.haptics',
  countMode: 'cb.countMode',
  theme: 'cb.theme',
  installHintDismissed: 'cb.installHintDismissed',
  lastExportAt: 'cb.lastExportAt',
  trendRange: 'cb.trendRange',
  trendScope: 'cb.trendScope',
  reportRange: 'cb.reportRange',
} as const

export type PrefKey = keyof typeof KEYS

function read(key: PrefKey): string | null {
  try {
    return localStorage.getItem(KEYS[key])
  } catch {
    return null
  }
}

function write(key: PrefKey, value: string) {
  try {
    localStorage.setItem(KEYS[key], value)
  } catch {
    // 無痕模式等情況寫不進去就算了，偏好設定不是必要資料
  }
}

export function getPref(key: PrefKey, fallback = ''): string {
  return read(key) ?? fallback
}

export function setPref(key: PrefKey, value: string) {
  write(key, value)
  window.dispatchEvent(new CustomEvent('cb-pref', { detail: key }))
}

/** 像 useState 一樣使用某個本機偏好，同一頁裡其他地方改了也會跟著更新。 */
export function usePref(key: PrefKey, fallback = ''): [string, (v: string) => void] {
  const [value, setValue] = useState(() => getPref(key, fallback))
  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent).detail === key) setValue(getPref(key, fallback))
    }
    window.addEventListener('cb-pref', onChange)
    return () => window.removeEventListener('cb-pref', onChange)
  }, [key, fallback])
  const set = useCallback((v: string) => setPref(key, v), [key])
  return [value, set]
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 舊版瀏覽器（iOS 15.3 以前）沒有 randomUUID，自己組一個 v4 UUID
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

/** 這支手機的代號，第一次使用時產生，之後固定不變。 */
export function getDeviceId(): string {
  let id = read('deviceId')
  if (!id) {
    id = newId()
    write('deviceId', id)
  }
  return id
}

// ── 震動 ────────────────────────────────────────────

/** Android 支援震動；iPhone 的瀏覽器沒有震動功能。 */
export const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

export function hapticsEnabled(): boolean {
  return canVibrate && getPref('haptics', 'on') === 'on'
}

export function vibrate(pattern: number | number[]) {
  if (!hapticsEnabled()) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // 有些瀏覽器在沒有使用者操作時會拒絕，忽略即可
  }
}

// ── 螢幕恆亮 ────────────────────────────────────────

/** unsupported：這支手機不支援；failed：支援但這次要不到（例如省電模式） */
export type WakeState = 'unsupported' | 'idle' | 'active' | 'failed'

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

/** want 為 true 的期間讓螢幕保持恆亮；切到別的 App 再回來會自動重新要求。 */
export function useWakeLock(want: boolean): WakeState {
  const [state, setState] = useState<WakeState>(wakeLockSupported ? 'idle' : 'unsupported')

  useEffect(() => {
    if (!wakeLockSupported || !want) {
      if (wakeLockSupported) setState('idle')
      return
    }
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const request = async () => {
      try {
        const s = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void s.release()
          return
        }
        sentinel = s
        setState('active')
      } catch {
        if (!cancelled) setState('failed')
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }

    void request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release().catch(() => {})
    }
  }, [want])

  return state
}

// ── 安裝狀態 ────────────────────────────────────────

/** 是不是從主畫面圖示開啟的（已安裝成 App 的樣子） */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 會偽裝成 Mac，用觸控點數判斷
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

/** 請瀏覽器不要自動清掉這個網站的資料（瀏覽器可能不理會，但值得一試）。 */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    // 不支援就算了
  }
}
