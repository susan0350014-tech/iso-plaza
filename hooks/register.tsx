// 進入點：掛 hooks、開面板、畫面板
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Camera, Status, World } from '../types'
import { NameTags, ReportCard } from './card'
import { getAssets, resetAssets, type PlazaConfig } from './config'
import { describeTool, entryText, STATUS_LABEL } from './describe'
import { center, layoutOf, walkAt, walkTo, type Layout } from './iso'
import { buildScene, cameraBox } from './scene'
import { EMPTY_WORLD, ensureMain, finishLog, MAIN, patchActor, pushLog, randomWander, setStatus, settle } from './state'

// $.state：資料欄位改了就換 shape 標籤，舊版存的值會被當成初始值
const world = atom({ plugin: 'iso-plaza', key: 'world' } as const, EMPTY_WORLD, { shape: 'world-1' })
const selected = atom({ plugin: 'iso-plaza', key: 'selected' } as const, null as string | null)
/** 鏡頭：預設放大並跟著 Claude（zoom 0 代表還沒套用 config 的 cameraZoom） */
const camera = atom({ plugin: 'iso-plaza', key: 'camera' } as const, { zoom: 0, follow: true, cx: 0, cy: 0 } as Camera, {
  shape: 'camera-1',
})

const ZOOM_MIN = 1
const ZOOM_MAX = 5
const ZOOM_STEP = 1.4
/** 滾輪每一格的縮放倍率 */
const WHEEL_STEP = 1.15

type ViewBox = [number, number, number, number]

/** 感應層回報的廣場大小（格數），滾輪用來判斷是否落在廣場上 */
let stage: { cols: number; rows: number } | undefined
/** 拖曳開始時的畫面，整段拖曳都以它為基準 */
let dragFrom: { id: number; box: ViewBox } | undefined

/** camera 的 zoom 為 0 代表還沒套用 config 的預設倍率 */
function withZoom(c: Camera, config: PlazaConfig): Camera {
  return c.zoom > 0 ? c : { ...c, zoom: config.cameraZoom ?? 2 }
}

/** 改鏡頭：fn 拿到目前鏡頭與「現在畫面上看到的範圍」 */
async function camOp($: EngineInterface, fn: (c: Camera, box: ViewBox, L: Layout, config: PlazaConfig) => Camera) {
  const assets = await getAssets($)
  const now = Date.now()
  const w = ensureMain(await read($, world), assets.config, now)
  const L = layoutOf(assets.config)
  await update($, camera, raw => {
    const c = withZoom(raw, assets.config)
    return fn(c, cameraBox(assets, w, now, c, MAIN), L, assets.config)
  })
}

/** 以畫面上的 (x, y)（0~1）為中心縮放 k 倍，那個點縮放後仍在游標下 */
function zoomAt(c: Camera, b: ViewBox, L: Layout, x: number, y: number, k: number): Camera {
  // 目前實際看到的倍率（跟隨模式走長路時畫面會比設定的更寬）
  const shown = L.width / b[2]
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, shown * k))
  const nw = L.width / zoom
  const nh = nw * (L.height / L.width)
  const px = b[0] + x * b[2]
  const py = b[1] + y * b[3]
  return { ...c, follow: false, zoom, cx: px - x * nw + nw / 2, cy: py - y * nh + nh / 2 }
}

/** 點擊：找最靠近的角色，開關它的回報卡 */
async function clickAt($: EngineInterface, x: number, y: number) {
  const assets = await getAssets($)
  const { config } = assets
  const now = Date.now()
  const w = ensureMain(await read($, world), config, now)
  const b = cameraBox(assets, w, now, withZoom(await read($, camera), config), MAIN)
  const L = layoutOf(config)
  const s = config.characterScale ?? 1
  const px = b[0] + x * b[2]
  const py = b[1] + y * b[3]
  let best: { id: string; d: number } | undefined
  for (const a of Object.values(w.actors)) {
    const [cx, cy] = center(L, walkAt(a.walk, now).pos)
    const d = Math.hypot(px - cx, py - (cy - 28 * s))
    if (d < 38 * s && (!best || d < best.d)) best = { id: a.id, d }
  }
  if (best) {
    const id = best.id
    await update($, selected, cur => (cur === id ? null : id))
  }
}

const PANE = 'iso-plaza'
const TITLE = '小廣場'

/** 讀 config；讀不到時回傳 undefined，hooks 照常放行 */
async function configOf($: EngineInterface): Promise<PlazaConfig | undefined> {
  try {
    return (await getAssets($)).config
  } catch {
    return undefined
  }
}

/** 改世界狀態（主角色一定存在） */
function change($: EngineInterface, config: PlazaConfig, fn: (w: World, now: number) => World) {
  const now = Date.now()
  return update($, world, w => fn(ensureMain(w, config, now), now))
}

// 計時器：重新載入時先停掉舊的
let timers: { cancel: () => void }[] = []

// SVG 快取：狀態沒變就送出同一份字串，動畫不會重播
let lastKey = ''
let lastSvg = ''

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'plaza', description: '打開小廣場面板（/plaza reload 重新讀取素材）' })
    void $.ui.open({ id: PANE, title: TITLE })

    for (const t of timers) t.cancel()
    timers = [
      // 閒置時的散步／休息
      $.clock.every(4000, () => void wander($)),
      // 卡片開著且回合進行中，每秒更新經過時間
      $.clock.every(1000, () => void tickCard($)),
    ]
    return next(e)
  })

  on('command.run', { command: 'plaza' }, async ($, e) => {
    if (String((e as { args?: unknown }).args ?? '').trim() === 'reload') {
      resetAssets()
      lastKey = ''
      $.ui.invalidate('ui.render')
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: '小廣場已打開。' }
  })

  // ── 回合開始／結束 ──
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e) // 子代理：第二階段處理
    const config = await configOf($)
    if (config) {
      await change($, config, (w, now) =>
        patchActor(w, MAIN, a => setStatus(config, { ...a, running: [], turnStartedAt: now, turnEndedAt: undefined }, 'thinking', now)),
      )
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const config = await configOf($)
    if (config) {
      await change($, config, (w, now) =>
        patchActor(w, MAIN, a => setStatus(config, { ...a, running: [], turnEndedAt: now }, 'idle', now)),
      )
    }
    return result
  })

  on('session.stop', async ($, e, next) => {
    const config = await configOf($)
    if (config) {
      await change($, config, (w, now) =>
        patchActor(w, MAIN, a => setStatus(config, { ...a, running: [], turnEndedAt: now }, 'idle', now)),
      )
    }
    return next(e)
  })

  // ── 工具呼叫：開始前換狀態、結束後記結果 ──
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e) // 子代理：第二階段處理
    const config = await configOf($)
    if (!config) return next(e)

    const id = e.tool_use_id
    const status: Status = config.toolStates[e.tool] ?? config.defaultToolState
    const { verb, target } = describeTool(e.tool, e as unknown as Record<string, unknown>)
    await change($, config, (w, now) => {
      const logged = pushLog(w, MAIN, { id, at: now, tool: e.tool, verb, target, state: 'running' })
      return patchActor(logged, MAIN, a => setStatus(config, { ...a, running: [...a.running, { id, status }] }, status, now))
    })

    let isError = true
    try {
      const ran = await next(e)
      isError = (ran as { isError?: boolean }).isError === true
      return ran
    } finally {
      await change($, config, (w, now) =>
        patchActor(finishLog(w, MAIN, id, isError ? 'error' : 'done'), MAIN, a =>
          settle(config, { ...a, running: a.running.filter(r => r.id !== id) }, now),
        ),
      )
    }
  })

  // ── 要你授權時冒「！」（工具結束後會自動回到原本的狀態） ──
  on('classic.PermissionRequest', async ($, e, next) => {
    const config = await configOf($)
    if (config) await change($, config, (w, now) => patchActor(w, MAIN, a => setStatus(config, a, 'waiting', now)))
    return next(e)
  })

  // ── 滑鼠：感應層 post 過來的動作 ──
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || e.element !== 'pointer') return next(e)
    const m = e.data as { kind?: string; [k: string]: unknown }
    const num = (k: string) => (typeof m[k] === 'number' ? (m[k] as number) : 0)
    switch (m.kind) {
      case 'size':
        stage = { cols: num('columns'), rows: num('rows') }
        break
      case 'click':
        await clickAt($, num('x'), num('y'))
        break
      case 'zoom':
        await camOp($, (c, b, L) => zoomAt(c, b, L, num('x'), num('y'), num('k') || 1))
        break
      case 'drag': {
        const id = num('id')
        await camOp($, (c, b, L) => {
          if (!dragFrom || dragFrom.id !== id) dragFrom = { id, box: b }
          const s = dragFrom.box
          // 畫面跟著游標走：游標往右拖，看到的範圍往左移
          const cx = s[0] + s[2] / 2 - (num('x') - num('x0')) * s[2]
          const cy = s[1] + s[3] / 2 - (num('y') - num('y0')) * s[3]
          return { ...c, follow: false, zoom: L.width / s[2], cx, cy }
        })
        break
      }
    }
    return next(e)
  })

  // ── 滑鼠滾輪：在廣場上滾動時縮放，其他地方照常捲動面板 ──
  on('ui.scroll', async ($, e, next) => {
    if (e.component !== 'Pane' || e.requestId !== PANE || e.origin.kind !== 'person' || !e.pointer || !stage) return next(e)
    // pointer.row 不含面板目前捲動的位置，加回來才是內容裡的列
    const row = e.pointer.row + (e.offset - e.by)
    const col = e.pointer.column
    if (row < 0 || row >= stage.rows || col < 0 || col >= stage.cols) return next(e)
    await camOp($, (c, b, L) => zoomAt(c, b, L, (col + 0.5) / stage!.cols, (row + 0.5) / stage!.rows, Math.pow(WHEEL_STEP, -e.by)))
    return {}
  })

  // ── 面板 ──
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els

    let assets
    try {
      assets = await getAssets($)
    } catch (err) {
      return (
        <Box flexDirection="column">
          <Text color="red">讀不到 assets/config.json：{String(err)}</Text>
          <Text dimColor>修好後輸入 /plaza reload</Text>
        </Box>
      )
    }

    const now = Date.now()
    const w = ensureMain(await read($, world), assets.config, now)
    const pick = await read($, selected)
    const actors = Object.values(w.actors)
    const chosen = pick ? w.actors[pick] : undefined

    const cam = withZoom(await read($, camera), assets.config)
    const onPick = (id: string) => void update($, selected, cur => (cur === id ? null : id))
    const onClose = () => void update($, selected, () => null)

    // 按鈕：以畫面中心縮放；跟隨與全景切換
    const zoomBy = (k: number) => () => void camOp($, (c, b, L) => zoomAt(c, b, L, 0.5, 0.5, k))
    const follow = () =>
      void camOp($, (c, _b, _L, config) => ({ ...c, follow: true, zoom: Math.max(c.zoom, config.cameraZoom ?? 2) }))
    const overview = () => void camOp($, c => ({ ...c, follow: false, zoom: 1 }))

    // 只有狀態、走路或鏡頭改變時才重組 SVG
    const key = JSON.stringify([cam, actors.map(a => [a.id, a.status, a.walk, a.look])])
    if (key !== lastKey) {
      lastKey = key
      lastSvg = buildScene(assets, w, now, cam, MAIN)
    }

    // 每個角色一行：狀態＋正在做的事
    const doing = actors.map(a => {
      const cur = [...a.log].reverse().find(l => l.state === 'running')
      return { a, text: cur ? entryText(cur) : '' }
    })

    return (
      <Box flexDirection="column" gap={1}>
        {e.surface !== 'terminal' && 'Svg' in els ? (
          <Box key="stage" flexDirection="column">
            <els.Svg source={lastSvg} alt={actors.map(a => `${a.name}：${STATUS_LABEL[a.status]}`).join('，')} isInteractive />
            {/* 透明感應層：拖曳、點角色、雙擊放大、右鍵縮小（只有桌面版支援） */}
            {e.surface === 'desktop' && 'Client' in els && (
              <Box position="absolute" top={0} left={0} right={0} bottom={0}>
                <els.Client key="pointer" module="./pointer.tsx" width="100%" height="100%" />
              </Box>
            )}
          </Box>
        ) : (
          <Text dimColor>（這個介面不支援圖形，只顯示文字）</Text>
        )}
        {doing.map(({ a, text }) => (
          <Text wrap="truncate-end">
            <Text bold>{a.name}</Text> {STATUS_LABEL[a.status]}
            {text ? <Text dimColor>：{text}</Text> : ''}
          </Text>
        ))}
        {e.surface !== 'terminal' && (
          <Box flexDirection="column">
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              <Button key="cam-in" label="＋" onPress={zoomBy(ZOOM_STEP)} />
              <Button key="cam-out" label="－" onPress={zoomBy(1 / ZOOM_STEP)} />
              <Button key="cam-follow" label={cam.follow ? '● 跟著 Claude' : '○ 跟著 Claude'} onPress={follow} />
              <Button key="cam-all" label="全景" onPress={overview} />
            </Box>
            <Text dimColor>滾輪縮放・拖曳移動・點角色看回報・雙擊放大・右鍵縮小</Text>
          </Box>
        )}
        {NameTags({ els, actors, selected: pick, onPick })}
        {chosen && ReportCard({ els, actor: chosen, now, onClose })}
        {assets.problems.map(p => (
          <Text color="yellow">⚠ {p}</Text>
        ))}
      </Box>
    )
  })
}

/** 閒置時隨機散步，偶爾去休息區坐著 */
async function wander($: EngineInterface) {
  const config = await configOf($)
  if (!config) return
  if (Math.random() < 0.4) return // 有時候多站一下
  await change($, config, (w, now) =>
    patchActor(w, MAIN, a => {
      if (walkAt(a.walk, now).remainingMs > 0) return a
      if (a.status === 'idle') {
        if (Math.random() < config.restChance) return setStatus(config, a, 'resting', now)
        return { ...a, walk: walkTo(config, a.walk, randomWander(config, walkAt(a.walk, now).pos), now) }
      }
      if (a.status === 'resting' && Math.random() < 0.15) return setStatus(config, a, 'idle', now)
      return a
    }),
  )
}

/** 回報卡開著、回合還在跑時，每秒重畫一次（SVG 有快取，不會重播動畫） */
async function tickCard($: EngineInterface) {
  const pick = await read($, selected)
  if (!pick) return
  const a = (await read($, world)).actors[pick]
  if (!a || a.turnStartedAt === undefined || a.turnEndedAt !== undefined) return
  $.ui.invalidate('ui.render')
}
