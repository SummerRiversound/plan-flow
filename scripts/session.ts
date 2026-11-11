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

export type Usage = { input: number; cacheRead: number; cacheWrite: number; output: number }
export type Spent = { at: number; call: 'look' | 'design'; usage?: Usage }

// Tokens as cost, in units of one input token of the main model.
const weigh = (u: Usage): number => u.input + 0.1 * u.cacheRead + 1.25 * u.cacheWrite + 5 * u.output
// shortcut: the planner's model is taken as a fifth of the main model's price; read real prices if the models change.
const PLANNER_PRICE = 1 / 5

// What the mod's own model calls cost, as a percentage of what the session's work cost over the
// span those calls cover; undefined when no call kept its tokens or the work cost nothing.
export const costShare = (calls: readonly Spent[], jsonl: string): number | undefined => {
  const kept = calls.filter((c): c is Spent & { usage: Usage } => c.usage !== undefined)
  const [from, to] = [kept[0]?.at, kept.at(-1)?.at]
  if (from === undefined || to === undefined) return undefined
  const seen = new Set<string>()
  let main = 0
  for (const row of jsonl.split('\n')) {
    if (!row.includes('"usage"')) continue
    let e: { type?: string; isSidechain?: boolean; timestamp?: string; message?: { id?: string; usage?: Record<string, number> } }
    try {
      e = JSON.parse(row)
    } catch {
      continue
    }
    const [u, id, at] = [e.message?.usage, e.message?.id, Date.parse(e.timestamp ?? '')]
    if (u === undefined || id === undefined || e.type !== 'assistant' || e.isSidechain === true || at < from || at > to + 60_000 || seen.has(id)) continue
    seen.add(id)
    main += weigh({ input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0 })
  }
  if (main === 0) return undefined

  return (100 * kept.reduce((s, c) => s + weigh(c.usage) * (c.call === 'look' ? PLANNER_PRICE : 1), 0)) / main
}

// The cost item's bar, picked on 2026-11-11 ("엄격"): 5 up to 1%, 4 up to 2%, 3 up to 4%, 2 up to 8%, else 1.
export const costScore = (percent: number): number => 5 - [1, 2, 4, 8].filter(limit => percent > limit).length

// The mean over the items that got a score, the cost item included when the session has one.
export const itemMean = (scores: ReadonlyArray<{ score: number }>): number => {
  const xs = scores.map(s => s.score).filter(x => x > 0)

  return xs.length === 0 ? 0 : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
}
