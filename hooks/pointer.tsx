// 疊在廣場上的透明感應層（surface module，跑在畫面端，沒有 $）
// 把滑鼠動作換算成 0~1 的相對位置，post 給 hooks 處理：
//   拖曳 → { kind: 'drag' }、點一下 → { kind: 'click' }、
//   雙擊 → { kind: 'zoom', k > 1 }、右鍵 → { kind: 'zoom', k < 1 }、
//   區域大小 → { kind: 'size' }（hooks 用來判斷滾輪是不是落在廣場上）
import type { ClientModule, ClientPointerEvent } from 'claude-code'

type Press = { id: number; x: number; y: number; moved: boolean; button: string }
type Local = { press?: Press; lastClick: number; cols: number; rows: number }

/** 雙擊判定時間（毫秒） */
const DOUBLE_MS = 350

const PointerLayer: ClientModule<null, Local> = (_props, surface) => {
  if (surface.state === undefined) {
    const st: Local = { lastClick: 0, cols: 0, rows: 0 }
    const rel = (e: ClientPointerEvent) => ({
      x: (e.fine?.x ?? e.x + 0.5) / Math.max(1, surface.columns),
      y: (e.fine?.y ?? e.y + 0.5) / Math.max(1, surface.rows),
    })
    surface.onPointer(e => {
      const { x, y } = rel(e)
      if (e.type === 'down') {
        st.press = { id: Date.now(), x, y, moved: false, button: e.button ?? 'left' }
        return
      }
      const p = st.press
      if (!p) return
      if (e.type === 'move') {
        // 移動超過約一格才算拖曳，避免手抖被當成拖曳
        const dc = Math.abs(x - p.x) * surface.columns
        const dr = Math.abs(y - p.y) * surface.rows
        if (dc >= 1 || dr >= 1) p.moved = true
        if (p.moved && p.button === 'left') surface.post({ kind: 'drag', id: p.id, x0: p.x, y0: p.y, x, y })
        return
      }
      if (e.type === 'up') {
        st.press = undefined
        if (p.moved) {
          if (p.button === 'left') surface.post({ kind: 'drag', id: p.id, x0: p.x, y0: p.y, x, y })
          return
        }
        if (p.button === 'right') {
          surface.post({ kind: 'zoom', x, y, k: 1 / 1.5 })
          return
        }
        const now = Date.now()
        if (now - st.lastClick < DOUBLE_MS) {
          st.lastClick = 0
          surface.post({ kind: 'zoom', x, y, k: 1.5 })
        } else {
          st.lastClick = now
          surface.post({ kind: 'click', x, y })
        }
      }
    })
    surface.setState(st)
  }

  // 區域大小改變時告訴 hooks（滾輪縮放需要知道廣場佔幾列）
  const st = surface.state
  if (st && (st.cols !== surface.columns || st.rows !== surface.rows) && surface.columns > 0) {
    st.cols = surface.columns
    st.rows = surface.rows
    surface.post({ kind: 'size', columns: surface.columns, rows: surface.rows })
  }

  return surface.elements.Box({ width: '100%', height: '100%' })
}

export default PointerLayer
