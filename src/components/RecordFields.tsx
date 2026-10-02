// 狀態、呼吸費力徵象、備註這三個欄位。量完之後、手動補登、修改舊紀錄都用同一組。

import { SIGNS, SIGN_LABEL, STATES, STATE_LABEL } from '../lib/labels'
import type { EffortSign, SleepState } from '../lib/types'
import { CheckRow, ChoiceGroup, Section, TEXTAREA_CLASS } from './ui'

export interface RecordFieldValues {
  state: SleepState | null
  signs: EffortSign[]
  note: string
}

interface Props {
  value: RecordFieldValues
  onChange: (next: RecordFieldValues) => void
}

const STATE_OPTIONS = STATES.map((s) => ({ value: s, label: STATE_LABEL[s] }))

export function RecordFields({ value, onChange }: Props) {
  return (
    <>
      <Section title="牠剛才的狀態" hint="只有「熟睡」的紀錄會用來算基準值、判斷呼吸數警示。">
        <ChoiceGroup
          label="狀態"
          options={STATE_OPTIONS}
          value={value.state}
          onChange={(state) => state && onChange({ ...value, state })}
        />
      </Section>

      <Section title="有沒有呼吸費力的樣子" hint="有看到才勾，可以複選。">
        <div className="flex flex-col gap-2">
          {SIGNS.map((sign) => (
            <CheckRow
              key={sign}
              tone="danger"
              label={SIGN_LABEL[sign]}
              checked={value.signs.includes(sign)}
              onChange={(checked) =>
                onChange({
                  ...value,
                  signs: checked ? [...value.signs, sign] : value.signs.filter((s) => s !== sign),
                })
              }
            />
          ))}
        </div>
      </Section>

      <Section title="備註">
        <textarea
          className={TEXTAREA_CLASS}
          placeholder="例如：剛吃完藥、睡在冷氣房"
          aria-label="備註"
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
      </Section>
    </>
  )
}
