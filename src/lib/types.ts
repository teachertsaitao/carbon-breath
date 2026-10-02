// 資料格式定義。README 的「資料格式」一節是這個檔案的白話版，兩邊要一起改。

/** 量呼吸當下的狀態：熟睡／淺眠／清醒休息。只有 deep 會用來算基準值、判斷呼吸數警示。 */
export type SleepState = 'deep' | 'light' | 'awake'

/** 呼吸費力徵象：休息時張嘴喘／肚子用力呼吸／坐著不肯躺下／牙齦發紫或發白 */
export type EffortSign = 'openMouth' | 'abdominal' | 'sitting' | 'gums'

/** timed＝計時模式、quick＝快速模式、manual＝手動補登 */
export type CountMode = 'timed' | 'quick' | 'manual'

export type AlertLevel = 'none' | 'yellow' | 'red'

/**
 * 觸發警示的原因。
 * rateRed：熟睡呼吸數達紅色門檻　signs：有呼吸費力徵象
 * rateYellow：熟睡呼吸數達黃色門檻　aboveBaseline：比基準值高出設定的百分比
 */
export type AlertReason = 'rateRed' | 'signs' | 'rateYellow' | 'aboveBaseline'

/**
 * 每一筆資料都有的欄位，是為了之後做「多支手機同步」預留的：
 * - id 用 UUID，兩支手機各自新增也不會撞號
 * - updatedAt 用來判斷哪一邊比較新
 * - deletedAt 不是 null 就代表已刪除（只做標記、不真的刪，刪除才同步得過去）
 * - deviceId 記錄是哪一支手機寫的
 */
export interface SyncFields {
  id: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deviceId: string
}

/**
 * 一筆紀錄的警示判斷結果。這個「不會存進資料庫」，每次顯示時用目前的門檻現算，
 * 所以在設定頁調整門檻之後，首頁、清單、圖表會一起用新門檻判斷，不會互相矛盾。
 */
export interface AlertResult {
  level: AlertLevel
  reasons: AlertReason[]
  /** 判斷時使用的基準值（這筆紀錄「之前」的熟睡紀錄）；紀錄不足就是 null */
  baseline: number | null
  yellowRate: number
  redRate: number
  baselinePct: number
}

/** 一次呼吸測量 */
export interface BreathRecord extends SyncFields {
  /** 測量時間（ISO 8601，UTC） */
  measuredAt: string
  /** 測量當下的當地日期 YYYY-MM-DD，用來做「每天」的統計 */
  date: string
  /** 每分鐘呼吸次數（四捨五入到整數） */
  rate: number
  mode: CountMode
  /** 實際點了幾次；手動補登為 null */
  breaths: number | null
  /** 實際數了幾秒；手動補登為 null */
  durationSec: number | null
  state: SleepState
  signs: EffortSign[]
  note: string
  /** 記錄者名字（選填，在設定頁填，方便家人之間分辨） */
  recorder: string
}

export type CoughLevel = 'none' | 'few' | 'some' | 'many'
export type CoughContext = 'night' | 'excited' | 'afterDrink' | 'other'
export type Appetite = 'normal' | 'reduced' | 'none'
export type Energy = 'normal' | 'low' | 'veryLow'
export type Amount = 'normal' | 'more' | 'less'

/**
 * 每日紀錄，一天一筆，id 就是日期（YYYY-MM-DD）。
 * 兩支手機填了同一天，匯入合併時會逐欄合併：一邊沒填的欄位用另一邊的補上（見 backup.ts）。
 */
export interface DailyLog extends SyncFields {
  date: string
  /** 咳嗽次數：none=0、few=1–3、some=4–10、many=10 次以上；null=還沒填 */
  cough: CoughLevel | null
  coughContexts: CoughContext[]
  appetite: Appetite | null
  energy: Energy | null
  /** 活動內容（用選的），例如 ['散步', '玩耍'] */
  activities: string[]
  /** 其他活動（自己打的文字），例如「上下樓梯」 */
  activityNote: string
  /** 活動後喘多久才恢復（分鐘）；0＝沒有喘；null＝沒填 */
  recoveryMin: number | null
  water: Amount | null
  urine: Amount | null
  note: string
}

// ── 設定 ─────────────────────────────────────────────

export interface Thresholds {
  /** 黃色警示：熟睡呼吸數 ≥ 這個數字 */
  yellowRate: number
  /** 紅色警示：熟睡呼吸數 ≥ 這個數字 */
  redRate: number
  /** 黃色警示：比基準值高出這個百分比以上 */
  baselinePct: number
  /** 基準值取最近幾天 */
  baselineDays: number
  /** 至少要幾筆熟睡紀錄才顯示基準值 */
  baselineMinCount: number
}

export interface PetProfile {
  name: string
  breed: string
  /** YYYY-MM-DD，沒填是空字串 */
  birthday: string
}

export interface Contact {
  name: string
  phone: string
}

export interface Contacts {
  regular: Contact
  emergency: Contact
}

export interface CounterPrefs {
  /** 快速模式要點滿幾次 */
  quickTarget: number
}

/** 體重相關設定（第二階段的體重功能會用到，先預留） */
export interface WeightPrefs {
  baselineKg: number | null
  /** 比基準體重多幾公斤以上要提醒 */
  gainAlertKg: number
}

export interface Settings {
  pet: PetProfile
  thresholds: Thresholds
  contacts: Contacts
  counter: CounterPrefs
  weight: WeightPrefs
}

export type SettingKey = keyof Settings

/** 設定在資料庫裡一個區塊存一列，各自帶 updatedAt，之後同步時可以分區塊比新舊。 */
export interface SettingRow<K extends SettingKey = SettingKey> {
  key: K
  value: Settings[K]
  updatedAt: string
  deviceId: string
}

// ── 以下資料表第一版還沒有畫面，先把格式定好（第二階段：體重、用藥打卡）──

export interface WeightRecord extends SyncFields {
  date: string
  measuredAt: string
  /** 公斤，小數兩位 */
  kg: number
  note: string
}

export interface Medication extends SyncFields {
  name: string
  /** 劑量說明，例如「1 顆」 */
  dose: string
  /** 時段名稱，例如 ['早上', '晚上'] */
  slots: string[]
  active: boolean
  sortOrder: number
}

/** 用藥打卡。id＝`日期|藥物 id|時段`，同一顆藥同一時段只會有一筆。 */
export interface MedLog extends SyncFields {
  date: string
  medicationId: string
  slot: string
  givenAt: string
}

/** 匯出／匯入用的備份檔格式 */
export interface BackupFile {
  app: 'carbon-breath'
  formatVersion: 1
  exportedAt: string
  deviceId: string
  data: {
    breaths: BreathRecord[]
    dailyLogs: DailyLog[]
    settings: SettingRow[]
    weights: WeightRecord[]
    medications: Medication[]
    medLogs: MedLog[]
  }
}
