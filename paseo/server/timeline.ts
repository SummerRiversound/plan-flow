import type { AgentTimelineItem, ToolCallDetail } from '@getpaseo/protocol/agent-types'
import { type Happened, toolLine } from '../shared/planner'

type ToolCall = Extract<AgentTimelineItem, { type: 'tool_call' }>

// Calls that say nothing of the work, as the mod skips them.
const SKIPPED: ReadonlySet<string> = new Set(['ToolSearch', 'AskUserQuestion'])

// The input the mod's toolLine reads, rebuilt from the detail Paseo keeps of a call.
const inputOf = (d: ToolCallDetail): Record<string, unknown> => {
  switch (d.type) {
    case 'shell':
      return { command: d.command }
    case 'read':
    case 'edit':
    case 'write':
      return { file_path: d.filePath }
    case 'search':
      return { pattern: d.query }
    case 'sub_agent':
      return { description: d.description ?? '' }
    case 'plain_text':
      return { description: d.label ?? d.text ?? '' }
    case 'unknown':
      return typeof d.input === 'object' && d.input !== null ? (d.input as Record<string, unknown>) : {}
    default:
      return {}
  }
}

// What a call gave back, where it says how the work went: a command's last words (a test count, a
// pull request's address), a connected tool's or a subagent's first. File contents say nothing of it.
const resultOf = (d: ToolCallDetail): string => {
  const text = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v)).replace(/\s+/g, ' ').trim()
  switch (d.type) {
    case 'shell':
      return text(d.output).slice(-MAX_RESULT)
    case 'sub_agent':
      return text(d.log).slice(0, MAX_RESULT)
    case 'fetch':
      return text(d.result).slice(0, MAX_RESULT)
    case 'unknown':
      return text(d.output).slice(0, MAX_RESULT)
    default:
      return ''
  }
}
const MAX_RESULT = 160

const callLine = (c: ToolCall, results: boolean): Happened | null => {
  if (c.status === 'running' || c.status === 'canceled' || SKIPPED.has(c.name)) return null
  // A prompt from another agent or a task's notice is news, not a request: no person typed it.
  if (c.agentMessage !== undefined) return { kind: 'notice', text: c.agentMessage.text ?? '' }
  if (c.detail.type === 'plain_text' && c.metadata?.synthetic === true) return { kind: 'notice', text: c.detail.label ?? c.detail.text ?? '' }
  const line = toolLine(c.detail.type === 'shell' ? 'Bash' : c.name, inputOf(c.detail))
  const marked = c.status === 'failed' ? `${line} (failed)` : line
  const got = results ? resultOf(c.detail) : ''

  return { kind: 'tool', text: got === '' ? marked : `${marked} → ${got}` }
}

// One turn of a Paseo agent's timeline as what the planner hears: the person's request, each finished
// call, what Claude said between calls, and its answer (the words after the last call).
// `results`: each call also carries the start of what it gave back, for a design that reads no conversation.
export const happenedFrom = (items: readonly AgentTimelineItem[], results = false): Happened[] => {
  const lastCall = items.findLastIndex(i => i.type === 'tool_call')
  const out: Happened[] = []
  items.forEach((item, i) => {
    if (item.type === 'user_message') out.push({ kind: 'request', text: item.text })
    else if (item.type === 'assistant_message' && item.text.trim() !== '') out.push({ kind: i > lastCall ? 'answer' : 'said', text: item.text })
    else if (item.type === 'tool_call') {
      const h = callLine(item, results)
      if (h !== null) out.push(h)
    }
  })

  return out
}
