// 角色回報卡與名牌按鈕（用面板的 Box/Text/Button 組成，不畫在 SVG 裡）
import type { ElementTable } from 'claude-code'

import type { Actor, LogEntry } from '../types'
import { entryText, STATUS_LABEL } from './describe'

const pad = (v: number) => String(v).padStart(2, '0')

export function clock(at: number): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h} 小時 ${m % 60} 分`
  if (m > 0) return `${m} 分 ${s % 60} 秒`
  return `${s} 秒`
}

/** 回合時間：進行中顯示「已進行」，結束後顯示「上回合花了」 */
export function turnLine(a: Actor, now: number): string {
  if (a.turnStartedAt === undefined) return '還沒開始工作'
  if (a.turnEndedAt !== undefined && a.turnEndedAt >= a.turnStartedAt) {
    return `上個回合花了 ${duration(a.turnEndedAt - a.turnStartedAt)}`
  }
  return `本回合已進行 ${duration(now - a.turnStartedAt)}`
}

const mark = (e: LogEntry) => (e.state === 'running' ? '…' : e.state === 'error' ? '✗' : '✓')

export function NameTags(props: { els: ElementTable; actors: Actor[]; selected: string | null; onPick: (id: string) => void }) {
  const { Box, Button, Text } = props.els
  return (
    <Box flexDirection="row" flexWrap="wrap" gap={1}>
      {props.actors.map(a => (
        <Button key={`tag-${a.id}`} onPress={() => props.onPick(a.id)}>
          {props.selected === a.id ? '▾ ' : '▸ '}
          {a.name} <Text dimColor>{STATUS_LABEL[a.status]}</Text>
        </Button>
      ))}
    </Box>
  )
}

export function ReportCard(props: { els: ElementTable; actor: Actor; now: number; onClose: () => void }) {
  const { Box, Button, Text } = props.els
  const a = props.actor
  const recent = [...a.log].reverse()
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#E0B48A" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>
          {a.name}・{STATUS_LABEL[a.status]}
        </Text>
        <Button key={`close-${a.id}`} label="關閉" onPress={props.onClose} />
      </Box>
      <Text dimColor>{turnLine(a, props.now)}</Text>
      <Text bold>最近動作</Text>
      {recent.length === 0 && <Text dimColor>還沒有動作</Text>}
      {recent.map(e => (
        <Text wrap="truncate-end">
          <Text dimColor>{clock(e.at)}</Text> {mark(e)} <Text color="#C26A43">{e.tool}</Text> {entryText(e)}
        </Text>
      ))}
    </Box>
  )
}
