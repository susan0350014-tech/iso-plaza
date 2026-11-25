// 用世界狀態組出整張等角廣場的 SVG 字串
// 內建圖形都是幾何形狀；config.json 指定 sprite 時改用 sprite
import type { Actor, Camera, Status, World } from '../types'
import type { Assets, BuildingDef, DecorationDef, SpriteDef } from './config'
import { STATUS_LABEL } from './describe'
import { center, layoutOf, point, walkAt, type Layout } from './iso'

type Item = { depth: number; svg: string }
type Pt = [number, number]

const FONT = 'system-ui, Microsoft JhengHei, PingFang TC, sans-serif'
const n = (v: number) => Math.round(v * 10) / 10
const pts = (list: Pt[]) => list.map(p => `${n(p[0])},${n(p[1])}`).join(' ')
const up = (p: Pt, h: number): Pt => [p[0], p[1] - h]
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** cam：鏡頭（倍率、是否跟著 focus 角色、手動平移時的中心點） */
export function buildScene(assets: Assets, w: World, now: number, cam: Camera, focus?: string): string {
  const { config } = assets
  const L = layoutOf(config)
  const box = cameraBox(assets, w, now, cam, focus)
  const items: Item[] = []
  let uid = 0
  const sprite = (def: SpriteDef, x: number, y: number) => embedSprite(def, assets.sprites[def.file], x, y, `s${uid++}`)

  for (const b of Object.values(config.buildings)) items.push(building(L, b, sprite))
  for (const d of config.decorations) items.push(decoration(L, d, sprite))
  for (const a of Object.values(w.actors)) items.push(actorItem(L, assets, a, now, sprite))
  items.sort((p, q) => p.depth - q.depth)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.map(n).join(' ')}" width="${L.width * 2}" height="${L.height * 2}" font-family="${FONT}">`,
    `<rect width="${L.width}" height="${L.height}" fill="${config.colors.background}"/>`,
    ground(L, assets, sprite),
    ...items.map(i => i.svg),
    `</svg>`,
  ].join('')
}

// ───────── 鏡頭 ─────────

export type Box = [number, number, number, number]

/** 鏡頭目前看到的範圍 [x, y, 寬, 高]（場景座標） */
export function cameraBox(assets: Assets, w: World, now: number, cam: Camera, focus?: string): Box {
  const L = layoutOf(assets.config)
  if (cam.follow) return followBox(L, w, now, cam.zoom, focus)
  const vw = L.width / Math.max(1, cam.zoom)
  const vh = vw * (L.height / L.width)
  return clampBox(L, cam.cx - vw / 2, cam.cy - vh / 2, vw, vh)
}

/** 不超出場景邊界 */
function clampBox(L: Layout, x: number, y: number, vw: number, vh: number): Box {
  return [Math.min(Math.max(x, 0), L.width - vw), Math.min(Math.max(y, 0), L.height - vh), vw, vh]
}

/**
 * 跟隨模式的可視範圍：框住角色目前位置與目的地（走路途中兩者都看得到），
 * 至少是全景的 1/zoom 大小，比例與全景相同，且不超出場景邊界。
 */
function followBox(L: Layout, w: World, now: number, zoom: number, focus?: string): Box {
  const full: Box = [0, 0, L.width, L.height]
  const actor = focus ? w.actors[focus] : undefined
  if (zoom <= 1 || !actor) return full

  const { pos, rest } = walkAt(actor.walk, now)
  const end = rest[rest.length - 1] ?? pos
  const [ax, ay] = center(L, pos)
  const [bx, by] = center(L, end)
  // 角色往上約 100 單位高（名字、泡泡），上方多留一些
  const minX = Math.min(ax, bx) - 70
  const maxX = Math.max(ax, bx) + 70
  const minY = Math.min(ay, by) - 130
  const maxY = Math.max(ay, by) + 30

  const ratio = L.height / L.width
  const vw = Math.min(L.width, Math.max(L.width / zoom, maxX - minX, (maxY - minY) / ratio))
  const vh = vw * ratio
  return clampBox(L, (minX + maxX) / 2 - vw / 2, (minY + maxY) / 2 - vh / 2, vw, vh)
}

// ───────── 地板 ─────────

function ground(L: Layout, assets: Assets, sprite: (d: SpriteDef, x: number, y: number) => string): string {
  const { config } = assets
  const { cols, rows } = config.grid
  const c = config.colors
  const T = point(L, 0, 0)
  const R = point(L, cols, 0)
  const B = point(L, cols, rows)
  const Lc = point(L, 0, rows)
  const side = 12
  const out = [
    `<polygon points="${pts([Lc, B, [B[0], B[1] + side], [Lc[0], Lc[1] + side]])}" fill="${c.groundSide}"/>`,
    `<polygon points="${pts([B, R, [R[0], R[1] + side], [B[0], B[1] + side]])}" fill="${c.groundSide}" opacity="0.8"/>`,
    `<polygon points="${pts([T, R, B, Lc])}" fill="${c.tileA}"/>`,
  ]
  const tileSprite = config.tile.sprite
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      if (tileSprite) {
        const [cx, cy] = center(L, [x, y])
        out.push(sprite(tileSprite, cx, cy))
        continue
      }
      const fill = (x + y) % 2 === 0 ? c.tileA : c.tileB
      out.push(
        `<polygon points="${pts([point(L, x, y), point(L, x + 1, y), point(L, x + 1, y + 1), point(L, x, y + 1)])}" fill="${fill}" stroke="${c.tileLine}" stroke-width="0.8"/>`,
      )
    }
  }
  return out.join('')
}

// ───────── 建築 ─────────

function building(L: Layout, b: BuildingDef, sprite: (d: SpriteDef, x: number, y: number) => string): Item {
  const depth = b.to[0] + b.to[1]
  const T = point(L, b.from[0], b.from[1])
  const R = point(L, b.to[0] + 1, b.from[1])
  const B = point(L, b.to[0] + 1, b.to[1] + 1)
  const Lc = point(L, b.from[0], b.to[1] + 1)
  const mid: Pt = [(T[0] + B[0]) / 2, (T[1] + B[1]) / 2]

  if (b.sprite) return { depth, svg: sprite(b.sprite, mid[0], mid[1]) + signBoard(b.label, mid[0], mid[1] - b.height - b.roofHeight - 14) }

  const H = b.height
  const apex: Pt = [mid[0], mid[1] - H - b.roofHeight]
  const [uT, uR, uB, uL] = [up(T, H), up(R, H), up(B, H), up(Lc, H)]
  const out = [
    // 牆面：左面亮、右面暗
    `<polygon points="${pts([Lc, B, uB, uL])}" fill="${b.wall}"/>`,
    `<polygon points="${pts([B, R, uR, uB])}" fill="${b.wallShade}"/>`,
    // 屋頂（四面錐）
    `<polygon points="${pts([uT, uR, apex])}" fill="${b.roof}" opacity="0.75"/>`,
    `<polygon points="${pts([uT, uL, apex])}" fill="${b.roof}" opacity="0.85"/>`,
    `<polygon points="${pts([uL, uB, apex])}" fill="${b.roof}"/>`,
    `<polygon points="${pts([uB, uR, apex])}" fill="${b.roof}" opacity="0.9"/>`,
  ]
  // 門開在哪一面，另一面放窗
  const doorFace: [Pt, Pt] = b.door === 'right' ? [B, R] : [Lc, B]
  const winFace: [Pt, Pt] = b.door === 'right' ? [Lc, B] : [B, R]
  out.push(facePatch(doorFace, 0.4, 0.6, 0, 30, '#8C5A43'))
  out.push(facePatch(doorFace, 0.12, 0.28, 30, 46, '#FFF3C4'))
  out.push(facePatch(doorFace, 0.72, 0.88, 30, 46, '#FFF3C4'))
  out.push(facePatch(winFace, 0.2, 0.42, 26, 44, '#FFF3C4'))
  out.push(facePatch(winFace, 0.58, 0.8, 26, 44, '#FFF3C4'))
  out.push(signBoard(b.label, apex[0], apex[1] - 12))
  return { depth, svg: out.join('') }
}

/** 在牆面上畫一塊（門、窗）：t0~t1 是沿著牆的比例，h0~h1 是離地高度 */
function facePatch(face: [Pt, Pt], t0: number, t1: number, h0: number, h1: number, fill: string): string {
  const a = lerp(face[0], face[1], t0)
  const b = lerp(face[0], face[1], t1)
  return `<polygon points="${pts([up(a, h0), up(b, h0), up(b, h1), up(a, h1)])}" fill="${fill}" stroke="#000" stroke-opacity="0.08"/>`
}

function signBoard(label: string, x: number, y: number): string {
  const w = label.length * 12 + 16
  return (
    `<rect x="${n(x - w / 2)}" y="${n(y - 10)}" width="${w}" height="20" rx="10" fill="#FFFFFF" opacity="0.92" stroke="#E7CFAE"/>` +
    `<text x="${n(x)}" y="${n(y + 4)}" text-anchor="middle" font-size="11" font-weight="700" fill="#6B4E3D">${esc(label)}</text>`
  )
}

// ───────── 裝飾 ─────────

function decoration(L: Layout, d: DecorationDef, sprite: (d: SpriteDef, x: number, y: number) => string): Item {
  const from = d.from ?? d.tile ?? [0, 0]
  const to = d.to ?? d.tile ?? from
  const depth = to[0] + to[1]
  const [x, y] = point(L, (from[0] + to[0] + 1) / 2, (from[1] + to[1] + 1) / 2)
  if (d.sprite) return { depth, svg: sprite(d.sprite, x, y) }
  switch (d.type) {
    case 'fountain':
      return { depth, svg: fountain(L, x, y, to[0] - from[0] + 1) }
    case 'bench':
      return { depth: depth - 0.05, svg: bench(x, y) }
    case 'tree':
      return { depth, svg: tree(x, y) }
    case 'flower':
      return { depth, svg: flower(x, y) }
  }
}

function fountain(L: Layout, x: number, y: number, size: number): string {
  const rx = (L.tw / 2) * size * 0.78
  const ry = (L.th / 2) * size * 0.78
  const h = 12
  const drop = (dx: number, delay: number) =>
    `<circle cx="${n(x + dx)}" cy="${n(y - h - 30)}" r="2" fill="#BFE6EF">` +
    `<animate attributeName="cy" values="${n(y - h - 34)};${n(y - h - 4)}" dur="0.9s" begin="${delay}s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="1;0" dur="0.9s" begin="${delay}s" repeatCount="indefinite"/></circle>`
  return [
    `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="#CDB9A0"/>`,
    `<rect x="${n(x - rx)}" y="${n(y - h)}" width="${n(rx * 2)}" height="${h}" fill="#CDB9A0"/>`,
    `<ellipse cx="${n(x)}" cy="${n(y - h)}" rx="${n(rx)}" ry="${n(ry)}" fill="#EADFCF"/>`,
    `<ellipse cx="${n(x)}" cy="${n(y - h)}" rx="${n(rx * 0.82)}" ry="${n(ry * 0.82)}" fill="#9FD3E0"/>`,
    `<ellipse cx="${n(x)}" cy="${n(y - h)}" rx="${n(rx * 0.3)}" ry="${n(ry * 0.3)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.7">` +
      `<animate attributeName="rx" values="${n(rx * 0.2)};${n(rx * 0.75)}" dur="2.4s" repeatCount="indefinite"/>` +
      `<animate attributeName="ry" values="${n(ry * 0.2)};${n(ry * 0.75)}" dur="2.4s" repeatCount="indefinite"/>` +
      `<animate attributeName="stroke-opacity" values="0.8;0" dur="2.4s" repeatCount="indefinite"/></ellipse>`,
    // 中央柱與水柱
    `<rect x="${n(x - 5)}" y="${n(y - h - 22)}" width="10" height="22" rx="3" fill="#EADFCF"/>`,
    `<ellipse cx="${n(x)}" cy="${n(y - h - 22)}" rx="12" ry="5" fill="#9FD3E0"/>`,
    `<rect x="${n(x - 2)}" y="${n(y - h - 44)}" width="4" height="22" rx="2" fill="#BFE6EF">` +
      `<animate attributeName="height" values="20;24;20" dur="1.2s" repeatCount="indefinite"/></rect>`,
    drop(-8, 0),
    drop(7, 0.3),
    drop(-3, 0.6),
  ].join('')
}

function bench(x: number, y: number): string {
  // 沿著畫面左上→右下方向擺的長椅
  return [
    `<polygon points="${pts([[x - 22, y - 8], [x + 2, y - 20], [x + 2, y - 34], [x - 22, y - 22]])}" fill="#B9825F"/>`,
    `<polygon points="${pts([[x - 22, y - 8], [x + 2, y - 20], [x + 14, y - 14], [x - 10, y - 2]])}" fill="#D39B73"/>`,
    `<rect x="${n(x - 10)}" y="${n(y - 3)}" width="3" height="7" fill="#8E5E44"/>`,
    `<rect x="${n(x + 11)}" y="${n(y - 14)}" width="3" height="7" fill="#8E5E44"/>`,
  ].join('')
}

function tree(x: number, y: number): string {
  return [
    `<ellipse cx="${n(x)}" cy="${n(y)}" rx="16" ry="6" fill="#000" opacity="0.1"/>`,
    `<rect x="${n(x - 3)}" y="${n(y - 22)}" width="6" height="22" rx="2" fill="#A3765A"/>`,
    `<g><animateTransform attributeName="transform" type="rotate" values="-1.5 ${n(x)} ${n(y)};1.5 ${n(x)} ${n(y)};-1.5 ${n(x)} ${n(y)}" dur="4s" repeatCount="indefinite"/>`,
    `<circle cx="${n(x - 9)}" cy="${n(y - 30)}" r="12" fill="#8CBF8A"/>`,
    `<circle cx="${n(x + 9)}" cy="${n(y - 32)}" r="12" fill="#86B886"/>`,
    `<circle cx="${n(x)}" cy="${n(y - 44)}" r="13" fill="#9CCB98"/>`,
    `</g>`,
  ].join('')
}

function flower(x: number, y: number): string {
  const dot = (dx: number, dy: number, c: string) => `<circle cx="${n(x + dx)}" cy="${n(y + dy)}" r="3" fill="${c}"/>`
  return [dot(-6, -2, '#F4A9A0'), dot(4, -5, '#F7D06B'), dot(7, 2, '#C8A8E0'), dot(-1, 3, '#F4A9A0')].join('')
}

// ───────── 角色 ─────────

function actorItem(L: Layout, assets: Assets, a: Actor, now: number, sprite: (d: SpriteDef, x: number, y: number) => string): Item {
  const { pos, rest, remainingMs, facing } = walkAt(a.walk, now)
  const ch = assets.config.characters[a.look] ?? Object.values(assets.config.characters)[0]
  const color = ch?.color ?? '#E08A5F'
  const states = ch?.states ?? {}
  const isWalking = remainingMs > 0 && rest.length > 1
  const ms = Math.round(remainingMs)

  const look = (st: Status | 'walk') => {
    const def = states[st]
    const inner = def ? sprite(def, 0, 0) : builtinLook(st, color, assets.config.walk.msPerTile)
    return facing < 0 ? `<g transform="scale(-1 1)">${inner}</g>` : inner
  }

  const parts: string[] = [`<title>${esc(a.name)}：${STATUS_LABEL[a.status]}</title>`]
  if (isWalking) {
    // 走路中顯示 walk 外觀，抵達後換成狀態外觀
    parts.push(`<g>${look('walk')}<set attributeName="visibility" to="hidden" begin="${ms}ms"/></g>`)
    parts.push(`<g visibility="hidden">${look(a.status)}<set attributeName="visibility" to="visible" begin="${ms}ms"/></g>`)
  } else {
    parts.push(look(a.status))
  }
  parts.push(
    `<text x="0" y="-64" text-anchor="middle" font-size="11" font-weight="700" fill="#6B4E3D" stroke="#FFFFFF" stroke-width="3" paint-order="stroke">${esc(a.name)}</text>`,
  )

  const [sx, sy] = center(L, isWalking ? rest[0]! : pos)
  let motion = ''
  if (isWalking) {
    const path = rest.map(t => center(L, t))
    const d = path.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p[0] - sx)} ${n(p[1] - sy)}`).join(' ')
    motion = `<animateMotion path="${d}" dur="${ms}ms" fill="freeze" calcMode="linear"/>`
  }
  // 深度用目前位置；終點較前面時以終點為準，避免走到建築前還被蓋住
  const end = rest[rest.length - 1] ?? pos
  const depth = Math.max(pos[0] + pos[1], isWalking ? end[0] + end[1] - 0.5 : -1) + 0.1
  return {
    depth,
    // characterScale：角色相對場景的大小（config.json）
    svg: `<g transform="translate(${n(sx)} ${n(sy)})"><g>${motion}<g transform="scale(${assets.config.characterScale ?? 1})">${parts.join('')}</g></g></g>`,
  }
}

/** 內建幾何角色：以腳底 (0,0) 為原點 */
function builtinLook(st: Status | 'walk', color: string, msPerTile: number): string {
  switch (st) {
    case 'walk':
      return bob(body(color, {}), 3, `${msPerTile}ms`)
    case 'idle':
      return bob(body(color, {}), 1.5, '1.6s')
    case 'thinking':
      return bob(body(color, { eyes: 'up' }), 1, '2s') + bubble('…', '#8C7BB0', true)
    case 'waiting':
      return bob(body(color, {}) + bubble('!', '#E4572E', false), 5, '0.7s')
    case 'resting':
      return body(color, { sit: true, eyes: 'closed' }) + zzz()
    case 'typing':
      return typing(color)
    case 'reading':
      return reading(color)
    case 'bashing':
      return bashing(color)
  }
}

function body(color: string, o: { sit?: boolean; eyes?: 'open' | 'closed' | 'down' | 'up' }): string {
  const hy = o.sit ? -27 : -35
  const ty = o.sit ? -11 : -15
  const tr = o.sit ? 10 : 13
  const eyes = o.eyes ?? 'open'
  const ey = hy + (eyes === 'down' ? 2 : eyes === 'up' ? -2 : 0)
  const eye =
    eyes === 'closed'
      ? `<path d="M-5 ${ey} h3 M3 ${ey} h3" stroke="#5A3E33" stroke-width="1.6" stroke-linecap="round"/>`
      : `<circle cx="-2.5" cy="${ey}" r="1.6" fill="#5A3E33"/><circle cx="4.5" cy="${ey}" r="1.6" fill="#5A3E33"/>`
  return [
    `<ellipse cx="0" cy="0" rx="12" ry="4.5" fill="#000" opacity="0.12"/>`,
    `<ellipse cx="0" cy="${ty}" rx="11" ry="${tr}" fill="${color}"/>`,
    `<circle cx="0" cy="${hy}" r="10" fill="#FBE3CF"/>`,
    `<path d="M0 ${hy - 10} L2 ${hy - 14} L4 ${hy - 9}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`,
    eye,
    `<ellipse cx="-6" cy="${hy + 4}" rx="2.2" ry="1.3" fill="#F4A9A0" opacity="0.8"/>`,
    `<ellipse cx="7" cy="${hy + 4}" rx="2.2" ry="1.3" fill="#F4A9A0" opacity="0.8"/>`,
  ].join('')
}

function bob(inner: string, height: number, dur: string): string {
  return `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${-height};0 0" dur="${dur}" repeatCount="indefinite"/>${inner}</g>`
}

function bubble(mark: string, color: string, dots: boolean): string {
  const text = dots
    ? [0, 1, 2]
        .map(
          i =>
            `<circle cx="${-6 + i * 6}" cy="-86" r="2" fill="${color}"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" begin="${i * 0.2}s" repeatCount="indefinite"/></circle>`,
        )
        .join('')
    : `<text x="0" y="-80" text-anchor="middle" font-size="17" font-weight="900" fill="${color}">${mark}</text>`
  return (
    `<rect x="-12" y="-98" width="24" height="23" rx="9" fill="#FFFFFF" stroke="${color}" stroke-width="1.5"/>` +
    `<path d="M-4 -75.5 L0 -70 L4 -75.5" fill="#FFFFFF" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<rect x="-3.5" y="-77" width="7" height="2.5" fill="#FFFFFF"/>` +
    text
  )
}

function zzz(): string {
  const z = (dx: number, delay: number, size: number) =>
    `<text x="${dx}" y="-44" font-size="${size}" font-weight="700" fill="#8C7BB0" opacity="0">z` +
    `<animate attributeName="y" values="-44;-70" dur="2.4s" begin="${delay}s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="${delay}s" repeatCount="indefinite"/></text>`
  return z(8, 0, 10) + z(13, 0.8, 12) + z(18, 1.6, 14)
}

function hand(x: number, y: number, color: string, anim = ''): string {
  return `<circle cx="${x}" cy="${y}" r="3.2" fill="${color}" stroke="#000" stroke-opacity="0.12">${anim}</circle>`
}

function typing(color: string): string {
  const tap = (y: number, delay: number) =>
    `<animate attributeName="cy" values="${y};${y - 3};${y}" dur="0.26s" begin="${delay}s" repeatCount="indefinite"/>`
  return [
    body(color, { eyes: 'down' }),
    // 筆電
    `<polygon points="2,-5 16,-12 26,-7 12,0" fill="#8FA3B8"/>`,
    `<polygon points="16,-12 16,-28 26,-23 26,-7" fill="#B8C7D6"/>`,
    `<polygon points="17.5,-13 17.5,-26 24.5,-22.5 24.5,-9.5" fill="#E6F2FA"><animate attributeName="opacity" values="0.7;1;0.7" dur="1.5s" repeatCount="indefinite"/></polygon>`,
    hand(7, -8, color, tap(-8, 0)),
    hand(13, -10, color, tap(-10, 0.13)),
  ].join('')
}

function reading(color: string): string {
  return [
    body(color, { eyes: 'down' }),
    `<g transform="translate(5 -17)">`,
    `<path d="M-10 2 L0 6 L10 2" fill="none" stroke="#8C6BB1" stroke-width="2.5" stroke-linecap="round"/>`,
    `<path d="M-9 1 L0 4.5 L0 -9 L-9 -12.5 Z" fill="#FFF8EC" stroke="#C9A27E" stroke-width="0.8"/>`,
    `<path d="M0 4.5 L9 1 L9 -12.5 L0 -9 Z" fill="#FFF8EC" stroke="#C9A27E" stroke-width="0.8"/>`,
    // 翻頁
    `<g><animateTransform attributeName="transform" type="scale" values="1 1;1 1;-1 1;-1 1" keyTimes="0;0.7;0.85;1" dur="3s" repeatCount="indefinite"/>`,
    `<path d="M0 4.5 L8 1.5 L8 -12 L0 -9 Z" fill="#FFFDF7" stroke="#C9A27E" stroke-width="0.6"/></g>`,
    `</g>`,
    hand(-4, -12, color),
    hand(14, -14, color),
  ].join('')
}

function bashing(color: string): string {
  return [
    // 小鐵砧
    `<polygon points="12,-4 22,-9 30,-5 20,0" fill="#A9B4C0"/>`,
    `<polygon points="12,-4 20,0 20,4 12,0" fill="#8D99A6"/>`,
    `<polygon points="20,0 30,-5 30,-1 20,4" fill="#7C8794"/>`,
    bob(body(color, { eyes: 'down' }), 1.5, '0.45s'),
    // 槌子
    `<g transform="translate(9 -17)"><g>`,
    `<animateTransform attributeName="transform" type="rotate" values="-70;25;-70" keyTimes="0;0.35;1" dur="0.45s" repeatCount="indefinite"/>`,
    `<rect x="-1.5" y="-17" width="3" height="17" rx="1" fill="#9C6B4E"/>`,
    `<rect x="-6" y="-22" width="12" height="7" rx="1.5" fill="#7D8794"/>`,
    hand(0, 0, color),
    `</g></g>`,
    // 火花
    `<g opacity="0"><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.3;0.4;1" dur="0.45s" repeatCount="indefinite"/>`,
    `<path d="M22 -14 l2 -4 M26 -12 l4 -2 M19 -13 l-2 -4" stroke="#F7C35C" stroke-width="1.8" stroke-linecap="round"/></g>`,
  ].join('')
}

// ───────── sprite ─────────

/** 把 sprite sheet 嵌進場景：錨點對齊 (x,y)，多格時用 viewBox 逐格切換 */
export function embedSprite(def: SpriteDef, source: string | undefined, x: number, y: number, uid: string): string {
  if (!source) return ''
  const fw = def.frameWidth
  const fh = def.frameHeight
  const frames = Math.max(1, def.frames ?? 1)
  const [ax, ay] = def.anchor ?? [fw / 2, fh]
  const vb = (i: number) => `${i * fw} 0 ${fw} ${fh}`
  const anim =
    frames > 1
      ? `<animate attributeName="viewBox" values="${Array.from({ length: frames }, (_, i) => vb(i)).join(';')}" dur="${n(frames / (def.fps ?? 6))}s" calcMode="discrete" repeatCount="indefinite"/>`
      : ''
  return `<svg x="${n(x - ax)}" y="${n(y - ay)}" width="${fw}" height="${fh}" viewBox="${vb(0)}" overflow="hidden">${anim}${innerOf(source, uid)}</svg>`
}

/** 取出 <svg> 內層內容，拿掉註解，並幫 id 加前綴避免多張 sprite 互撞 */
function innerOf(source: string, uid: string): string {
  const m = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/i.exec(source.trim())
  const inner = (m?.[1] ?? '').replace(/<!--[\s\S]*?-->/g, '')
  return inner
    .replace(/\bid="([^"]+)"/g, `id="${uid}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${uid}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${uid}-$1"`)
}
