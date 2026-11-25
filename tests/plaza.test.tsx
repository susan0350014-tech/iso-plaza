import { expect, test } from 'claude-code/testing'

// 測試環境沒有檔案系統：用一份精簡的 config 與 sprite 代替
const CONFIG = JSON.stringify({
  grid: { cols: 10, rows: 10, tileWidth: 64, tileHeight: 32 },
  walk: { msPerTile: 340 },
  colors: { background: '#FBF4EA', tileA: '#F3E4C9', tileB: '#EBD7B6', tileLine: '#E0C9A3', groundSide: '#D9BE95', text: '#6B4E3D', label: '#FFF' },
  tile: { sprite: null },
  buildings: {
    studio: { label: '工作室', from: [0, 3], to: [1, 5], height: 62, roofHeight: 30, door: 'right', wall: '#F6CDA8', wallShade: '#E8B48A', roof: '#D9876A', sprite: null },
    library: { label: '圖書館', from: [3, 0], to: [5, 1], height: 72, roofHeight: 28, door: 'left', wall: '#CFE3C6', wallShade: '#B3D0A8', roof: '#7FA88A', sprite: null },
  },
  decorations: [
    { type: 'fountain', from: [4, 4], to: [5, 5], blocking: true, sprite: null },
    { type: 'bench', tile: [8, 7], sprite: null },
    { type: 'tree', tile: [9, 8], blocking: true, sprite: null },
  ],
  spots: { typing: [2, 4], bashing: [3, 6], reading: [4, 2], resting: [8, 7], start: [6, 6] },
  wanderTiles: [[3, 3], [7, 3]],
  restChance: 0.3,
  toolStates: { Edit: 'typing', Read: 'reading', Bash: 'bashing' },
  defaultToolState: 'typing',
  characters: {
    claude: {
      color: '#E08A5F',
      states: { idle: { file: 'characters/claude-idle.svg', frames: 2, frameWidth: 48, frameHeight: 64, fps: 2, anchor: [24, 60] } },
    },
  },
})
const SPRITE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64"><circle id="a" cx="24" cy="40" r="10"/></svg>'

const PANE = {
  plugin: 'iso-plaza',
  component: 'Pane',
  requestId: 'iso-plaza',
  props: { title: '小廣場', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('編輯檔案時角色去工作室，點名牌看到回報卡', async ($, on) => {
  on('command.register', () => ({ value: { command: 'plaza' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', (_, e) => ({ value: String((e as { path: string }).path).endsWith('config.json') ? CONFIG : SPRITE }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', () => ({ turnId: 't1' }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\proj\\src\\main.js', old_string: 'a', new_string: 'b' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()

  await ui.press({ key: 'tag-main' })
  const line = await ui.find({ type: 'Text', text: /編輯了 src\/main\.js/ })
  expect(line).toBeDefined()

  // 鏡頭：用感應層的 post 模擬滑鼠
  const viewBox = async () => {
    const v = /viewBox="([^"]+)"/.exec(JSON.stringify(await ui.find({ type: 'Svg' })).replace(/\\"/g, '"'))?.[1]
    return (v ?? '').split(' ').map(Number)
  }
  const start = await viewBox()
  expect(start.length).toBe(4)

  // 雙擊（放大 1.5 倍）→ 看到的範圍變窄
  await ui.post({ kind: 'zoom', x: 0.5, y: 0.5, k: 1.5 }, { in: 'pointer' })
  const zoomed = await viewBox()
  expect(zoomed[2]!).toBeLessThan(start[2]!)

  // 往右拖 → 看到的範圍往左移
  await ui.post({ kind: 'drag', id: 1, x0: 0.5, y0: 0.5, x: 0.7, y: 0.5 }, { in: 'pointer' })
  const dragged = await viewBox()
  expect(dragged[0]!).toBeLessThan(zoomed[0]!)

  // 真的對感應層按一下：模組要能處理，不能出錯
  await ui.pointer({ type: 'down', x: 3, y: 2, button: 'left', in: 'pointer' })
  await ui.pointer({ type: 'up', x: 3, y: 2, button: 'left', in: 'pointer' })
  await ui.unmount()

  // 終端機沒有 Svg，也要能畫
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /不支援圖形/ })).toBeDefined()
  await term.unmount()
})
