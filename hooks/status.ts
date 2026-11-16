// The opt-in status block: Claude is asked to end an answer that followed work with a short block,
// and the board reads it by rule until the writer next writes the board.
import type { Item, Kind } from './chapters'

export const STATUS_PROMPT = [
  'When an answer follows work (tool calls), end it with this block, in the language you answer in, leaving out empty lines:',
  '<status>',
  'done: <one sentence on what this answer achieved>',
  'mine: <one line per thing waiting on the person>',
  'next: <one line per thing you go on with>',
  'others: <one line per thing waiting on someone outside>',
  'unchecked: <one line per thing you did not verify>',
  '</status>',
].join('\n')

const KINDS: Record<string, Kind> = { mine: 'mine', next: 'claude', others: 'others', unchecked: 'unverified' }

export type Status = { result: string; left: Item[] }

// The last block in the answer; a key may repeat, or list its items under it as `- ` lines.
export const parseStatus = (answer: string): Status | undefined => {
  const body = [...answer.matchAll(/<status>([\s\S]*?)<\/status>/g)].at(-1)?.[1]
  if (body === undefined) return undefined
  let result = ''
  const left: Item[] = []
  let key: string | undefined
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const kv = /^([a-z]+)\s*:\s*(.*)$/i.exec(line)
    const text = kv === null ? (key !== undefined && line.startsWith('- ') ? line.slice(2).trim() : '') : (kv[2] ?? '').trim()
    if (kv !== null) key = (kv[1] ?? '').toLowerCase()
    if (text === '' || key === undefined) continue
    const kind = KINDS[key]
    if (key === 'done') result = text
    else if (kind !== undefined) left.push({ text, kind })
  }

  return result === '' && left.length === 0 ? undefined : { result, left }
}
