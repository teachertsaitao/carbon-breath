// 很小的頁面切換工具：用網址的 # 後面那段決定現在在哪一頁（例如 #/daily）。
// 用 # 的好處是部署到 Vercel 不需要任何額外設定，手機的「返回」手勢也能用。

import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'measure' }
  | { name: 'manual' }
  | { name: 'daily'; date: string | null }
  | { name: 'trends' }
  | { name: 'report' }
  | { name: 'settings' }
  | { name: 'guide' }

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  switch (parts[0]) {
    case 'measure':
      return { name: 'measure' }
    case 'manual':
      return { name: 'manual' }
    case 'daily':
      return { name: 'daily', date: /^\d{4}-\d{2}-\d{2}$/.test(parts[1] ?? '') ? parts[1] : null }
    case 'trends':
      return { name: 'trends' }
    case 'report':
      return { name: 'report' }
    case 'settings':
      return { name: 'settings' }
    case 'guide':
      return { name: 'guide' }
    default:
      return { name: 'home' }
  }
}

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

const getHash = () => window.location.hash

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash)
  return parseRoute(hash)
}

/** 換頁。replace 為 true 時不留返回紀錄（例如量完之後回首頁，不希望按返回又回到計數畫面）。 */
export function navigate(path: string, opts: { replace?: boolean } = {}) {
  const target = `#${path}`
  if (opts.replace) {
    window.location.replace(target)
  } else {
    window.location.hash = path
  }
  window.scrollTo(0, 0)
}
