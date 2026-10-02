import { describe, expect, it } from 'vitest'
import { estimateTextWidth, placeLineLabels, type LabelPlace, type LineLabel } from './chartLabels'

const FONT = 12
/** 跟趨勢頁的圖表一樣的比例：每 1 次／分大約 5.4px，圖表範圍 16–206 */
const PX = 5.4
const TOP = 0
const BOTTOM = 206
const y = (rate: number) => BOTTOM - (rate - 10) * PX

function place(red: number, yellow: number, base: number | null, px = PX) {
  const yy = (rate: number) => BOTTOM - (rate - 10) * px
  const lines: LineLabel[] = [
    { y: yy(red), width: 62, prefer: 'above' },
    { y: yy(yellow), width: 62, prefer: 'above' },
  ]
  if (base != null) lines.push({ y: yy(base), width: 50, prefer: 'below' })
  return { lines, places: placeLineLabels(lines, { fontSize: FONT, top: TOP, bottom: BOTTOM }) }
}

/** 名稱實際佔的範圍（跟 chartLabels.ts 裡的算法一樣） */
function rect(line: LineLabel, p: LabelPlace) {
  const top = p.side === 'above' ? line.y - FONT - 3 : line.y + 3
  const bottom = p.side === 'above' ? line.y - 3 : line.y + FONT + 5
  return { top, bottom, left: p.dx, right: p.dx + line.width }
}

/** 有沒有任何兩個名稱疊在一起 */
function anyOverlap(lines: LineLabel[], places: LabelPlace[]): boolean {
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = rect(lines[i], places[i])
      const b = rect(lines[j], places[j])
      const vertical = a.top < b.bottom - 1 && b.top < a.bottom - 1
      const horizontal = a.left < b.right && b.left < a.right
      if (vertical && horizontal) return true
    }
  }
  return false
}

/** 有沒有哪個名稱被別條線從中間劃過去（沒有往右移開的才算） */
function anyStruck(lines: LineLabel[], places: LabelPlace[]): boolean {
  return lines.some((line, i) => {
    const r = rect(line, places[i])
    return lines.some((other, j) => j !== i && other.y > r.top && other.y < r.bottom)
  })
}

describe('圖表橫線名稱的位置', () => {
  it('平常：門檻標在線上方、基準值標在線下方，都不用移', () => {
    const { places } = place(40, 30, 22)
    expect(places.map((p) => p.side)).toEqual(['above', 'above', 'below'])
    expect(places.map((p) => p.dx)).toEqual([0, 0, 0])
    expect(places[0].baseline).toBe(y(40) - 5)
    expect(places[2].baseline).toBe(y(22) + FONT + 2)
  })

  it('沒有基準值時只有兩條門檻', () => {
    const { places } = place(40, 30, null)
    expect(places.map((p) => p.side)).toEqual(['above', 'above'])
  })

  it('基準值在黃色門檻上面一點點：基準值改標上方、黃色門檻改標下方', () => {
    for (const base of [30.5, 31, 32, 33]) {
      const { lines, places } = place(40, 30, base)
      expect(places[2].side, `基準值 ${base}`).toBe('above')
      expect(places[1].side, `基準值 ${base}`).toBe('below')
      expect(places[0].side).toBe('above')
      expect(anyOverlap(lines, places)).toBe(false)
      expect(anyStruck(lines, places)).toBe(false)
    }
  })

  it('基準值再高一點（兩條線中間放得下一個名稱）：只要把黃色門檻改標下方', () => {
    const { lines, places } = place(40, 30, 34)
    expect(places.map((p) => p.side)).toEqual(['above', 'below', 'below'])
    expect(anyOverlap(lines, places)).toBe(false)
    expect(anyStruck(lines, places)).toBe(false)
  })

  it('基準值在黃色門檻下面一點點：照平常的標法就不會擠', () => {
    for (const base of [26, 28, 29, 29.5, 30]) {
      const { lines, places } = place(40, 30, base)
      expect(places.map((p) => p.side), `基準值 ${base}`).toEqual(['above', 'above', 'below'])
      expect(anyOverlap(lines, places)).toBe(false)
      expect(anyStruck(lines, places)).toBe(false)
    }
  })

  it('基準值在紅色門檻上面一點點：基準值改標上方、紅色門檻改標下方', () => {
    const { lines, places } = place(40, 30, 41)
    expect(places[2].side).toBe('above')
    expect(places[0].side).toBe('below')
    expect(places[1].side).toBe('above')
    expect(anyOverlap(lines, places)).toBe(false)
    expect(anyStruck(lines, places)).toBe(false)
  })

  it('基準值貼近圖表底部：改標上方，不要蓋到日期', () => {
    const { places } = place(40, 30, 11)
    expect(places[2].side).toBe('above')
    expect(places[2].baseline).toBeLessThan(BOTTOM)
  })

  it('不管基準值在哪裡，名稱都不會疊在一起（兩種圖表比例都試）', () => {
    for (const px of [5.4, 3.65, 2.5]) {
      for (let base = 10; base <= 50; base += 0.5) {
        const { lines, places } = place(40, 30, base, px)
        expect(anyOverlap(lines, places), `比例 ${px}、基準值 ${base}`).toBe(false)
      }
    }
  })

  it('兩個門檻設得很近、基準值又在中間：換邊也排不開，就往右錯開', () => {
    const { lines, places } = place(31, 30, 30.5)
    expect(anyOverlap(lines, places)).toBe(false)
    expect(places.some((p) => p.dx > 0)).toBe(true)
  })

  it('門檻設成一樣的數字也不會疊在一起', () => {
    const { lines, places } = place(30, 30, 30)
    expect(anyOverlap(lines, places)).toBe(false)
  })
})

describe('估計文字寬度', () => {
  it('中文字算一個字寬，英數字和空白算 0.6 個', () => {
    expect(estimateTextWidth('基準值', 10)).toBe(30)
    expect(estimateTextWidth('24', 10)).toBe(12)
    expect(estimateTextWidth('黃色門檻 30', 10)).toBeCloseTo(40 + 18, 5)
  })
})
