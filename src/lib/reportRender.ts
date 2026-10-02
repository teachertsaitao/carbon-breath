// 把回診報告畫成 A4 頁面，再包成 PDF 檔。
//
// 為什麼不是「列印 → 存成 PDF」：iPhone 從主畫面開啟的 App 叫不出列印畫面，
// 所以改成自己把報告一頁一頁畫出來（用 canvas），直接做成 PDF，再交給分享選單或下載。
// 文字是用手機內建的字型畫上去的，所以 PDF 裡的文字不能選取，但在任何裝置上看起來都一樣。
//
// 要改報告的內容或排版，改這個檔案；數字的算法在 report.ts。

import { placeLineLabels } from './chartLabels'
import { ageText, formatDateFull, formatDateShort, formatDateWeekday } from './dates'
import { APPETITE_LABEL, APPETITES, COUGH_LABEL, COUGH_LEVELS, ENERGIES, ENERGY_LABEL } from './labels'
import { buildPdf, type PdfPageImage } from './pdf'
import {
  countsText,
  reportFilename,
  reportRows,
  reportTitle,
  type ReportData,
  type ReportDay,
  type ReportRow,
} from './report'
import { formatRate } from './stats'

// 版面的單位是「96 dpi 的 A4」：794 × 1123。實際畫的時候放大 2 倍，印出來才夠清楚。
const PAGE_W = 794
const PAGE_H = 1123
const PRINT_SCALE = 2
/** 只是為了排版、不會真的拿來用的頁面，畫在很小的畫布上就好 */
const DRAFT_SCALE = 0.1
const MX = 48 // 左右邊界
const TOP = 46
const LIMIT = PAGE_H - 54 // 內容最低只能畫到這裡，下面留給頁尾
const CW = PAGE_W - MX * 2

const INK = '#1f2225'
const INK2 = '#596067'
const INK3 = '#858b92'
const RULE = '#cfd3ce'
const FAINT = '#e8eae7'
const WARN = '#e0a516'
const DANGER = '#cb4133'
const FONT = `-apple-system, system-ui, 'PingFang TC', 'Noto Sans TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif`

/** 各種間距。內容只多出一點點就要多一頁的時候，會改用比較緊的那一組，盡量排進同一頁。 */
interface Spacing {
  /** 小節標題上方的空白 */
  section: number
  /** 摘要每一列的高度 */
  summaryRow: number
  /** 趨勢圖的高度 */
  plot: number
  /** 每日表格每一列的高度 */
  row: number
  /** 個別紀錄每一行的高度、每一筆之間的空白 */
  entryLine: number
  entryGap: number
}

const NORMAL: Spacing = { section: 24, summaryRow: 20, plot: 146, row: 22, entryLine: 18, entryGap: 4 }
const COMPACT: Spacing = { section: 19, summaryRow: 19, plot: 126, row: 20, entryLine: 17, entryGap: 2 }

type Ctx = CanvasRenderingContext2D

interface Pen {
  title: string
  sp: Spacing
  scale: number
  /** 只有這一頁要用 scale 的大小畫出來，其他頁用很小的畫布帶過；null 是每一頁都畫 */
  only: number | null
  pages: HTMLCanvasElement[]
  ctxs: Ctx[]
  ctx: Ctx
  /** 目前畫到的位置（下一塊內容的上緣） */
  y: number
}

// ── 基本的畫圖工具 ──────────────────────────────────

interface TextOpts {
  size?: number
  weight?: number
  color?: string
  align?: CanvasTextAlign
  /** 文字後面墊一圈白色，壓在線上也看得清楚 */
  halo?: boolean
}

function setFont(ctx: Ctx, size: number, weight: number): void {
  ctx.font = `${weight} ${size}px ${FONT}`
}

/** 在 (x, y) 寫一行字；y 是文字的基線 */
function text(ctx: Ctx, s: string, x: number, y: number, o: TextOpts = {}): void {
  setFont(ctx, o.size ?? 13, o.weight ?? 400)
  ctx.textAlign = o.align ?? 'left'
  ctx.textBaseline = 'alphabetic'
  if (o.halo) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = 4
    ctx.strokeStyle = '#ffffff'
    ctx.setLineDash([])
    ctx.strokeText(s, x, y)
  }
  ctx.fillStyle = o.color ?? INK
  ctx.fillText(s, x, y)
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width = 1, dash: number[] = []): void {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'butt'
  ctx.setLineDash(dash)
  ctx.stroke()
  ctx.setLineDash([])
}

function dot(ctx: Ctx, x: number, y: number, r: number, fill: string, ring = 0): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  if (ring > 0) {
    ctx.lineWidth = ring * 2
    ctx.strokeStyle = '#ffffff'
    ctx.setLineDash([])
    ctx.stroke()
  }
  ctx.fillStyle = fill
  ctx.fill()
}

/** 這些標點不可以出現在一行的開頭 */
const NO_LINE_START = '，。、；：！？）」』％'

/** 把一段文字切成不超過 maxWidth 的幾行。中文可以在任何字之間換行，英文和數字盡量不拆開。 */
function wrap(ctx: Ctx, s: string, maxWidth: number, size: number, weight = 400): string[] {
  setFont(ctx, size, weight)
  const lines: string[] = []
  for (const paragraph of s.split('\n')) {
    const tokens = paragraph.match(/[0-9A-Za-z.]+|[^0-9A-Za-z.]/gu) ?? []
    let current = ''
    for (const token of tokens) {
      if (current === '' && token === ' ') continue
      const candidate = current + token
      if (current === '' || ctx.measureText(candidate).width <= maxWidth || NO_LINE_START.includes(token)) {
        current = candidate
      } else {
        lines.push(current.trimEnd())
        current = token === ' ' ? '' : token
      }
      // 單獨一個就比整行還寬的英數字串：只好硬切
      while (current.length > 1 && !NO_LINE_START.includes(token) && ctx.measureText(current).width > maxWidth) {
        let cut = current.length - 1
        while (cut > 1 && ctx.measureText(current.slice(0, cut)).width > maxWidth) cut--
        lines.push(current.slice(0, cut))
        current = current.slice(cut)
      }
    }
    lines.push(current.trimEnd())
  }
  return lines
}

// ── 分頁 ────────────────────────────────────────────

function addPage(pen: Pen): void {
  const scale = pen.only == null || pen.only === pen.pages.length ? pen.scale : DRAFT_SCALE
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(PAGE_W * scale)
  canvas.height = Math.round(PAGE_H * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('這個瀏覽器沒辦法產生報告')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)
  pen.pages.push(canvas)
  pen.ctxs.push(ctx)
  pen.ctx = ctx
  pen.y = TOP
  if (pen.pages.length > 1) {
    text(ctx, `${pen.title}（續）`, MX, TOP - 4, { size: 11, color: INK3 })
    pen.y = TOP + 8
  }
}

/** 接下來要畫 height 這麼高的東西，這一頁放不下就換頁。回傳有沒有換頁。 */
function need(pen: Pen, height: number): boolean {
  if (pen.y + height <= LIMIT) return false
  addPage(pen)
  return true
}

/** 小節標題。minBody：標題下面至少要有這麼高的內容跟它在同一頁。 */
function section(pen: Pen, label: string, minBody: number): void {
  need(pen, pen.sp.section + 8 + minBody)
  pen.y += pen.sp.section
  text(pen.ctx, label, MX, pen.y, { size: 15, weight: 700 })
  pen.y += 8
}

// ── 各個區塊 ────────────────────────────────────────

function drawHeader(pen: Pen, d: ReportData): void {
  const { ctx } = pen
  const base = pen.y + 24
  const made = `製表日期 ${formatDateFull(d.generatedOn)}`
  setFont(ctx, 11.5, 400)
  const titleRoom = CW - ctx.measureText(made).width - 24
  // 名字很長的時候把標題的字縮小，不要蓋到右邊的製表日期
  let titleSize = 24
  setFont(ctx, titleSize, 700)
  while (titleSize > 13 && ctx.measureText(pen.title).width > titleRoom) {
    titleSize -= 1
    setFont(ctx, titleSize, 700)
  }
  text(ctx, wrap(ctx, pen.title, titleRoom, titleSize, 700)[0], MX, base, { size: titleSize, weight: 700 })
  text(ctx, made, PAGE_W - MX, base, { size: 11.5, color: INK2, align: 'right' })
  let y = base + 24
  text(ctx, `期間：${formatDateFull(d.from)} – ${formatDateFull(d.to)}（共 ${d.dayCount} 天）`, MX, y, { size: 13.5 })
  const pet = [d.pet.breed.trim(), ageText(d.pet.birthday, d.to)].filter(Boolean).join('，')
  if (pet) {
    for (const l of wrap(ctx, pet, CW, 12.5).slice(0, 2)) {
      y += 19
      text(ctx, l, MX, y, { size: 12.5, color: INK2 })
    }
  }
  y += 12
  line(ctx, MX, y, PAGE_W - MX, y, INK, 1.5)
  pen.y = y
}

function drawSummary(pen: Pen, d: ReportData): void {
  section(pen, '摘要', 150)
  const { ctx, sp } = pen
  const t = d.thresholds
  const gap = 28
  const colW = (CW - gap) / 2
  const labelW = 86

  const left: [string, string][] = [
    [
      '熟睡紀錄',
      d.deep.count > 0 ? `${d.deep.count} 筆（${d.dayCount} 天裡有 ${d.deep.days} 天有量）` : '這段期間沒有熟睡時的紀錄',
    ],
    ['期間中位數', d.deep.median != null ? `${formatRate(d.deep.median)} 次／分` : '—'],
    ['最低／最高', d.deep.min != null ? `${d.deep.min}／${d.deep.max} 次／分` : '—'],
    [
      '基準值',
      d.baseline.value != null
        ? `${formatRate(d.baseline.value)} 次／分（到 ${formatDateShort(d.to)} 為止 ${t.baselineDays} 天的中位數）`
        : `紀錄不足（${t.baselineDays} 天內要有 ${t.baselineMinCount} 筆熟睡紀錄）`,
    ],
    ['警示次數', `紅色 ${d.alerts.red} 次，黃色 ${d.alerts.yellow} 次`],
  ]
  const right: [string, string][] = [
    ['咳嗽', countsText(d.cough, COUGH_LABEL, COUGH_LEVELS) || '沒有紀錄'],
    ['食慾', countsText(d.appetite, APPETITE_LABEL, APPETITES) || '沒有紀錄'],
    ['精神', countsText(d.energy, ENERGY_LABEL, ENERGIES) || '沒有紀錄'],
    ['其他狀態', d.otherCount > 0 ? `淺眠或清醒休息時量了 ${d.otherCount} 筆，不列入左邊的統計` : '沒有淺眠或清醒休息時量的紀錄'],
  ]

  const column = (rows: [string, string][], x: number): number => {
    let y = pen.y
    for (const [label, value] of rows) {
      const lines = wrap(ctx, value, colW - labelW, 13, 500)
      y += sp.summaryRow
      text(ctx, label, x, y, { size: 12.5, color: INK2 })
      lines.forEach((l, i) => text(ctx, l, x + labelW, y + i * 17, { size: 13, weight: 500 }))
      y += (lines.length - 1) * 17
    }
    return y
  }
  pen.y = Math.max(column(left, MX), column(right, MX + colW + gap)) + 18

  const note =
    `警示門檻：黃色＝熟睡時 ${t.yellowRate} 次／分以上，或比基準值高 ${t.baselinePct}% 以上；` +
    `紅色＝熟睡時 ${t.redRate} 次／分以上，或有呼吸費力的徵象。各項統計只算熟睡時量的紀錄。`
  const lines = wrap(ctx, note, CW, 11.5)
  lines.forEach((l, i) => text(ctx, l, MX, pen.y + i * 17, { size: 11.5, color: INK2 }))
  pen.y += (lines.length - 1) * 17 + 2
}

function pointColor(median: number, d: ReportData): string {
  if (median >= d.thresholds.redRate) return DANGER
  if (median >= d.thresholds.yellowRate) return WARN
  return INK
}

function drawChart(pen: Pen, d: ReportData): void {
  const plotH = pen.sp.plot
  section(pen, '熟睡呼吸次數趨勢（每分鐘）', plotH + 58)
  const { ctx } = pen
  const withDeep = d.days.filter((day) => day.deep)
  if (withDeep.length === 0) {
    pen.y += 16
    text(ctx, '這段期間沒有熟睡時的紀錄。', MX, pen.y, { size: 13, color: INK2 })
    return
  }

  const t = d.thresholds
  const left = MX + 30
  const right = PAGE_W - MX - 6
  const top = pen.y + 12
  const bottom = top + plotH
  const n = d.days.length
  const band = (right - left) / n

  const rates: number[] = []
  for (const day of withDeep) rates.push(day.deep!.min, day.deep!.max)
  const yMax = Math.ceil((Math.max(...rates, t.redRate) + 3) / 5) * 5
  const yMin = Math.max(0, Math.min(10, Math.floor((Math.min(...rates) - 3) / 5) * 5))
  const x = (i: number) => left + band * (i + 0.5)
  const y = (v: number) => bottom - ((v - yMin) / (yMax - yMin)) * plotH

  // 格線和 Y 軸刻度
  const step = yMax - yMin > 60 ? 20 : 10
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
    line(ctx, left, y(v), right, y(v), v === yMin ? RULE : FAINT)
    text(ctx, String(v), left - 8, y(v) + 4, { size: 11, color: INK3, align: 'right' })
  }
  line(ctx, left, bottom, right, bottom, RULE)

  // X 軸日期：最多標 9 個左右
  const labelStep = Math.max(1, Math.ceil(n / 9))
  d.days.forEach((day, i) => {
    if ((n - 1 - i) % labelStep === 0) {
      text(ctx, formatDateShort(day.date), x(i), bottom + 16, { size: 11, color: INK3, align: 'center' })
    }
  })

  // 門檻線（虛線）和基準值（實線）
  line(ctx, left, y(t.yellowRate), right, y(t.yellowRate), WARN, 1.5, [5, 4])
  line(ctx, left, y(t.redRate), right, y(t.redRate), DANGER, 1.5, [5, 4])
  const base = d.baseline.value
  const baseShown = base != null && base >= yMin && base <= yMax
  if (baseShown) line(ctx, left, y(base), right, y(base), INK3, 1.25)

  // 當天最低到最高
  for (let i = 0; i < n; i++) {
    const deep = d.days[i].deep
    if (!deep || deep.max === deep.min) continue
    ctx.beginPath()
    ctx.moveTo(x(i), y(deep.max))
    ctx.lineTo(x(i), y(deep.min))
    ctx.strokeStyle = INK3
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.stroke()
  }

  // 每日中位數：只把連續的日子連起來，中間沒量的日子不連
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.75
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  let drawing = false
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const deep = d.days[i].deep
    if (!deep) {
      drawing = false
      continue
    }
    if (drawing) ctx.lineTo(x(i), y(deep.median))
    else ctx.moveTo(x(i), y(deep.median))
    drawing = true
  }
  ctx.stroke()

  const r = band >= 12 ? 3.5 : 2.5
  for (let i = 0; i < n; i++) {
    const deep = d.days[i].deep
    if (deep) dot(ctx, x(i), y(deep.median), r, pointColor(deep.median, d), 1.5)
  }

  // 線的名稱直接標在線旁邊。基準值升到門檻附近時兩條線會靠得很近，名稱的位置要錯開才不會互相蓋住
  const labelSize = 11
  const lineLabels: { text: string; y: number; prefer: 'above' | 'below' }[] = [
    { text: `紅色門檻 ${t.redRate}`, y: y(t.redRate), prefer: 'above' },
    { text: `黃色門檻 ${t.yellowRate}`, y: y(t.yellowRate), prefer: 'above' },
  ]
  if (baseShown) lineLabels.push({ text: `基準值 ${formatRate(base)}`, y: y(base), prefer: 'below' })
  setFont(ctx, labelSize, 400)
  const places = placeLineLabels(
    lineLabels.map((l) => ({ y: l.y, width: ctx.measureText(l.text).width, prefer: l.prefer })),
    { fontSize: labelSize, top: top - 10, bottom },
  )
  lineLabels.forEach((l, i) =>
    text(ctx, l.text, left + 4 + places[i].dx, places[i].baseline, { size: labelSize, color: INK2, halo: true }),
  )

  // 圖例
  const ly = bottom + 36
  let lx = MX
  line(ctx, lx, ly - 4, lx + 22, ly - 4, INK, 1.75)
  dot(ctx, lx + 11, ly - 4, 3.5, INK, 1.5)
  text(ctx, '每日中位數', lx + 28, ly, { size: 11.5, color: INK2 })
  lx += 28 + ctx.measureText('每日中位數').width + 20
  line(ctx, lx + 2, ly - 10, lx + 2, ly + 2, INK3, 2)
  text(ctx, '當天最低到最高', lx + 10, ly, { size: 11.5, color: INK2 })
  lx += 10 + ctx.measureText('當天最低到最高').width + 20
  text(ctx, '沒有連線的地方是那幾天沒有熟睡時的紀錄', lx, ly, { size: 11.5, color: INK3 })

  pen.y = ly + 4
}

interface Col {
  label: string
  w: number
  align: 'left' | 'right'
}

const COLS: Col[] = [
  { label: '日期', w: 96, align: 'left' },
  { label: '熟睡中位數', w: 76, align: 'right' },
  { label: '最低–最高', w: 78, align: 'right' },
  { label: '筆數', w: 46, align: 'right' },
  { label: '警示', w: 96, align: 'left' },
  { label: '咳嗽', w: 84, align: 'left' },
  { label: '食慾', w: 62, align: 'left' },
  { label: '精神', w: 62, align: 'left' },
  { label: '活動後喘', w: 98, align: 'left' },
]

/** 第 i 欄文字的 x 位置 */
function colX(i: number): number {
  let x = MX
  for (let k = 0; k < i; k++) x += COLS[k].w
  const c = COLS[i]
  if (c.align === 'right') return x + c.w - 4
  return i === 0 ? x : x + 16
}

/** 一列裡文字基線的位置（從這一列的上緣算起） */
const rowBase = (pen: Pen) => Math.round(pen.sp.row * 0.68)

function tableHeader(pen: Pen): void {
  const { ctx } = pen
  COLS.forEach((c, i) =>
    text(ctx, c.label, colX(i), pen.y + rowBase(pen), { size: 11.5, weight: 500, color: INK2, align: c.align }),
  )
  pen.y += pen.sp.row
  line(ctx, MX, pen.y, PAGE_W - MX, pen.y, INK2)
}

function tableRow(pen: Pen, day: ReportDay): void {
  const { ctx } = pen
  const base = pen.y + rowBase(pen)
  const dash = (i: number) => text(ctx, '—', colX(i), base, { size: 12.5, color: INK3, align: COLS[i].align })
  const cell = (i: number, s: string, bold = false) =>
    text(ctx, s, colX(i), base, { size: 12.5, weight: bold ? 700 : 400, align: COLS[i].align })

  cell(0, formatDateWeekday(day.date))

  if (day.deep) {
    cell(1, formatRate(day.deep.median), true)
    cell(2, day.deep.min === day.deep.max ? String(day.deep.min) : `${day.deep.min}–${day.deep.max}`)
    cell(3, String(day.deep.count))
  } else {
    dash(1)
    dash(2)
    dash(3)
  }

  // 警示：色塊加文字，不只靠顏色
  if (day.red + day.yellow === 0) {
    dash(4)
  } else {
    let x = colX(4)
    const mark = (color: string, label: string) => {
      ctx.fillStyle = color
      ctx.fillRect(x, base - 9, 9, 9)
      text(ctx, label, x + 13, base, { size: 12.5, weight: 700 })
      x += 13 + ctx.measureText(label).width + 10
    }
    if (day.red > 0) mark(DANGER, `紅 ${day.red}`)
    if (day.yellow > 0) mark(WARN, `黃 ${day.yellow}`)
  }

  const log = day.log
  if (log?.cough) cell(5, COUGH_LABEL[log.cough], log.cough === 'some' || log.cough === 'many')
  else dash(5)
  if (log?.appetite) cell(6, APPETITE_LABEL[log.appetite], log.appetite !== 'normal')
  else dash(6)
  if (log?.energy) cell(7, ENERGY_LABEL[log.energy], log.energy !== 'normal')
  else dash(7)
  if (log?.recoveryMin != null) cell(8, log.recoveryMin === 0 ? '沒有喘' : `${log.recoveryMin} 分鐘`)
  else dash(8)

  pen.y += pen.sp.row
  line(ctx, MX, pen.y, PAGE_W - MX, pen.y, FAINT)
}

/** 連續好幾天都沒有紀錄：合成一列 */
function gapRow(pen: Pen, row: Extract<ReportRow, { kind: 'gap' }>): void {
  const { ctx } = pen
  const base = pen.y + rowBase(pen)
  const label = `${formatDateWeekday(row.from)} – ${formatDateWeekday(row.to)}`
  text(ctx, label, MX, base, { size: 12.5 })
  const width = ctx.measureText(label).width
  text(ctx, `這 ${row.count} 天沒有紀錄`, MX + width + 18, base, { size: 12.5, color: INK3 })
  pen.y += pen.sp.row
  line(ctx, MX, pen.y, PAGE_W - MX, pen.y, FAINT)
}

function drawTable(pen: Pen, d: ReportData): void {
  section(pen, '每日紀錄', pen.sp.row * 4)
  tableHeader(pen)
  for (const row of reportRows(d.days)) {
    if (need(pen, pen.sp.row)) tableHeader(pen)
    if (row.kind === 'gap') gapRow(pen, row)
    else tableRow(pen, row.day)
  }
}

function drawEntries(pen: Pen, d: ReportData): void {
  section(pen, '個別紀錄與備註', 60)
  pen.y += 14
  text(pen.ctx, '列出有警示的、不是熟睡時量的，以及有寫備註的紀錄。', MX, pen.y, { size: 11.5, color: INK2 })
  pen.y += 8

  if (d.entries.length === 0) {
    pen.y += 18
    text(pen.ctx, '這段期間沒有這類紀錄。', MX, pen.y, { size: 13, color: INK2 })
    return
  }

  const dateW = 122
  const tagW = 68
  const textX = MX + dateW + tagW
  const { entryLine, entryGap } = pen.sp
  /** 換頁之後，在新的一頁最上面再標一次這一節的名稱 */
  const continued = () => {
    pen.y += 14
    text(pen.ctx, '個別紀錄與備註（續）', MX, pen.y, { size: 12.5, weight: 700 })
    pen.y += 8
  }
  /** 一整頁最多放得下多高的內容 */
  const pageRoom = LIMIT - (TOP + 8 + 22)

  for (const entry of d.entries) {
    const lines = wrap(pen.ctx, entry.text, PAGE_W - MX - textX, 12.5)
    const height = lines.length * entryLine + entryGap
    // 一筆紀錄盡量不要拆成兩頁；備註長到一頁都放不下時，才一行一行接到下一頁
    const whole = height <= pageRoom
    if (need(pen, whole ? height : entryLine * 3)) continued()
    lines.forEach((l, i) => {
      if (!whole && i > 0 && need(pen, entryLine)) continued()
      const { ctx } = pen
      const base = pen.y + Math.round(entryLine * 0.8)
      if (i === 0) {
        text(ctx, `${formatDateWeekday(entry.date)}${entry.time ? ` ${entry.time}` : ''}`, MX, base, { size: 12.5, color: INK2 })
        if (entry.level !== 'none') {
          ctx.fillStyle = entry.level === 'red' ? DANGER : WARN
          ctx.fillRect(MX + dateW, base - 9, 9, 9)
          text(ctx, entry.level === 'red' ? '紅色' : '黃色', MX + dateW + 13, base, { size: 12.5, weight: 700 })
        }
      }
      text(ctx, l, textX, base, { size: 12.5 })
      pen.y += entryLine
    })
    pen.y += entryGap
  }
}

function drawFooters(pen: Pen): void {
  const total = pen.ctxs.length
  pen.ctxs.forEach((ctx, i) => {
    line(ctx, MX, PAGE_H - 44, PAGE_W - MX, PAGE_H - 44, RULE)
    text(ctx, '本報告由飼主在家記錄整理，僅供獸醫師參考，不能取代獸醫師的診斷。', MX, PAGE_H - 26, { size: 10.5, color: INK3 })
    text(ctx, `第 ${i + 1}／${total} 頁`, PAGE_W - MX, PAGE_H - 26, { size: 10.5, color: INK3, align: 'right' })
  })
}

function layout(d: ReportData, sp: Spacing, scale: number, only: number | null): HTMLCanvasElement[] {
  const pen = { title: reportTitle(d.pet), sp, scale, only, pages: [], ctxs: [], y: TOP } as unknown as Pen
  addPage(pen)
  drawHeader(pen, d)
  drawSummary(pen, d)
  drawChart(pen, d)
  drawTable(pen, d)
  drawEntries(pen, d)
  drawFooters(pen)
  return pen.pages
}

/** 把畫布佔的記憶體還回去（手機上畫布能用的記憶體有上限） */
function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

/** 用很小的畫布排一次版，只為了知道會有幾頁（排版的結果跟畫布大小無關） */
function countPages(d: ReportData, sp: Spacing): number {
  const pages = layout(d, sp, DRAFT_SCALE, null)
  pages.forEach(release)
  return pages.length
}

/**
 * 決定用哪一組間距、總共幾頁。
 * 先用一般的間距排；如果超過一頁，而改用比較緊的間距可以少一頁，就用緊的那一組
 * （避免最後一頁只有一兩行）。
 */
function planPages(d: ReportData): { sp: Spacing; count: number } {
  const normal = countPages(d, NORMAL)
  if (normal > 1) {
    const compact = countPages(d, COMPACT)
    if (compact < normal) return { sp: COMPACT, count: compact }
  }
  return { sp: NORMAL, count: normal }
}

/**
 * 畫出其中一頁（從 0 開始算）。
 * 一次只畫一頁大圖：一頁就要 14 MB 左右的記憶體，全部一起畫的話，頁數多的報告在手機上可能畫不出來。
 */
function drawPage(d: ReportData, sp: Spacing, index: number): HTMLCanvasElement {
  const pages = layout(d, sp, PRINT_SCALE, index)
  pages.forEach((canvas, i) => {
    if (i !== index) release(canvas)
  })
  return pages[index]
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('沒辦法把頁面轉成圖片'))), 'image/jpeg', 0.92)
  })
}

export interface RenderedReport {
  /** 做好的 PDF 檔 */
  file: File
  /** 每一頁的圖片，畫面上預覽和列印用 */
  previews: Blob[]
}

/** 產生報告的 PDF 檔和每一頁的預覽圖 */
export async function renderReport(d: ReportData): Promise<RenderedReport> {
  const { sp, count } = planPages(d)
  const previews: Blob[] = []
  const pages: PdfPageImage[] = []
  for (let i = 0; i < count; i++) {
    const canvas = drawPage(d, sp, i)
    try {
      const blob = await toJpeg(canvas)
      previews.push(blob)
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height })
    } finally {
      release(canvas)
    }
  }
  const bytes = buildPdf(pages, { title: reportTitle(d.pet), created: new Date() })
  const file = new File([bytes], reportFilename(d.pet, d.from, d.to), { type: 'application/pdf' })
  return { file, previews }
}
