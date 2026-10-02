import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePref } from './device'

/** 目前時間，每分鐘更新一次，從背景切回來時也會立刻更新。 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = window.setInterval(tick, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return now
}

export type ThemePref = 'auto' | 'light' | 'dark'

const THEME_COLOR = { light: '#f1f2f0', dark: '#15171a' } as const
export const NIGHT_BG = '#090a0b'

function setThemeColorMeta(color: string) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}

/** 依「外觀」設定和手機的深淺色模式，決定整個 App 用深色還是淺色。 */
export function useThemeSync(): void {
  const [pref] = usePref('theme', 'auto')
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = pref === 'dark' || (pref !== 'light' && media.matches)
      const theme = dark ? 'dark' : 'light'
      document.documentElement.dataset.theme = theme
      if (!document.documentElement.dataset.night) setThemeColorMeta(THEME_COLOR[theme])
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [pref])
}

/** 量呼吸的畫面用：把手機狀態列的顏色暫時換成夜間底色，離開時換回來。 */
export function useNightThemeColor(): void {
  useEffect(() => {
    const root = document.documentElement
    root.dataset.night = '1'
    setThemeColorMeta(NIGHT_BG)
    return () => {
      delete root.dataset.night
      setThemeColorMeta(THEME_COLOR[root.dataset.theme === 'dark' ? 'dark' : 'light'])
    }
  }, [])
}

/** 量出某個區塊目前的寬度（圖表要照實際寬度畫）。回傳的第一個值掛在該區塊的 ref 上。 */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 320): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    if (!el) return
    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  return [setEl, width]
}

/** 開啟對話框時鎖住背景捲動。 */
export function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [locked])
}

/**
 * 畫面剛出現的前幾百毫秒不接受點擊。
 * 用來擋「連點兩下」：第一下換了畫面，第二下剛好落在新畫面的按鈕上
 * （例如連點「量呼吸」結果計時直接開始、連點「儲存」結果跳過警示畫面）。
 * 回傳一個函式，呼叫它會回答「現在可以接受點擊了嗎」。
 */
export function useArmed(delayMs = 600): () => boolean {
  const armedAt = useRef(0)
  if (armedAt.current === 0) armedAt.current = performance.now() + delayMs
  return useCallback(() => performance.now() >= armedAt.current, [])
}
