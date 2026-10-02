// 把檔案交給使用者：開啟系統的分享選單，或直接下載。

/** 這支手機能不能用系統的分享選單送出這個檔案 */
export function canShareFile(file: File): boolean {
  try {
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    )
  } catch {
    return false
  }
}

export type ShareResult = 'shared' | 'cancelled' | 'failed'

/**
 * 開啟系統的分享選單（可以存到「檔案」、傳 LINE、AirDrop、列印）。
 *
 * 注意：瀏覽器規定「分享」必須緊接在使用者的點擊之後呼叫，中間不能先等別的事情做完，
 * 所以檔案要事先準備好，按鈕按下去就直接呼叫這個函式。
 */
export async function shareFile(file: File): Promise<ShareResult> {
  try {
    // 只傳檔案、不附標題或文字：有些 App 收到文字會把它另外存成一個檔
    await navigator.share({ files: [file] })
    return 'shared'
  } catch (err) {
    return (err as DOMException | undefined)?.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

/** 直接下載到裝置 */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
