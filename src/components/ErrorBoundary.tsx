// 萬一畫面出錯，至少顯示一段說明和「重新整理」按鈕，不要整個白掉。

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { exportBackup } from '../lib/backup'
import { buttonClass } from './ui'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main
        className="mx-auto w-full max-w-[480px] px-5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}
      >
        <h1 className="text-[26px] leading-tight font-bold">畫面出了點問題</h1>
        <p className="mt-3 text-base leading-relaxed">
          你的紀錄都還在手機裡，沒有不見。請按下面的按鈕重新整理；如果一直出現，請把這個畫面截圖下來。
        </p>
        <button type="button" className={buttonClass('primary', 'lg', 'mt-6 w-full')} onClick={() => window.location.reload()}>
          重新整理
        </button>
        {/* 就算畫面壞了，也要能把資料帶走 */}
        <button
          type="button"
          className={buttonClass('secondary', 'lg', 'mt-2.5 w-full')}
          onClick={() => void exportBackup().catch(() => {})}
        >
          先匯出備份檔
        </button>
        <p className="mt-6 text-sm break-words text-fg-2">{this.state.error.message}</p>
      </main>
    )
  }
}

/** 資料庫打不開時（例如瀏覽器的無痕模式不允許儲存）顯示的畫面 */
export function StorageError({ message }: { message: string }) {
  return (
    <main
      className="mx-auto w-full max-w-[480px] px-5"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}
    >
      <h1 className="text-[26px] leading-tight font-bold">無法儲存資料</h1>
      <p className="mt-3 text-base leading-relaxed">
        這個瀏覽器目前不允許 App 把紀錄存在手機裡。常見原因是開了無痕（私密瀏覽）模式，或手機儲存空間已滿。請用一般模式重新開啟。
      </p>
      <button type="button" className={buttonClass('primary', 'lg', 'mt-6 w-full')} onClick={() => window.location.reload()}>
        再試一次
      </button>
      <p className="mt-6 text-sm break-words text-fg-2">{message}</p>
    </main>
  )
}
