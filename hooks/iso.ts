// 等角座標換算、格子尋路、走路進度計算
import type { Tile, Walk } from '../types'
import type { PlazaConfig } from './config'

/** 場景外框留白（SVG 座標單位） */
const PAD_X = 24
const PAD_TOP = 130
const PAD_BOTTOM = 28

export type Layout = {
  tw: number
  th: number
  ox: number
  oy: number
  width: number
  height: number
}

export function layoutOf(config: PlazaConfig): Layout {
  const { cols, rows, tileWidth: tw, tileHeight: th } = config.grid
  return {
    tw,
    th,
    ox: PAD_X + (rows * tw) / 2,
    oy: PAD_TOP,
    width: PAD_X * 2 + ((cols + rows) * tw) / 2,
    height: PAD_TOP + PAD_BOTTOM + ((cols + rows) * th) / 2,
  }
}

/** 格子座標（格線交點）→ 畫面座標 */
export function point(L: Layout, a: number, b: number): [number, number] {
  return [L.ox + ((a - b) * L.tw) / 2, L.oy + ((a + b) * L.th) / 2]
}

/** 格子中心 → 畫面座標 */
export function center(L: Layout, t: Tile): [number, number] {
  return point(L, t[0] + 0.5, t[1] + 0.5)
}

const key = (t: Tile) => `${t[0]},${t[1]}`

/** 不能走的格子：建築、擋路的裝飾 */
export function blockedTiles(config: PlazaConfig): Set<string> {
  const set = new Set<string>()
  const fill = (from: Tile, to: Tile) => {
    for (let x = from[0]; x <= to[0]; x++) for (let y = from[1]; y <= to[1]; y++) set.add(key([x, y]))
  }
  for (const b of Object.values(config.buildings)) fill(b.from, b.to)
  for (const d of config.decorations) {
    if (!d.blocking) continue
    if (d.from && d.to) fill(d.from, d.to)
    else if (d.tile) fill(d.tile, d.tile)
  }
  return set
}

/** 廣度優先尋路（上下左右四方向），回傳含起點與終點的格子列表 */
export function findPath(config: PlazaConfig, from: Tile, to: Tile): Tile[] {
  const { cols, rows } = config.grid
  const blocked = blockedTiles(config)
  const start: Tile = [Math.round(from[0]), Math.round(from[1])]
  if (start[0] === to[0] && start[1] === to[1]) return [start]

  const prev = new Map<string, Tile | null>([[key(start), null]])
  const queue: Tile[] = [start]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur[0] === to[0] && cur[1] === to[1]) break
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next: Tile = [cur[0] + dx, cur[1] + dy]
      const k = key(next)
      if (next[0] < 0 || next[1] < 0 || next[0] >= cols || next[1] >= rows) continue
      if (prev.has(k)) continue
      // 終點本身就算被擋（例如坐在長椅上）也允許抵達
      if (blocked.has(k) && !(next[0] === to[0] && next[1] === to[1])) continue
      prev.set(k, cur)
      queue.push(next)
    }
  }
  if (!prev.has(key(to))) return [start] // 走不到就原地不動

  const path: Tile[] = []
  for (let t: Tile | null | undefined = to; t; t = prev.get(key(t))) path.unshift(t)
  return path
}

/** 某個時間點的走路進度：目前位置、剩下的路、剩下的時間 */
export function walkAt(walk: Walk, now: number): { pos: Tile; rest: Tile[]; remainingMs: number; facing: 1 | -1 } {
  const { path, startedAt, msPerTile } = walk
  const last = path[path.length - 1] ?? [0, 0]
  const steps = path.length - 1
  const done = Math.max(0, (now - startedAt) / msPerTile)
  if (steps <= 0 || done >= steps) {
    return { pos: last, rest: [], remainingMs: 0, facing: facingOf(path) }
  }
  const i = Math.floor(done)
  const f = done - i
  const a = path[i]!
  const b = path[i + 1]!
  const pos: Tile = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
  return { pos, rest: [pos, ...path.slice(i + 1)], remainingMs: (steps - done) * msPerTile, facing: facingOf(path) }
}

/** 角色朝向：看最後一步在畫面上往左還是往右 */
function facingOf(path: Tile[]): 1 | -1 {
  const n = path.length
  if (n < 2) return 1
  const a = path[n - 2]!
  const b = path[n - 1]!
  const dx = b[0] - a[0] - (b[1] - a[1])
  return dx < 0 ? -1 : 1
}

/** 從目前位置開始走到 target */
export function walkTo(config: PlazaConfig, current: Walk, target: Tile, now: number): Walk {
  const { pos } = walkAt(current, now)
  const path = findPath(config, pos, target)
  // 起點用目前的精確位置，避免四捨五入造成的小跳動
  if (path.length > 1) path[0] = pos
  return { path, startedAt: now, msPerTile: config.walk.msPerTile }
}
