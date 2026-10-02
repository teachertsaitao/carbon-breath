// 很小的 PDF 產生器：每一頁是一張鋪滿 A4 的 JPEG 圖片。
//
// 不內嵌字型、不需要額外的套件，所以 App 不會因此變大，離線也能用。
// 代價是 PDF 裡的文字是圖片的一部分，不能選取或搜尋。

export interface PdfPageImage {
  /** JPEG 檔的內容 */
  jpeg: Uint8Array
  /** 圖片的像素寬、高 */
  width: number
  height: number
}

/** A4 的大小（PDF 的單位是 point，1 point = 1/72 英吋） */
const A4_W = 595.28
const A4_H = 841.89

/** PDF 裡的中文字串要寫成 UTF-16BE 的十六進位，前面加 FEFF */
function hexString(s: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
  return `<${hex}>`
}

/** PDF 的日期格式：D:YYYYMMDDHHmmSSZ（UTC） */
function pdfDate(d: Date): string {
  const p = (n: number, len = 2) => String(n).padStart(len, '0')
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

export function buildPdf(pages: PdfPageImage[], info: { title: string; created: Date }): Uint8Array<ArrayBuffer> {
  if (pages.length === 0) throw new Error('PDF 至少要有一頁')

  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  /** 每個物件在檔案裡的位置（第幾個位元組），寫 xref 表的時候要用 */
  const offsets: number[] = []
  let length = 0

  const write = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (num: number, body: string) => {
    offsets[num] = length
    write(`${num} 0 obj\n${body}\nendobj\n`)
  }

  // 物件編號：1 目錄、2 頁面清單、3 文件資訊；之後每一頁用三個：頁面、圖片、內容
  const pageObj = (i: number) => 4 + i * 3
  const imageObj = (i: number) => 5 + i * 3
  const contentObj = (i: number) => 6 + i * 3
  const objectCount = 3 + pages.length * 3

  write('%PDF-1.4\n')
  // 第二行放幾個大於 127 的位元組，讓其他程式知道這是二進位檔
  write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`)
  object(3, `<< /Title ${hexString(info.title)} /Producer (Carbon Breath Log) /CreationDate (${pdfDate(info.created)}) >>`)

  pages.forEach((page, i) => {
    object(
      pageObj(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] ` +
        `/Resources << /XObject << /Im0 ${imageObj(i)} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
        `/Contents ${contentObj(i)} 0 R >>`,
    )

    offsets[imageObj(i)] = length
    write(
      `${imageObj(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    )
    write(page.jpeg)
    write('\nendstream\nendobj\n')

    // 把圖片放大到整頁
    const content = `q ${A4_W} 0 0 ${A4_H} 0 0 cm /Im0 Do Q`
    object(contentObj(i), `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  })

  // xref 表：每一列固定 20 個位元組
  const xrefAt = length
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`
  for (let n = 1; n <= objectCount; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  write(xref)
  write(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
