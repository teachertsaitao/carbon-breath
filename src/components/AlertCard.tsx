// 警示結果卡片：量完之後、首頁亮紅燈時、查看舊紀錄時都用這一張。
// 顏色之外一定搭配圖示和文字，不只靠顏色傳達。

import { CircleCheck, Phone, Siren, TriangleAlert } from 'lucide-react'
import { describeAlert } from '../lib/labels'
import { navigate } from '../lib/router'
import { hasPhone, telHref } from '../lib/settings'
import type { AlertResult, BreathRecord, Contact, Contacts } from '../lib/types'
import { buttonClass } from './ui'

const TONE = {
  red: { box: 'bg-danger-bg', icon: 'text-danger' },
  yellow: { box: 'bg-warn-bg', icon: 'text-warn' },
  none: { box: 'bg-ok-bg', icon: 'text-ok' },
  info: { box: 'bg-surface-2', icon: 'text-fg-2' },
} as const

function CallButton({ contact, fallbackName, primary }: { contact: Contact; fallbackName: string; primary: boolean }) {
  const name = contact.name.trim() || fallbackName
  return (
    <a
      href={telHref(contact.phone)}
      className={buttonClass(primary ? 'danger' : 'secondary', 'lg', 'h-auto min-h-16 w-full flex-col gap-0.5 py-2.5')}
    >
      <span className="flex items-center gap-2">
        <Phone size={20} strokeWidth={2.5} aria-hidden />
        撥給{name}
      </span>
      <span className="text-sm font-medium opacity-85">{contact.phone}</span>
    </a>
  )
}

/** 一鍵撥號：急診醫院優先，其次是常規醫院；還沒設定就引導去設定。 */
export function CallButtons({ contacts, urgent }: { contacts: Contacts; urgent: boolean }) {
  const emergency = hasPhone(contacts.emergency.phone)
  const regular = hasPhone(contacts.regular.phone)
  return (
    <div className="flex flex-col gap-2.5">
      {emergency && <CallButton contact={contacts.emergency} fallbackName="急診醫院" primary={urgent} />}
      {regular && (
        <CallButton contact={contacts.regular} fallbackName="常規醫院" primary={urgent && !emergency} />
      )}
      {urgent && !emergency && (
        <p className="text-sm text-fg-2">
          還沒有設定 24 小時急診醫院的電話。
          <button type="button" className="font-bold text-fg underline underline-offset-2" onClick={() => navigate('/settings')}>
            現在去設定
          </button>
        </p>
      )}
    </div>
  )
}

interface AlertCardProps {
  record: Pick<BreathRecord, 'rate' | 'state' | 'signs'>
  alert: AlertResult
  contacts: Contacts
}

export function AlertCard({ record, alert, contacts }: AlertCardProps) {
  const text = describeAlert(record, alert)
  const level = alert.level
  const tone = level === 'none' && record.state !== 'deep' ? TONE.info : TONE[level]
  const Icon = level === 'red' ? Siren : level === 'yellow' ? TriangleAlert : CircleCheck

  return (
    <div className={`rounded-3xl p-5 ${tone.box}`} role={level === 'none' ? 'status' : 'alert'}>
      <div className="flex items-start gap-3">
        <Icon size={28} strokeWidth={2.25} className={`mt-0.5 shrink-0 ${tone.icon}`} aria-hidden />
        <h2 className="text-[22px] leading-snug font-bold">{text.title}</h2>
      </div>

      {text.reasons.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-[15px] leading-relaxed">
          {text.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {text.advice && <p className="mt-3 text-[15px] leading-relaxed">{text.advice}</p>}

      {level === 'red' && (
        <div className="mt-4">
          <CallButtons contacts={contacts} urgent />
        </div>
      )}
      {level === 'yellow' && hasPhone(contacts.regular.phone) && (
        <a
          href={telHref(contacts.regular.phone)}
          className="mt-3 inline-flex min-h-11 items-center gap-2 text-[15px] font-bold underline underline-offset-4"
        >
          <Phone size={18} strokeWidth={2.5} aria-hidden />
          撥給{contacts.regular.name.trim() || '常規醫院'}
        </a>
      )}
    </div>
  )
}
