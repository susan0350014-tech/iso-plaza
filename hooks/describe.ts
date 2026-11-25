// 把工具呼叫翻成「動詞 + 對象」的簡短說明
import type { Status } from '../types'

type Described = { verb: string; target: string }

/** 路徑只留最後兩段，例如 C:\a\b\src\main.js → src/main.js */
function shortPath(p: unknown): string {
  if (typeof p !== 'string' || p === '') return ''
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join('/')
}

function cut(s: unknown, n = 40): string {
  if (typeof s !== 'string') return ''
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

function hostOf(u: unknown): string {
  try {
    return new URL(String(u)).host
  } catch {
    return cut(u)
  }
}

export function describeTool(tool: string, input: Record<string, unknown>): Described {
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
      return { verb: '編輯', target: shortPath(input.file_path) }
    case 'Write':
      return { verb: '寫入', target: shortPath(input.file_path) }
    case 'NotebookEdit':
      return { verb: '編輯', target: shortPath(input.notebook_path) }
    case 'Read':
      return { verb: '讀取', target: shortPath(input.file_path) }
    case 'Grep':
      return { verb: '搜尋', target: `「${cut(input.pattern, 30)}」` }
    case 'Glob':
      return { verb: '找檔案', target: cut(input.pattern, 30) }
    case 'Bash':
    case 'PowerShell':
      return { verb: '執行', target: cut(input.description) || cut(input.command) }
    case 'WebFetch':
      return { verb: '讀網頁', target: hostOf(input.url) }
    case 'WebSearch':
      return { verb: '上網搜尋', target: `「${cut(input.query, 30)}」` }
    case 'Agent':
    case 'Task':
      return { verb: '派出子代理', target: cut(input.description) }
    case 'AskUserQuestion':
      return { verb: '向你提問', target: '' }
    case 'ExitPlanMode':
      return { verb: '請你確認計畫', target: '' }
    default:
      return { verb: '使用', target: tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' / ') : tool }
  }
}

/** 一筆紀錄的顯示文字：進行中「正在編輯 X」、完成「編輯了 X」 */
export function entryText(e: { verb: string; target: string; state: 'running' | 'done' | 'error' }): string {
  const t = e.target ? ` ${e.target}` : ''
  if (e.state === 'running') return `正在${e.verb}${t}`
  if (e.state === 'error') return `${e.verb}${t}（失敗）`
  return `${e.verb}了${t}`
}

export const STATUS_LABEL: Record<Status, string> = {
  idle: '散步中',
  resting: '休息中',
  thinking: '思考中',
  typing: '在工作室打字',
  reading: '在圖書館看書',
  bashing: '在工作室前敲敲打打',
  waiting: '等你回覆',
}
