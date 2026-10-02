// 手動補登：沒有用 App 計數（例如用手錶數的、或家人口頭告知）時，直接輸入數字。

import { useState } from 'react'
import { DateTimeInput } from '../components/DateTimeInput'
import { Page } from '../components/Layout'
import { RecordFields, type RecordFieldValues } from '../components/RecordFields'
import { Button, Field, INPUT_CLASS, Section, Sheet } from '../components/ui'
import { isImplausible } from '../lib/alerts'
import { checkDateTimeParts, toDateTimeParts, type DateTimeParts } from '../lib/dates'
import { addBreath, useSettings } from '../lib/db'
import { useNow } from '../lib/hooks'
import { navigate } from '../lib/router'

const FUTURE_MESSAGE = '這個時間還沒到。測量時間不能是未來，請確認日期和時間。'

export function ManualScreen() {
  const settings = useSettings()
  const [rate, setRate] = useState('')
  // 測量的日期和時間：預設是現在，可以直接打數字改
  const [when, setWhen] = useState<DateTimeParts>(() => toDateTimeParts(new Date()))
  const now = useNow()
  const [fields, setFields] = useState<RecordFieldValues>({ state: null, signs: [], note: '' })
  const [error, setError] = useState('')
  const [oddOpen, setOddOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!settings) return <Page title="手動補登">{null}</Page>

  const back = () => navigate('/trends', { replace: true })

  const save = async (skipOddCheck = false) => {
    const n = Number(rate)
    if (rate.trim() === '' || !Number.isInteger(n) || n < 1 || n > 300) {
      setError('請輸入每分鐘呼吸次數（整數）。')
      return
    }
    const checked = checkDateTimeParts(when)
    if (!checked.ok) {
      setError(checked.message)
      return
    }
    const at = checked.date
    if (at.getTime() > Date.now() + 60_000) {
      setError(FUTURE_MESSAGE)
      return
    }
    if (!fields.state) {
      setError('請選牠當時的狀態。')
      return
    }
    if (!skipOddCheck && isImplausible(n)) {
      setOddOpen(true)
      return
    }
    setError('')
    setSaving(true)
    try {
      await addBreath({
        measuredAt: at,
        rate: n,
        mode: 'manual',
        breaths: null,
        durationSec: null,
        state: fields.state,
        signs: fields.signs,
        note: fields.note,
      })
      back()
    } catch {
      setError('儲存失敗，請再試一次。')
      setSaving(false)
    }
  }

  return (
    <Page title="手動補登">
      <Section>
        <div className="flex flex-col gap-4">
          <Field label="每分鐘呼吸次數">
            <input
              className={INPUT_CLASS}
              inputMode="numeric"
              placeholder="例如 22"
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^\d]/g, ''))}
            />
          </Field>
          <DateTimeInput
            value={when}
            onChange={(next) => {
              setWhen(next)
              setError('')
            }}
            now={now}
            futureMessage={FUTURE_MESSAGE}
          />
        </div>
      </Section>

      <RecordFields value={fields} onChange={setFields} />

      {error && (
        <p className="mb-3 text-[15px] font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button variant="secondary" onClick={back}>
          取消
        </Button>
        <Button className="flex-1" disabled={saving} onClick={() => void save()}>
          儲存
        </Button>
      </div>

      <Sheet open={oddOpen} title="這個數字看起來不太對" onClose={() => setOddOpen(false)}>
        <p className="text-base leading-relaxed text-fg-2">每分鐘 {rate} 次不在常見範圍內，請確認有沒有打錯。</p>
        <div className="mt-5 flex flex-col gap-2.5">
          <Button onClick={() => setOddOpen(false)}>回去修改</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOddOpen(false)
              void save(true)
            }}
          >
            數字沒錯，照樣儲存
          </Button>
        </div>
      </Sheet>
    </Page>
  )
}
