// 圖表上幾條橫線（紅色門檻、黃色門檻、基準值）的名稱要標在哪裡（純計算）。
//
// 平常門檻的名稱標在線的上方、基準值標在線的下方。
// 但基準值升到門檻附近的時候，兩條線靠得很近，照平常的標法名稱會互相蓋住、
// 或是被另一條線從中間劃過去，所以要換邊，真的沒辦法再往右錯開。
// 趨勢頁的圖表和回診報告的圖表都用這一份。

export type LabelSide = 'above' | 'below'

export interface LineLabel {
  /** 這條線的 y 位置（px，數字越小越上面） */
  y: number
  /** 名稱大約多寬（px） */
  width: number
  /** 平常標在線的哪一邊 */
  prefer: LabelSide
}

export interface LabelPlace {
  side: LabelSide
  /** 文字基線的 y 位置 */
  baseline: number
  /** 要往右移多少（px）；平常是 0 */
  dx: number
}

interface Box {
  top: number
  bottom: number
}

/** 名稱佔的高度範圍：標在線上方時離線 3px，標在下方時也離線 3px */
function boxOf(y: number, side: LabelSide, fontSize: number): Box {
  return side === 'above' ? { top: y - fontSize - 3, bottom: y - 3 } : { top: y + 3, bottom: y + fontSize + 5 }
}

/** 兩個名稱的高度範圍有沒有重疊（差 1px 以內不算） */
const overlaps = (a: Box, b: Box) => a.top < b.bottom - 1 && b.top < a.bottom - 1

const flip = (side: LabelSide): LabelSide => (side === 'above' ? 'below' : 'above')

/**
 * 決定每條線的名稱標在線的上方還是下方。
 * 把所有的標法都試一次（最多三條線，只有 8 種），挑最不擠的那一種。
 *
 * @param lines 每條線；排在前面的優先留在原位
 * @param opts.fontSize 字的大小
 * @param opts.top / opts.bottom 名稱可以出現的範圍（超出去會被切掉，或蓋到日期）
 */
export function placeLineLabels(
  lines: LineLabel[],
  opts: { fontSize: number; top: number; bottom: number },
): LabelPlace[] {
  const n = lines.length
  let best: LabelSide[] = lines.map((l) => l.prefer)
  let bestCost = Infinity
  for (let mask = 0; mask < 1 << n; mask++) {
    const sides = lines.map((l, i) => (mask & (1 << i) ? flip(l.prefer) : l.prefer))
    const boxes = lines.map((l, i) => boxOf(l.y, sides[i], opts.fontSize))
    let cost = 0
    for (let i = 0; i < n; i++) {
      // 能照平常的標法最好
      if (sides[i] !== lines[i].prefer) cost += 1
      // 超出圖表範圍
      if (boxes[i].top < opts.top || boxes[i].bottom > opts.bottom) cost += 40
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        // 別條線從這個名稱中間劃過去，或是緊貼著它（差 2px 以內）
        if (lines[j].y > boxes[i].top - 2 && lines[j].y < boxes[i].bottom + 2) cost += 10
        // 兩個名稱疊在一起
        if (j > i && overlaps(boxes[i], boxes[j])) cost += 100
      }
    }
    if (cost < bestCost) {
      bestCost = cost
      best = sides
    }
  }

  // 幾條線幾乎在同一個位置、怎麼換邊都會疊在一起時：後面的名稱往右移，排在前一個的右邊
  const boxes = lines.map((l, i) => boxOf(l.y, best[i], opts.fontSize))
  const places: LabelPlace[] = []
  lines.forEach((l, i) => {
    let dx = 0
    for (let j = 0; j < i; j++) {
      if (overlaps(boxes[i], boxes[j])) dx = Math.max(dx, places[j].dx + lines[j].width + 12)
    }
    places.push({ side: best[i], baseline: best[i] === 'above' ? l.y - 5 : l.y + opts.fontSize + 2, dx })
  })
  return places
}

/** 估計一段文字大約多寬：中文字算一個字寬，英數字和空白算 0.6 個字寬 */
export function estimateTextWidth(s: string, fontSize: number): number {
  let width = 0
  for (const ch of s) width += (ch.codePointAt(0) ?? 0) > 0x2e7f ? fontSize : fontSize * 0.6
  return width
}
