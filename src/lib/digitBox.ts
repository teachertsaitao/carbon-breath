// 「一格一格填數字」的輸入規則（純計算）：手動補登的年、月、日、時、分各一格。
//
// 目標是打起來順：點進格子直接打就會蓋掉原本的數字，不用先刪；打滿了自動跳下一格。
// 麻煩的地方是，點進格子時游標可能落在數字的前面、中間或後面，手機也不一定會把數字選起來，
// 所以不能假設「新打的字一定在最後面」，要比較改之前和改之後的內容才知道這一下打了什麼。

export interface DigitBoxRule {
  /** 最多幾位數 */
  max: number
  /**
   * 第一個數字比這個大，就不可能再接第二個數字，可以直接補 0 跳下一格。
   * 例：月份打 3 一定是 3 月（沒有 30 幾月），小時打 5 一定是 5 點。
   */
  firstMax: number
}

export interface DigitBoxResult {
  /** 這一格現在的內容 */
  value: string
  /** 這一格填好了，可以跳到下一格 */
  done: boolean
  /** 這一下真的打了數字或改到內容。有的話，這一格就不再算「剛點進來」 */
  touched: boolean
}

/**
 * 比較改之前和改之後的字，找出這一下「新加進去的字」和「被拿掉的字」。
 * 例：08 → 008 是加進一個 0、沒有拿掉任何字；31 → 30 是拿掉 1、加進 0。
 */
export function diffText(before: string, after: string): { inserted: string; removed: string } {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++
  }
  return { inserted: after.slice(start, after.length - end), removed: before.slice(start, before.length - end) }
}

/**
 * 使用者在格子裡打了字之後，這一格應該變成什麼。
 *
 * @param before 打字之前格子裡的內容
 * @param raw 打字之後輸入框裡的內容（還沒整理過，可能超過位數、可能有不是數字的字）
 * @param fresh 是不是剛點進這一格、還沒打過字
 */
export function nextBoxValue(before: string, raw: string, rule: DigitBoxRule, fresh: boolean): DigitBoxResult {
  const diff = diffText(before, raw)
  const typed = diff.inserted.replace(/\D/g, '')
  let value: string
  if (typed && diff.removed === '' && (fresh || before.length >= rule.max)) {
    // 在原本的數字旁邊又打了新的數字，而且是剛點進這一格、或這一格已經滿了：
    // 新打的直接取代原本的內容，不用先刪
    value = typed.slice(0, rule.max)
  } else {
    // 其他情況（把選起來的字換掉、刪除、還沒打滿接著打）：照輸入框裡的內容
    value = raw.replace(/\D/g, '').slice(0, rule.max)
  }
  let done = typed !== '' && value.length === rule.max
  if (!done && typed !== '' && rule.max === 2 && value.length === 1 && Number(value) > rule.firstMax) {
    value = `0${value}`
    done = true
  }
  return { value, done, touched: typed !== '' || value !== before }
}
