// 還沒加到主畫面時，在首頁提醒一次。
// iPhone 特別重要：Safari 分頁和主畫面 App 的資料是分開存的，
// 先在 Safari 記了幾天再加到主畫面，那幾天的紀錄不會跟過去。

import { X } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { isIOS, isStandalone, usePref } from '../lib/device'
import { canPromptInstall, promptInstall, subscribeInstall } from '../lib/install'
import { Button } from './ui'

export function InstallHint() {
  const [dismissed, setDismissed] = usePref('installHintDismissed', '')
  const canPrompt = useSyncExternalStore(subscribeInstall, canPromptInstall)

  if (dismissed || isStandalone()) return null
  const ios = isIOS()
  if (!ios && !canPrompt) return null
  // iPhone 上的 Chrome、Firefox、Edge
  const otherBrowser = ios && /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)

  return (
    <div className="mb-5 rounded-2xl bg-surface-2 p-4 pr-12 text-[15px] leading-relaxed relative">
      <button
        type="button"
        aria-label="關閉提示"
        onClick={() => setDismissed('1')}
        className="absolute top-1 right-1 flex size-11 items-center justify-center text-fg-2"
      >
        <X size={20} aria-hidden />
      </button>
      <p className="font-bold">先加到主畫面，再開始記錄</p>
      {ios ? (
        <p className="mt-1 text-fg-2">
          {otherBrowser && '請先改用 Safari 開啟這個網址。'}
          點 Safari 的「分享」按鈕（新版 iOS 在「⋯」選單裡），選「加入主畫面」，之後都從主畫面的圖示開啟。在
          Safari 裡記的資料不會帶到主畫面的 App。
        </p>
      ) : (
        <>
          <p className="mt-1 text-fg-2">裝到主畫面之後可以全螢幕使用，沒有網路也能開。</p>
          <Button size="md" className="mt-3" onClick={() => void promptInstall()}>
            安裝到主畫面
          </Button>
        </>
      )}
    </div>
  )
}
