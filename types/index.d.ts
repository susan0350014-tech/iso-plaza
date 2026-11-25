// 廣場 mod 的狀態型別（$.state 的型別契約）

/** 角色狀態：決定走去哪裡、做什麼動作 */
export type Status =
  | 'idle' // 閒置：在廣場散步
  | 'resting' // 休息：去休息區坐著
  | 'thinking' // 回合進行中、兩次工具呼叫之間：原地思考
  | 'typing' // 寫檔／編輯：工作室打字
  | 'reading' // 讀檔／搜尋：圖書館看書
  | 'bashing' // 執行指令：工作室前面敲敲打打
  | 'waiting' // 等你回覆或授權：頭上冒「！」

/** 格子座標 [gx, gy]；走路途中可以是小數 */
export type Tile = [number, number]

/** 一段走路：沿著 path 每格花 msPerTile 毫秒 */
export type Walk = { path: Tile[]; startedAt: number; msPerTile: number }

/** 一筆動作紀錄 */
export type LogEntry = {
  id: string
  at: number
  tool: string
  /** 動詞，例如「編輯」「讀取」 */
  verb: string
  /** 對象，例如「src/main.js」 */
  target: string
  state: 'running' | 'done' | 'error'
}

/** 正在跑的工具呼叫（同時可能有好幾個） */
export type RunningCall = { id: string; status: Status }

export type Actor = {
  id: string
  name: string
  /** config.json 裡 characters 的鍵，決定外觀 */
  look: string
  kind: 'main' | 'sub'
  status: Status
  walk: Walk
  log: LogEntry[]
  running: RunningCall[]
  turnStartedAt?: number
  turnEndedAt?: number
}

export type World = {
  sessionStartedAt: number
  actors: Record<string, Actor>
  /** 整個工作階段的紀錄（第二階段的公告欄會用） */
  sessionLog: (LogEntry & { actor: string })[]
}

/** 鏡頭：zoom 1＝全景；follow＝跟著 Claude；cx/cy＝手動平移時的畫面中心（場景座標） */
export type Camera = { zoom: number; follow: boolean; cx: number; cy: number }

declare module 'claude-code' {
  interface PluginState {
    'iso-plaza': {
      world: Shaped<World>
      selected: string | null
      camera: Shaped<Camera>
    }
  }
}
