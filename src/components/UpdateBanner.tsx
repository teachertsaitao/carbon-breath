// 有新版本時的提示橫幅。
// 新版下載好之後不會自己換版（怕數呼吸數到一半畫面被重新整理），
// 要按「立即更新」才會套用；量呼吸的時候橫幅也不會跳出來。

import { RefreshCw } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { applyUpdateNow, subscribeUpdate, updateReady } from '../lib/pwa'

export function UpdateBanner({ hidden }: { hidden: boolean }) {
  const ready = useSyncExternalStore(subscribeUpdate, updateReady)
  const [later, setLater] = useState(false)

  if (!ready || later || hidden) return null

  return (
    <div
      role="status"
      className="no-print fixed inset-x-0 top-0 z-[70] bg-primary text-on-primary shadow-lg"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="mx-auto flex max-w-[480px] items-center gap-2 py-2 pr-2 pl-5">
        <RefreshCw size={18} strokeWidth={2.5} aria-hidden />
        <span className="flex-1 text-[15px] font-bold">有新版本可用</span>
        <button
          type="button"
          onClick={applyUpdateNow}
          className="h-10 rounded-xl bg-on-primary px-4 text-sm font-bold text-primary"
        >
          立即更新
        </button>
        <button type="button" onClick={() => setLater(true)} className="h-10 px-3 text-sm font-medium opacity-75">
          稍後
        </button>
      </div>
    </div>
  )
}
