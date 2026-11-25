// 讀取 assets/config.json 與 sprite 檔，提供給場景繪製使用
import type { EngineInterface } from 'claude-code'

import type { Status, Tile } from '../types'

/** 一段 sprite 動畫：橫向排列的格子，每格 frameWidth x frameHeight */
export type SpriteDef = {
  /** 相對 assets/ 的路徑，例如 characters/claude-idle.svg */
  file: string
  frames?: number
  frameWidth: number
  frameHeight: number
  fps?: number
  /** 錨點：這個點會對齊到格子中心（角色＝腳底，建築＝地面中心） */
  anchor?: [number, number]
}

export type BuildingDef = {
  label: string
  from: Tile
  to: Tile
  height: number
  roofHeight: number
  door: 'left' | 'right'
  wall: string
  wallShade: string
  roof: string
  sprite: SpriteDef | null
}

export type DecorationDef = {
  type: 'fountain' | 'bench' | 'tree' | 'flower'
  tile?: Tile
  from?: Tile
  to?: Tile
  blocking?: boolean
  sprite: SpriteDef | null
}

export type CharacterDef = {
  color: string
  /** 每個狀態一段 sprite；null 代表用內建幾何圖形。另有 walk 代表走路中 */
  states: Partial<Record<Status | 'walk', SpriteDef | null>>
}

export type PlazaConfig = {
  grid: { cols: number; rows: number; tileWidth: number; tileHeight: number }
  walk: { msPerTile: number }
  colors: Record<'background' | 'tileA' | 'tileB' | 'tileLine' | 'groundSide' | 'text' | 'label', string>
  tile: { sprite: SpriteDef | null }
  buildings: Record<string, BuildingDef>
  decorations: DecorationDef[]
  spots: Record<'typing' | 'bashing' | 'reading' | 'resting' | 'start', Tile>
  wanderTiles: Tile[]
  restChance: number
  /** 角色放大倍率（相對場景），預設 1 */
  characterScale?: number
  /** 面板「放大」模式的鏡頭倍率，預設 2 */
  cameraZoom?: number
  toolStates: Record<string, Status>
  defaultToolState: Status
  characters: Record<string, CharacterDef>
}

/** 已載入的素材：config 本體 + 每個 sprite 檔的 SVG 內容 */
export type Assets = {
  config: PlazaConfig
  /** key 是 SpriteDef.file */
  sprites: Record<string, string>
  /** 載入時的問題（找不到檔案等），顯示在面板上 */
  problems: string[]
}

let loading: Promise<Assets> | undefined

/** 取得素材；同一次載入只讀一次檔（mod 重新載入時會重讀） */
export function getAssets($: EngineInterface): Promise<Assets> {
  loading ??= loadAssets($)
  return loading
}

/** 讓下一次 getAssets 重新讀檔（/plaza reload 用） */
export function resetAssets(): void {
  loading = undefined
}

async function loadAssets($: EngineInterface): Promise<Assets> {
  const root = `${$.plugin.root}/assets`
  const text = await $.fs.read(`${root}/config.json`)
  const config = JSON.parse(text) as PlazaConfig
  const problems: string[] = []
  const sprites: Record<string, string> = {}

  for (const def of allSprites(config)) {
    if (sprites[def.file] !== undefined) continue
    try {
      if (!def.file.toLowerCase().endsWith('.svg')) {
        problems.push(`${def.file}：目前只支援 .svg sprite`)
        continue
      }
      sprites[def.file] = await $.fs.read(`${root}/${def.file}`)
    } catch {
      problems.push(`找不到 sprite：assets/${def.file}`)
    }
  }

  return { config, sprites, problems }
}

function allSprites(config: PlazaConfig): SpriteDef[] {
  const list: (SpriteDef | null | undefined)[] = [config.tile.sprite]
  for (const b of Object.values(config.buildings)) list.push(b.sprite)
  for (const d of config.decorations) list.push(d.sprite)
  for (const c of Object.values(config.characters)) list.push(...Object.values(c.states))
  return list.filter((d): d is SpriteDef => !!d && typeof d.file === 'string')
}
