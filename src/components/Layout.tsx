// 頁面外框與底部分頁列。

import { ChartLine, ClipboardList, House, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { navigate, type Route } from '../lib/router'

interface PageProps {
  title: string
  /** 標題右邊的小字（例如日期） */
  aside?: ReactNode
  children: ReactNode
  /** 底部要多留的空間（首頁有固定在下方的大按鈕） */
  extraBottom?: number
}

export function Page({ title, aside, children, extraBottom = 0 }: PageProps) {
  return (
    <main
      className="mx-auto w-full max-w-[480px] px-5"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 22px)',
        paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${92 + extraBottom}px)`,
      }}
    >
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="text-[28px] leading-tight font-bold">{title}</h1>
        {aside && <div className="shrink-0 text-[15px] text-fg-2">{aside}</div>}
      </header>
      {children}
    </main>
  )
}

const TABS = [
  { name: 'home', path: '/', label: '首頁', Icon: House },
  { name: 'daily', path: '/daily', label: '每日紀錄', Icon: ClipboardList },
  { name: 'trends', path: '/trends', label: '趨勢', Icon: ChartLine },
  { name: 'settings', path: '/settings', label: '設定', Icon: Settings },
] as const

export function TabBar({ current }: { current: Route['name'] }) {
  return (
    <nav
      aria-label="主要分頁"
      className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-auto flex h-16 max-w-[480px]">
        {TABS.map(({ name, path, label, Icon }) => {
          const active = current === name
          return (
            <button
              key={name}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(path)}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
                active ? 'font-bold text-fg' : 'font-medium text-fg-3'
              }`}
            >
              <Icon size={24} strokeWidth={active ? 2.5 : 2} aria-hidden />
              {label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
