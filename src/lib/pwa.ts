// Service worker（離線快取）的註冊與「有新版本」的狀態。
// App 一啟動就註冊，不等任何畫面出現，這樣第一次開啟（還在看使用說明時）就會開始快取。

import { registerSW } from 'virtual:pwa-register'

const CHECK_EVERY_MS = 30 * 60 * 1000

let needRefresh = false
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()

export function initPwa(): void {
  applyUpdate = registerSW({
    // 新版已經下載好、在等使用者同意換版
    onNeedRefresh() {
      needRefresh = true
      listeners.forEach((fn) => fn())
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // App 開著的時候每 30 分鐘檢查一次有沒有新版
      window.setInterval(() => {
        registration.update().catch(() => {})
      }, CHECK_EVERY_MS)
    },
  })
}

export function subscribeUpdate(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function updateReady(): boolean {
  return needRefresh
}

/** 換成新版並重新整理畫面 */
export function applyUpdateNow(): void {
  void applyUpdate?.(true)
}
