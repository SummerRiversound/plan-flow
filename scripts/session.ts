// A session's transcript read back as what the side planner hears: requests, notices, tool calls
// (failed ones marked), what Claude says between calls and its answers, each with its time.
import type { Happened } from '../hooks/planner'
import { GUARDED, noticeLine, toolLine } from '../hooks/planner'

export type Heard = Happened & { at: number; guarded?: boolean }

type Block = { type?: string; text?: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; is_error?: boolean }
type Entry = { type?: string; isMeta?: boolean; isSidechain?: boolean; timestamp?: string; message?: { id?: string; content?: string | Block[] } }

// Calls the mod does not pass on to the planner.
const UNHEARD: ReadonlySet<string> = new Set(['AskUserQuestion', 'ToolSearch'])

const parse = (jsonl: string): Entry[] =>
  jsonl
    .split('\n')
    .filter(l => l.trim() !== '')
    .flatMap((l): Entry[] => {
      try {
        return [JSON.parse(l) as Entry]
      } catch {
        return []
      }
    })

const failedIn = (entries: readonly Entry[]): Set<string> => {
  const failed = new Set<string>()
  for (const e of entries) {
    const content = e.message?.content
    if (Array.isArray(content)) for (const b of content) if (b.type === 'tool_result' && b.is_error === true && b.tool_use_id !== undefined) failed.add(b.tool_use_id)
  }

  return failed
}

// A subagent's own transcript (<session>/subagents/agent-*.jsonl) as the calls the mod hears from it:
// marked as a subagent's, and counted towards the next look as the mod counts them.
const subagentCalls = (jsonl: string): Heard[] => {
  const entries = parse(jsonl)
  const failed = failedIn(entries)

  return entries.flatMap(e =>
    e.type !== 'assistant' || !Array.isArray(e.message?.content)
      ? []
      : e.message.content
          .filter(b => b.type === 'tool_use' && b.name !== undefined && !UNHEARD.has(b.name))
          .map((b): Heard => {
            const line = toolLine(b.name ?? '', b.input ?? {})
            return { kind: 'subagent', text: failed.has(b.id ?? '') ? `${line} (failed)` : line, at: Date.parse(e.timestamp ?? '') || 0, guarded: GUARDED.has(b.name ?? '') }
          }),
  )
}

export const heard = (jsonl: string, subagents: readonly string[] = []): Heard[] => {
  const entries = parse(jsonl).filter(e => e.isMeta !== true && e.isSidechain !== true)
  const failed = failedIn(entries)
  const calling = new Set<string>()
  for (const e of entries) {
    const content = e.message?.content
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (e.type === 'assistant' && b.type === 'tool_use' && e.message?.id !== undefined) calling.add(e.message.id)
    }
  }
  const out: Heard[] = []
  for (const e of entries) {
    const at = Date.parse(e.timestamp ?? '') || 0
    const content = e.message?.content
    // A prompt is a string, or text blocks beside pasted images; tool results come back as user entries too.
    const prompt = typeof content === 'string' ? content : (content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
    if (e.type === 'user' && prompt.trim() !== '') {
      if (prompt.startsWith('<command-') || prompt.startsWith('<local-command') || prompt.startsWith('[Request interrupted')) continue
      out.push(prompt.includes('<task-notification>') ? { kind: 'notice', text: noticeLine(prompt), at } : { kind: 'request', text: prompt, at })
      continue
    }
    if (e.type !== 'assistant' || !Array.isArray(content)) continue
    for (const b of content) {
      if (b.type === 'tool_use' && b.name !== undefined && !UNHEARD.has(b.name)) {
        const line = toolLine(b.name, b.input ?? {})
        out.push({ kind: 'tool', text: failed.has(b.id ?? '') ? `${line} (failed)` : line, at, guarded: GUARDED.has(b.name) })
      }
      // Text in a reply that also calls a tool is said along the way; a reply of text alone is the answer.
      if (b.type === 'text' && (b.text ?? '').trim() !== '') out.push({ kind: calling.has(e.message?.id ?? '') ? 'said' : 'answer', text: b.text ?? '', at })
    }
  }

  return [...out, ...subagents.flatMap(subagentCalls)].sort((a, b) => a.at - b.at)
}
