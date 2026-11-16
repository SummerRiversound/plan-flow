// The board's writer: Sonnet rereads the session, as short lines, and writes the whole board again.
import type { SessionMessage } from 'claude-code'
import type { Board, Chapter, Item, Kind } from './chapters'
import { noticeLine, toolLine } from './lines'

const flat = (s: string): string => s.replace(/\s+/g, ' ').trim()
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// How much of each line the writer reads, and of the session: over sixteen recorded sessions these
// lengths scored as well as reading the whole conversation.
const MAX_REQUEST = 1500
const MAX_CALL = 180
const MAX_OTHER = 700
export const MAX_STORY = 200_000

const isLocal = (text: string): boolean => /^\s*<(command-|local-command)/.test(text) || text.startsWith('[Request interrupted')

const asked = (input: Record<string, unknown>, answer: string | undefined): string => {
  const qs = ((input.questions as Array<{ question?: string }> | undefined) ?? []).map(q => q.question ?? '').join(' / ')
  return `- Claude asked the person in a choice dialog: ${qs}${answer === undefined ? ' (not answered yet)' : ` → the person answered: ${cut(flat(answer), 400)}`}`
}

// The session as lines, oldest first, the newest kept within `max` characters.
export const storyOf = (messages: readonly SessionMessage[], max = MAX_STORY): string => {
  const rows: string[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.text.trim() === '' || isLocal(m.text)) continue
      rows.push(m.text.includes('<task-notification>') ? cut(`- Claude was told: ${flat(noticeLine(m.text))}`, MAX_OTHER) : cut(`- The person asked: ${flat(m.text)}`, MAX_REQUEST))
      continue
    }
    const calling = m.toolUses.length > 0
    if (m.text.trim() !== '') rows.push(cut(`- Claude ${calling ? 'said' : 'answered'}: ${flat(m.text)}`, MAX_OTHER))
    for (const u of m.toolUses) {
      if (u.tool === 'ToolSearch') continue
      if (u.tool === 'AskUserQuestion') {
        rows.push(cut(asked(u.input, u.text), MAX_OTHER))
        continue
      }
      const line = toolLine(u.tool, u.input)
      rows.push(cut(`- Claude ran: ${flat(u.isError === true ? `${line} (failed)` : line)}`, MAX_CALL))
    }
  }
  const out: string[] = []
  let size = 0
  for (let i = rows.length - 1; i >= 0 && size < max; i--) {
    out.unshift(rows[i] as string)
    size += (rows[i] as string).length
  }
  return out.join('\n')
}

export const WRITER_SYSTEM =
  'You keep a short status board beside a coding session, for a person who runs about twenty sessions at once and glances at a tab for a few seconds. You never guess: everything you write comes from what the person asked and what Claude said or did. Write in the language the person writes in.'

const KINDS =
  '"mine" when it waits on the person (a question the answer asks them, a decision, a check only they can do, a sign-in); "claude" when Claude goes on with it next, or waits only for a go-ahead; "others" when it waits on someone or something outside the session (a reviewer, CI, another team); "optional" when it is offered, out of scope or "if you want"; "unverified" when Claude says it did not check or could not confirm it. If the person told Claude to do all it can, what Claude could do itself is "claude", not "mine".'

export const writerPrompt = (story: string): string =>
  [
    `The session, oldest first:\n${story}`,
    [
      'Write the status board for this session as it stands at its end. One chapter per piece of work the person asked for (a bare go-ahead stays in the chapter before), oldest first.',
      '- title: 2 to 6 words naming the session by its subject (what the work changes), never "this PR", "current work" or a bare number; goal: one sentence on the end the person is after.',
      "- per chapter: request (the person's words, shortened), title (3 to 8 words, no file names or commands), result (one or two sentences on everything it achieved), links (PR, issue, artifact URLs that appear), done (true when its work is finished).",
      `- left, for the last chapter only: what is still left at the end of the session, one short line each, with "kind": ${KINDS}`,
      'Answer with one JSON object only, no prose, no code fence: {"title":"…","goal":"…","chapters":[{"request":"…","title":"…","result":"…","links":[],"done":true,"left":[]}]}',
    ].join('\n'),
  ].join('\n\n')

const KINDS_KNOWN: ReadonlySet<string> = new Set(['mine', 'claude', 'others', 'optional', 'unverified'])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// The writer's answer as a board; undefined when it is not one.
export const parseBoard = (text: string): Board | undefined => {
  let w: { title?: unknown; goal?: unknown; chapters?: unknown }
  try {
    w = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  } catch {
    return undefined
  }
  if (!Array.isArray(w.chapters)) return undefined
  const all = w.chapters as Array<Record<string, unknown>>
  const chapters = all.map((c, i): Chapter => {
    const left = i < all.length - 1 || !Array.isArray(c.left) ? [] : (c.left as Array<Record<string, unknown>>).filter(x => str(x.text) !== '' && KINDS_KNOWN.has(str(x.kind))).map((x): Item => ({ text: str(x.text), kind: str(x.kind) as Kind }))
    return { request: str(c.request), title: str(c.title), result: str(c.result), links: Array.isArray(c.links) ? c.links.filter((l): l is string => typeof l === 'string') : [], done: c.done === true, left, receipts: [] }
  })
  return { title: str(w.title), goal: str(w.goal), chapters }
}
