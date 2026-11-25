// 廣場的狀態（存在 $.state）與狀態轉換
import type { Actor, LogEntry, Status, Tile, World } from '../types'
import type { PlazaConfig } from './config'
import { walkAt, walkTo } from './iso'

export const MAIN = 'main'
/** 每個角色卡片保留的動作數 */
export const ACTOR_LOG = 10
/** 整個工作階段保留的動作數 */
export const SESSION_LOG = 500

/** 空的世界（$.state 的初始值；atom 定義在 register.tsx） */
export const EMPTY_WORLD: World = { sessionStartedAt: 0, actors: {}, sessionLog: [] }

export function makeActor(config: PlazaConfig, id: string, name: string, look: string, kind: Actor['kind'], now: number): Actor {
  const start = config.spots.start
  return {
    id,
    name,
    look,
    kind,
    status: 'idle',
    walk: { path: [start], startedAt: now, msPerTile: config.walk.msPerTile },
    log: [],
    running: [],
  }
}

/** 主角色一定存在 */
export function ensureMain(w: World, config: PlazaConfig, now: number): World {
  if (w.actors[MAIN]) return w
  return {
    ...w,
    sessionStartedAt: w.sessionStartedAt || now,
    actors: { ...w.actors, [MAIN]: makeActor(config, MAIN, 'Claude', 'claude', 'main', now) },
  }
}

/** 每個狀態要去的格子；undefined 代表原地 */
function targetOf(config: PlazaConfig, status: Status, actor: Actor, now: number): Tile | undefined {
  switch (status) {
    case 'typing':
    case 'bashing':
    case 'reading':
    case 'resting':
      return config.spots[status]
    case 'idle':
      return randomWander(config, walkAt(actor.walk, now).pos)
    default:
      return undefined
  }
}

export function randomWander(config: PlazaConfig, from: Tile): Tile {
  const options = config.wanderTiles.filter(t => Math.round(from[0]) !== t[0] || Math.round(from[1]) !== t[1])
  return options[Math.floor(Math.random() * options.length)] ?? config.spots.start
}

/** 換狀態：狀態有變才重新規劃走路 */
export function setStatus(config: PlazaConfig, actor: Actor, status: Status, now: number): Actor {
  if (actor.status === status) return actor
  const target = targetOf(config, status, actor, now)
  const walk = target ? walkTo(config, actor.walk, target, now) : freeze(actor, now)
  return { ...actor, status, walk }
}

/** 原地停下（把走到一半的位置固定下來） */
function freeze(actor: Actor, now: number): Actor['walk'] {
  const { pos, remainingMs } = walkAt(actor.walk, now)
  if (remainingMs === 0) return actor.walk
  return { path: [pos], startedAt: now, msPerTile: actor.walk.msPerTile }
}

/** 依目前還在跑的工具決定狀態；沒有就回到「思考」 */
export function settle(config: PlazaConfig, actor: Actor, now: number): Actor {
  const latest = actor.running[actor.running.length - 1]
  return setStatus(config, actor, latest ? latest.status : 'thinking', now)
}

/** 加一筆紀錄（角色卡片與整段工作階段都記） */
export function pushLog(w: World, actorId: string, entry: LogEntry): World {
  const actor = w.actors[actorId]
  if (!actor) return w
  return {
    ...w,
    actors: { ...w.actors, [actorId]: { ...actor, log: [...actor.log, entry].slice(-ACTOR_LOG) } },
    sessionLog: [...w.sessionLog, { ...entry, actor: actorId }].slice(-SESSION_LOG),
  }
}

/** 更新某筆紀錄的結果 */
export function finishLog(w: World, actorId: string, id: string, state: LogEntry['state']): World {
  const actor = w.actors[actorId]
  if (!actor) return w
  const mark = <T extends LogEntry>(list: T[]) => list.map(one => (one.id === id ? { ...one, state } : one))
  return {
    ...w,
    actors: { ...w.actors, [actorId]: { ...actor, log: mark(actor.log) } },
    sessionLog: mark(w.sessionLog),
  }
}

/** 改一個角色 */
export function patchActor(w: World, actorId: string, fn: (a: Actor) => Actor): World {
  const actor = w.actors[actorId]
  if (!actor) return w
  return { ...w, actors: { ...w.actors, [actorId]: fn(actor) } }
}
