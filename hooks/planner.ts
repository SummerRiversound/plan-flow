// The side planner: the mod keeps the board by asking a small model of its own, so nothing
// of plan-flow reaches what Claude reads. It is handed the board and what happened since its
// last look (the person's requests, Claude's tool calls in one line each, Claude's answers)
// and answers with the same ops the board has always run.
import type { Board } from './board'
import type { PlanOp } from './plan-tool'
import { STATUSES } from './plan'
import type { PlanStatus } from './plan'
import { DESIGN_TITLE_RULE, PLAN_RULES, TITLE_RULE, TOOL_DESCRIPTION, describeBoard, parseOp, runOp } from './plan-tool'

// One line of what happened, oldest first.
export type Happened = { kind: 'request' | 'notice' | 'tool' | 'subagent' | 'said' | 'answer'; text: string }

// The calls that change something; these count towards the next look.
export const GUARDED: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'Agent', 'Task', 'Workflow'])

// State-changing calls in a turn before the planner looks again, so the board moves while Claude works.
export const PLAN_EVERY = 6
// While Claude only reads, the planner still looks once this long has passed since its last look.
export const LOOK_EVERY_MS = 60_000
// While Claude works, looks are at least this far apart; what comes in meanwhile waits for the next.
export const LOOK_GAP_MS = 20_000

export const MAX_LOG = 80
const MAX_PROMPT_LOG = 6000
const MAX_LINE = 160
// A command with no description says nothing of its purpose, and its words (a prompt sent to another
// session, a message's text) read like a request; a short cut keeps what it runs, not what it carries.
const MAX_COMMAND = 80
const MAX_ANSWER = 800

const cut = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}
const base = (p: unknown): string => (typeof p === 'string' ? (p.split('/').pop() ?? p) : '')

// A tool call in one line: what it is for where the call says so, else what it touches.
export const toolLine = (tool: string, input: Record<string, unknown>): string => {
  const said = typeof input.description === 'string' ? input.description : ''
  if (tool === 'Bash') return said !== '' ? cut(said, MAX_LINE) : cut(String(input.command ?? ''), MAX_COMMAND)
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read'].includes(tool)) return cut(`${tool} ${base(input.file_path ?? input.notebook_path)}`, MAX_LINE)
  if (said !== '') return cut(`${tool}: ${said}`, MAX_LINE)
  if (typeof input.pattern === 'string') return cut(`${tool} ${input.pattern}`, MAX_LINE)
  // A connected tool has no description of its own: its short fields say what the call did.
  const name = tool.replace(/^mcp__.*__/, '')
  const fields = QUIET.has(tool) ? '' : hint(input, 0)

  return fields === '' ? name : cut(`${name}: ${fields}`, MAX_HINT)
}

// Tools whose input says nothing of the work.
const QUIET: ReadonlySet<string> = new Set(['ToolSearch'])
const MAX_HINT = 120
// A field longer than this is content (a message, a script, a page), not what the call is for.
const MAX_FIELD = 60
const NOT_TELLING = /(^|_)(ids?|ur[il]|path)$|Ids?$/
const hint = (v: unknown, depth: number): string => {
  if (typeof v === 'string') return v.length <= MAX_FIELD ? v.replace(/\s+/g, ' ').trim() : ''
  if (typeof v !== 'object' || v === null || depth > 2) return ''
  if (Array.isArray(v)) return v.slice(0, 3).map(x => hint(x, depth + 1)).filter(s => s !== '').join('; ')

  return Object.entries(v)
    .filter(([k]) => !NOT_TELLING.test(k))
    .map(([k, x]) => [k, hint(x, depth + 1)] as const)
    .filter(([, s]) => s !== '')
    .map(([k, s]) => `${k} ${s}`)
    .join(', ')
}

// The log kept short: the newest lines, each request and answer cut to fit.
// Where a prompt comes from when the person sent it; the rest (a task's notice, another session) is news, not a request.
export const PERSON: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk', 'scheduled-trigger', 'channel'])

// A notice in one line: a task notification's summary where it has one.
export const noticeLine = (text: string): string => /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1] ?? text

export const remember = (log: readonly Happened[], h: Happened): Happened[] => {
  const text = cut(h.text, h.kind === 'request' || h.kind === 'answer' ? MAX_ANSWER : MAX_LINE)
  if (text === '') return [...log]
  return [...log, { kind: h.kind, text }].slice(-MAX_LOG)
}

// The field names the board reads, spelled out: without them a model writes "steps" for "nodes".
const OP_SHAPES = [
  'Each op is one JSON object with exactly these field names ("?" marks a field that may be left out):',
  '{"op":"set","title":"…","goal":"…","previous"?:"park"|"cancel","nodes":[STEP, …],"expected"?:["…"]}',
  'where STEP is {"title":"…","detail":"…","parallel"?:true,"links"?:["…"],"children"?:[STEP, …]};',
  '{"op":"next","id"?:"…","summary"?:{"goal":"…","result":"…"}};',
  `{"op":"update","updates":[{"id":"…","status"?:"${STATUSES.join('"|"')}","title"?:"…","detail"?:"…","note"?:"…","links"?:["…"]}],"goal"?:"…","title"?:"…","expected"?:["…"],"summary"?:{"goal":"…","result":"…"}};`,
  '{"op":"add","parent"?:"…","nodes":[STEP, …]}; {"op":"remove","id":"…"}; {"op":"move","id":"…","before"?:"…"}; {"op":"resume","title"?:"…"}; {"op":"cancel"}.',
  'Ids are the ones the board shows. New steps start pending: a status changes only through op "next" or op "update".',
].join(' ')

export const PLANNER_SYSTEM = [
  'You keep the plan board for a coding session between a person and Claude. You do not do the work and you never talk to either of them: you watch what happens and keep the board true to it, so the person can see at a glance what the session is doing and where it stands.',
  'The board runs these ops.',
  TOOL_DESCRIPTION,
  OP_SHAPES,
  PLAN_RULES,
  'Keep the board following the work: a new piece of work gets op "set" with a title, a goal and its steps; more of the same, or a fix to finished work, goes under the stage it continues (op "add" with that stage as "parent", or status "pending" to reopen a step); a detour done before coming back gets op "set" with previous "park", and the parked plan returns when the detour finishes; a request that starts over gets previous "cancel"; going back to parked or finished work (the board lists both) gets op "resume" with its title, and what is added goes under that plan. Mark steps done (op "next" or op "update" with status "completed") as the tool calls and answers show them done, and give the summary with the op that finishes the last step. A question, a chat or a one-step job changes nothing.',
  'Never add parts nobody asked for (a screen, a deploy); steps already on the board ahead of the work are the plan\'s way to its goal, so keep them until the work turns away from them. The work outranks your first guess: when the calls and answers show a step was not part of it, remove it or reshape the plan to what was done; when Claude answers that the request is done, the board should read done too. A note goes only on a blocked, skipped or needs_check step; a question Claude puts to the person stays in Claude\'s answer, not on the board.',
  'When Claude\'s answer asks the person to approve, choose or say whether to go on, the step waiting on that answer stays open (in_progress) until the person answers; asking is not finishing it, and the plan does not close while the answer is pending.',
  'A call marked (failed) did not succeed, so the step it serves is not done yet; reading and searching show the work being looked into, not finished; a subagent\'s calls are work Claude handed off, done for the step that handed it.',
  'Write titles and details in the language the person writes in.',
  'Answer with only a JSON array of op objects, such as [{"op":"next"}], and [] when nothing on the board should change. No prose, no code fence.',
].join('\n\n')

// What the planner reads: the board as it stands, then the newest of what happened.
export const plannerPrompt = (board: Board, log: readonly Happened[]): string => {
  const label = { request: 'The person asked', notice: 'Claude was told', tool: 'Claude ran', subagent: 'A subagent ran', said: 'Claude said', answer: 'Claude answered' } as const
  const lines: string[] = []
  let size = 0
  for (let i = log.length - 1; i >= 0; i--) {
    const h = log[i] as Happened
    const row = `- ${label[h.kind]}: ${h.text}`
    if (size + row.length > MAX_PROMPT_LOG) break
    lines.unshift(row)
    size += row.length + 1
  }
  const now = board.plan.nodes.length === 0 && board.shelf.length === 0 ? 'The board is empty.' : describeBoard(board)

  return [`The board now:\n${now}`, `What happened since your last look, oldest first:\n${lines.join('\n') || '- nothing'}`, 'Answer with the JSON array of ops.'].join('\n\n')
}

// The ops a fork may use: it reshapes the plan in hand, never starts, ends or swaps one.
export const DESIGN_OPS: ReadonlySet<PlanOp['op']> = new Set(['update', 'add', 'remove', 'move'])

// The one question put to a fork of the main conversation: Claude, who does the work, designs the plan
// and says where each step stands, since it knows what it did and the planner only saw the calls.
export const designPrompt = (board: Board): string =>
  [
    'This message comes from plan-flow, the plan board drawn beside this session, not from the person. Nothing you write here reaches the person or the session and no tool runs: answer from what this conversation already holds, at once.',
    `A smaller model drew this board from the calls it saw:\n${describeBoard(board)}`,
    'Design the plan of this work as you, who are doing it, see it. The goal is the end the person is after: what will be true or exist for them once the work is done, never the steps or what was done so far. The stages run the whole way to that end, the ones not started yet included, so the person sees what is left; the work after them that waits on the person or someone else goes in "expected" with op "update".',
    OP_SHAPES,
    PLAN_RULES.replace(TITLE_RULE, DESIGN_TITLE_RULE),
    'Reshape the board with op "update" (the goal, the title, a step\'s title, detail or status), "add", "remove" and "move" by the ids it shows. You know what you did: a step you finished is "completed", one the work went past without doing is "skipped" with a note on why (or removed when it was never part of the work), and one you are still on stays as it is. A check that has not run yet (a nightly job, a test the person runs, a reply still to come) is never "completed", and neither is anything you told the person you did not verify. Go through every step the board shows and give each the status that is true now.',
    'Work of this plan that the board does not show goes on it with op "add" under the stage it belongs to; in an op "add" from you, and only there, a STEP may carry "status" (and "note"), so work already done is added as "completed". What your last answer left with the person (a choice to make, something to look at or approve) is not finished: a step only they can confirm is "needs_check" with a note naming what to look at, and work that waits on their go-ahead goes in "expected". Before you answer, go back over your last answer for every question you asked, every choice you laid out, and everything you said you did not do or left to the person or another team: each is on the board as "needs_check" or in "expected" (two at most, the ones that decide what happens next first), even when every step is done; a part of the request that was not handled goes there too. Work you only advised on or reviewed is named for what you gave (the advice, the verdict); the doing that someone else still has to do is "expected", never "completed". A step whose command still runs in the background stays "in_progress". When your statuses finish the last step, give "summary" with that op "update".',
    'Name each stage for what it delivers to the person (the change a pull request makes, the screen that now works), never for the pull request routine; the routine (a draft, reviewers, ready for review, review fixes, the merge) is at most one checkpoint per stage, such as "merged" with its link. Write in the language the person writes in.',
    'Answer with only a JSON array of op objects, and [] when the board already fits. No prose, no code fence.',
  ].join('\n\n')

// Step ids in reading order: "2.10" after "2.9", a step before the steps under it.
const byPath = (a: string, b: string): number => {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)]
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0)

  return x.length - y.length
}

// A design answer on the board: its ops among the ones a fork may use, in order, an op the board
// refuses left out; the steps an op "add" brings take the statuses Claude gave them.
export const runDesign = (board: Board, text: string, now: number): { board: Board; applied: number } => {
  const statuses = addedStatuses(text)
  let applied = 0
  parseOps(text).forEach((op, i) => {
    if (!DESIGN_OPS.has(op.op)) return
    const before = new Set(board.plan.nodes.map(n => n.id))
    const ran = runOp(board, op, now)
    if ('error' in ran) return
    board = ran.board
    applied++
    const given = statuses[i] ?? []
    const added = op.op === 'add' ? board.plan.nodes.map(n => n.id).filter(id => !before.has(id)).sort(byPath) : []
    const updates = added.flatMap((id, k) => (given[k] === undefined ? [] : [{ id, ...given[k] }]))
    const marked = updates.length === 0 ? undefined : runOp(board, { op: 'update', updates }, now)
    if (marked !== undefined && !('error' in marked)) board = marked.board
  })

  return { board, applied }
}

// A status Claude gave a step it adds, by the step's place among the op's steps in reading order.
export type AddedStatus = { status: PlanStatus; note?: string } | undefined

// The statuses on the steps of each op "add" in a design answer: one list per op the board would run, in
// order (empty for the other ops). Only leaves carry one: a step with children takes its status from them.
export const addedStatuses = (text: string): AddedStatus[][] => {
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  type Raw = { op?: unknown; nodes?: unknown; status?: unknown; note?: unknown; children?: unknown } | null
  const walk = (nodes: unknown): AddedStatus[] =>
    (Array.isArray(nodes) ? (nodes as Raw[]) : []).flatMap(n => {
      const kids = Array.isArray(n?.children) && n.children.length > 0
      const mine: AddedStatus =
        !kids && typeof n?.status === 'string' && n.status !== 'pending' && (STATUSES as readonly string[]).includes(n.status)
          ? { status: n.status as PlanStatus, ...(typeof n.note === 'string' ? { note: n.note } : {}) }
          : undefined
      return [mine, ...(kids ? walk(n?.children) : [])]
    })

  return (raw as Raw[]).flatMap(r => {
    const p = parseOp(r)
    return 'error' in p || p.op.op === 'show' ? [] : [r?.op === 'add' ? walk(r.nodes) : []]
  })
}

// The ops in the planner's answer, in order; anything that is not an op is left out.
export const parseOps = (text: string): PlanOp[] => {
  const from = text.indexOf('[')
  const to = text.lastIndexOf(']')
  if (from === -1 || to < from) return []
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(from, to + 1))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  return raw.flatMap(r => {
    const p = parseOp(r)
    return 'error' in p || p.op.op === 'show' ? [] : [p.op]
  })
}
