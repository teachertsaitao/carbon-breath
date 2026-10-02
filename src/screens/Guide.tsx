// 使用說明：第一次打開 App 時會先看到這一頁，之後可以從「設定」再打開。

import { Page } from '../components/Layout'
import { Button, Section } from '../components/ui'
import { useSettings } from '../lib/db'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import { DISCLAIMER, RED_ADVICE, SIGNS, SIGN_LABEL, YELLOW_ADVICE } from '../lib/labels'

interface GuideProps {
  /** 第一次使用：按鈕是「開始使用」；從設定頁進來：按鈕是「回設定」 */
  firstRun?: boolean
  onDone: () => void
}

export function GuideScreen({ firstRun = false, onDone }: GuideProps) {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  const t = settings.thresholds

  return (
    <Page title="怎麼量睡眠呼吸次數">
      <Section title="什麼時候量">
        <p className="text-base leading-relaxed">
          等牠<strong>熟睡</strong>、身體放鬆、沒有抽動或作夢的時候再量。剛玩完、剛喝完水、天氣熱在喘的時候量到的數字不準。
        </p>
      </Section>

      <Section title="怎麼數">
        <ol className="list-decimal space-y-2 pl-5 text-base leading-relaxed">
          <li>看牠的胸口，<strong>一起一伏算一次</strong>。</li>
          <li>按「量呼吸」，點一下畫面開始，之後每呼吸一次點一下。整個畫面都可以點，眼睛看著牠就好。</li>
          <li>數 30 秒或 60 秒，時間到會自動換算成每分鐘幾次；也可以選「數 {settings.counter.quickTarget} 次」，點滿就算出結果。</li>
          <li>最後選牠剛才的狀態（熟睡、淺眠、清醒休息）。只有熟睡的紀錄會用來算基準值和判斷警示。</li>
        </ol>
      </Section>

      <Section title="參考範圍">
        <p className="text-base leading-relaxed">
          多數狗熟睡時每分鐘呼吸在 30 次以下。每隻狗不一樣，請以獸醫師告訴你的標準為準；門檻可以在「設定」裡調整。
        </p>
        <p className="mt-2 text-base leading-relaxed">
          記錄幾天之後，App 會算出牠自己的<strong>基準值</strong>（最近 {t.baselineDays} 天熟睡紀錄的中位數），用來判斷有沒有比平常快。
        </p>
      </Section>

      <Section title="黃色警示">
        <p className="text-base leading-relaxed">
          熟睡時每分鐘 {t.yellowRate} 次以上，或比基準值高出 {t.baselinePct}% 以上。
        </p>
        <p className="mt-2 rounded-2xl bg-warn-bg px-4 py-3 text-base leading-relaxed">{YELLOW_ADVICE}</p>
      </Section>

      <Section title="紅色警示">
        <p className="text-base leading-relaxed">熟睡時每分鐘 {t.redRate} 次以上，或出現下面任何一種呼吸費力的樣子：</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base leading-relaxed">
          {SIGNS.map((s) => (
            <li key={s}>{SIGN_LABEL[s]}</li>
          ))}
        </ul>
        <p className="mt-3 rounded-2xl bg-danger-bg px-4 py-3 text-base leading-relaxed font-bold">{RED_ADVICE}</p>
      </Section>

      <Section title="請注意">
        <p className="text-base leading-relaxed">{DISCLAIMER}</p>
        <p className="mt-2 text-base leading-relaxed text-fg-2">
          資料只存在這支手機裡，沒有上傳到任何地方。建議定期到「設定」匯出備份。
        </p>
      </Section>

      <Button className="mt-2 w-full" onClick={onDone}>
        {firstRun ? '開始使用' : '回設定'}
      </Button>
    </Page>
  )
}
