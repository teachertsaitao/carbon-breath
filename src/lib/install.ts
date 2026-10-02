// Android／Chrome 的「安裝到主畫面」：瀏覽器準備好時會送出 beforeinstallprompt 事件，
// 這個事件可能在畫面還沒出現前就來了，所以一開始就先接住存起來。

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

export function initInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    listeners.forEach((fn) => fn())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((fn) => fn())
  })
}

export function canPromptInstall(): boolean {
  return deferred != null
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return
  const event = deferred
  deferred = null
  await event.prompt()
  await event.userChoice.catch(() => undefined)
  listeners.forEach((fn) => fn())
}
