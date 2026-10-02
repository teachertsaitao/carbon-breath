import { describe, expect, it } from 'vitest'
import { diffText, nextBoxValue, type DigitBoxRule } from './digitBox'

const YEAR: DigitBoxRule = { max: 4, firstMax: 9 }
const MONTH: DigitBoxRule = { max: 2, firstMax: 1 }
const DAY: DigitBoxRule = { max: 2, firstMax: 3 }
const HOUR: DigitBoxRule = { max: 2, firstMax: 2 }
const MINUTE: DigitBoxRule = { max: 2, firstMax: 5 }

/** 模擬連續打好幾個字：每次都把新的字加在目前內容的最後面 */
function typeAtEnd(start: string, keys: string, rule: DigitBoxRule, fresh = true) {
  let value = start
  let done = false
  let isFresh = fresh
  for (const key of keys) {
    const r = nextBoxValue(value, value + key, rule, isFresh)
    value = r.value
    done = r.done
    if (r.touched) isFresh = false
  }
  return { value, done }
}

describe('比較改之前和改之後的字', () => {
  it('加在後面、中間、前面', () => {
    expect(diffText('08', '080')).toEqual({ inserted: '0', removed: '' })
    expect(diffText('08', '018')).toEqual({ inserted: '1', removed: '' })
    expect(diffText('08', '108')).toEqual({ inserted: '1', removed: '' })
  })
  it('整個換掉、換掉一部分、刪除', () => {
    expect(diffText('13', '09')).toEqual({ inserted: '09', removed: '13' })
    expect(diffText('31', '30')).toEqual({ inserted: '0', removed: '1' })
    expect(diffText('12', '1')).toEqual({ inserted: '', removed: '2' })
    expect(diffText('12', '')).toEqual({ inserted: '', removed: '12' })
    expect(diffText('', '5')).toEqual({ inserted: '5', removed: '' })
    expect(diffText('12', '12')).toEqual({ inserted: '', removed: '' })
  })
})

describe('一格一格填數字', () => {
  it('剛點進格子直接打：蓋掉原本的數字（不管游標在最後面、中間還是最前面）', () => {
    for (const raw of ['080', '008']) {
      expect(nextBoxValue('08', raw, HOUR, true)).toEqual({ value: '0', done: false, touched: true })
    }
    for (const raw of ['301', '310', '130']) {
      expect(nextBoxValue('30', raw, MINUTE, true)).toEqual({ value: '1', done: false, touched: true })
    }
  })

  it('半夜 00:12：在「時」打 0、0 → 00，跳下一格；在「分」打 1、2 → 12', () => {
    expect(typeAtEnd('08', '00', HOUR)).toEqual({ value: '00', done: true })
    expect(typeAtEnd('30', '12', MINUTE)).toEqual({ value: '12', done: true })
  })

  it('第一個數字就確定是一位數的，補 0 直接跳下一格', () => {
    expect(typeAtEnd('10', '9', MONTH)).toEqual({ value: '09', done: true }) // 沒有 9 幾月
    expect(typeAtEnd('10', '2', MONTH)).toEqual({ value: '02', done: true })
    expect(typeAtEnd('03', '4', DAY)).toEqual({ value: '04', done: true }) // 沒有 40 幾日
    expect(typeAtEnd('08', '3', HOUR)).toEqual({ value: '03', done: true }) // 沒有 30 幾點
    expect(typeAtEnd('30', '6', MINUTE)).toEqual({ value: '06', done: true }) // 沒有 60 幾分
  })

  it('第一個數字還可能接第二個的，先等著', () => {
    expect(typeAtEnd('10', '1', MONTH)).toEqual({ value: '1', done: false }) // 可能是 1 月，也可能是 10–12 月
    expect(typeAtEnd('03', '3', DAY)).toEqual({ value: '3', done: false })
    expect(typeAtEnd('08', '2', HOUR)).toEqual({ value: '2', done: false })
    expect(typeAtEnd('08', '0', HOUR)).toEqual({ value: '0', done: false })
    expect(typeAtEnd('30', '5', MINUTE)).toEqual({ value: '5', done: false })
    expect(typeAtEnd('10', '12', MONTH)).toEqual({ value: '12', done: true })
    expect(typeAtEnd('08', '23', HOUR)).toEqual({ value: '23', done: true })
  })

  it('格子滿了再打（不是剛點進來）：當作重新輸入，不會卡住', () => {
    expect(nextBoxValue('12', '123', MINUTE, false)).toEqual({ value: '3', done: false, touched: true })
    expect(nextBoxValue('12', '312', MINUTE, false)).toEqual({ value: '3', done: false, touched: true })
    expect(nextBoxValue('12', '127', MINUTE, false)).toEqual({ value: '07', done: true, touched: true })
    expect(typeAtEnd('30', '1234', MINUTE)).toEqual({ value: '34', done: true })
  })

  it('還沒打滿就接著打：接在後面', () => {
    expect(nextBoxValue('1', '15', DAY, false)).toEqual({ value: '15', done: true, touched: true })
    expect(nextBoxValue('', '1', DAY, false)).toEqual({ value: '1', done: false, touched: true })
    expect(nextBoxValue('', '5', HOUR, false)).toEqual({ value: '05', done: true, touched: true })
  })

  it('數字被選起來的時候打字（整個換掉）：照打的', () => {
    expect(nextBoxValue('31', '3', DAY, true)).toEqual({ value: '3', done: false, touched: true })
    expect(nextBoxValue('31', '30', DAY, true)).toEqual({ value: '30', done: true, touched: true })
    expect(nextBoxValue('13', '09', MONTH, true)).toEqual({ value: '09', done: true, touched: true })
    expect(nextBoxValue('08', '0', HOUR, true)).toEqual({ value: '0', done: false, touched: true })
    expect(nextBoxValue('08', '8', HOUR, true)).toEqual({ value: '8', done: false, touched: true })
  })

  it('刪除：照刪，不會自動補 0 或跳格', () => {
    expect(nextBoxValue('15', '1', DAY, false)).toEqual({ value: '1', done: false, touched: true })
    expect(nextBoxValue('15', '5', DAY, false)).toEqual({ value: '5', done: false, touched: true })
    expect(nextBoxValue('15', '', DAY, true)).toEqual({ value: '', done: false, touched: true })
  })

  it('刪掉一個字之後再打：接在後面（不會整個重來）', () => {
    // 剛點進「日」(15) → 按刪除變成 1 → 再打 6 → 16
    const afterDelete = nextBoxValue('15', '1', DAY, true)
    expect(afterDelete.value).toBe('1')
    expect(nextBoxValue('1', '16', DAY, !afterDelete.touched)).toEqual({ value: '16', done: true, touched: true })
  })

  it('不是數字的字不收，也不算動過', () => {
    expect(nextBoxValue('12', '12.', MINUTE, true)).toEqual({ value: '12', done: false, touched: false })
    expect(nextBoxValue('12', '12a', MINUTE, false)).toEqual({ value: '12', done: false, touched: false })
    expect(nextBoxValue('', '-', HOUR, true)).toEqual({ value: '', done: false, touched: false })
  })

  it('年份：四位數打滿才跳下一格', () => {
    expect(typeAtEnd('2026', '2', YEAR)).toEqual({ value: '2', done: false })
    expect(typeAtEnd('2026', '202', YEAR)).toEqual({ value: '202', done: false })
    expect(typeAtEnd('2026', '2025', YEAR)).toEqual({ value: '2025', done: true })
  })

  it('一次貼上很多數字：只留這一格放得下的', () => {
    expect(nextBoxValue('2026', '202620251002', YEAR, true)).toEqual({ value: '2025', done: true, touched: true })
    expect(nextBoxValue('', '0012', HOUR, true)).toEqual({ value: '00', done: true, touched: true })
  })
})
