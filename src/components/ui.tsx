// 共用的基本元件：按鈕、選項、勾選列、對話框。
// 尺寸都以「單手、拇指好按」為準：主要按鈕高 56px，選項至少 52px。

import { Check } from 'lucide-react'
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useScrollLock } from '../lib/hooks'

// ── 按鈕 ────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'lg' | 'md' | 'sm'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary',
  secondary: 'bg-surface-2 text-fg',
  ghost: 'text-fg-2',
  danger: 'bg-danger-fill text-on-danger',
}
const BUTTON_SIZE: Record<ButtonSize, string> = {
  lg: 'h-14 px-6 text-[17px] rounded-2xl',
  md: 'h-12 px-5 text-base rounded-[14px]',
  sm: 'h-10 px-4 text-sm rounded-xl',
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-bold select-none transition-transform active:scale-[.98] disabled:opacity-40 disabled:active:scale-100'

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'lg', extra = ''): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${extra}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant, size, className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />
}

// ── 單選（大按鈕）───────────────────────────────────

export interface Option<T extends string> {
  value: T
  label: string
}

interface ChoiceGroupProps<T extends string> {
  label: string
  options: Option<T>[]
  value: T | null
  onChange: (value: T | null) => void
  /** 幾欄；預設跟選項數一樣（排成一列） */
  columns?: number
  /** 再點一次已選的選項可以取消（選填的欄位用） */
  clearable?: boolean
  /** sm：放在卡片裡用的小一號版本 */
  size?: 'md' | 'sm'
}

export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  columns,
  clearable = false,
  size = 'md',
}: ChoiceGroupProps<T>) {
  const sizeClass = size === 'sm' ? 'min-h-11 rounded-xl text-[15px]' : 'min-h-[52px] rounded-[14px] text-base'
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(selected && clearable ? null : o.value)}
            className={`${sizeClass} border px-2 leading-tight font-medium transition-colors ${
              selected ? 'border-primary bg-primary font-bold text-on-primary' : 'border-line bg-surface text-fg'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── 複選（小標籤）───────────────────────────────────

interface ChipGroupProps<T extends string> {
  label: string
  options: Option<T>[]
  values: T[]
  onChange: (values: T[]) => void
}

export function ChipGroup<T extends string>({ label, options, values, onChange }: ChipGroupProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const selected = values.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? values.filter((v) => v !== o.value) : [...values, o.value])}
            className={`inline-flex min-h-12 items-center gap-1.5 rounded-full border px-4 text-base font-medium transition-colors ${
              selected ? 'border-primary bg-primary font-bold text-on-primary' : 'border-line bg-surface text-fg'
            }`}
          >
            {selected && <Check size={18} strokeWidth={3} aria-hidden />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── 勾選列（整列都可以點）───────────────────────────

interface CheckRowProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  /** danger：勾起來時用紅色（呼吸費力徵象） */
  tone?: 'neutral' | 'danger'
}

export function CheckRow({ label, checked, onChange, tone = 'neutral' }: CheckRowProps) {
  const on =
    tone === 'danger' ? 'border-danger-fill bg-danger-bg text-fg' : 'border-primary bg-surface-2 text-fg'
  const box =
    tone === 'danger' ? 'border-danger-fill bg-danger-fill text-on-danger' : 'border-primary bg-primary text-on-primary'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex min-h-[52px] w-full items-center gap-3 rounded-[14px] border px-4 text-left text-base font-medium transition-colors ${
        checked ? on : 'border-line bg-surface text-fg'
      }`}
    >
      <span
        aria-hidden
        className={`flex size-6 shrink-0 items-center justify-center rounded-md border-2 ${
          checked ? box : 'border-fg-3'
        }`}
      >
        {checked && <Check size={16} strokeWidth={3.5} />}
      </span>
      {label}
    </button>
  )
}

// ── 區塊與欄位 ──────────────────────────────────────

export function Section({
  title,
  hint,
  children,
  className = '',
}: {
  title?: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`border-t border-line py-5 first:border-t-0 first:pt-0 ${className}`}>
      {title && <h2 className="text-[17px] leading-snug font-bold">{title}</h2>}
      {hint && <p className="mt-1 text-sm text-fg-2">{hint}</p>}
      <div className={title || hint ? 'mt-3' : ''}>{children}</div>
    </section>
  )
}

export const INPUT_CLASS =
  'h-12 w-full rounded-[14px] border border-line bg-surface px-4 text-base text-fg placeholder:text-fg-3'

export const TEXTAREA_CLASS =
  'min-h-24 w-full rounded-[14px] border border-line bg-surface px-4 py-3 text-base text-fg placeholder:text-fg-3'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[15px] font-medium text-fg-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-fg-2">{hint}</span>}
    </label>
  )
}

// ── 從下方滑出的對話框 ──────────────────────────────

interface SheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** 用夜間配色（量呼吸流程裡的對話框） */
  night?: boolean
}

export function Sheet({ open, title, onClose, children, night = false }: SheetProps) {
  useScrollLock(open)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center ${night ? 'night' : ''}`}>
      <div className="anim-fade-in absolute inset-0 bg-black/55" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="anim-sheet-in relative max-h-[88dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-bg px-5 pt-6 text-fg"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
      >
        <h2 className="text-xl leading-snug font-bold">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  )
}

// ── 提示訊息條 ──────────────────────────────────────

type Tone = 'ok' | 'warn' | 'danger' | 'neutral'

const NOTICE_TONE: Record<Tone, string> = {
  ok: 'bg-ok-bg',
  warn: 'bg-warn-bg',
  danger: 'bg-danger-bg',
  neutral: 'bg-surface-2',
}

export function Notice({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`flex gap-3 rounded-2xl px-4 py-3.5 text-[15px] leading-relaxed ${NOTICE_TONE[tone]}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  )
}
