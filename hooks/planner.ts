// The side planner: the mod keeps the board by asking a small model of its own, so nothing
// of plan-flow reaches what Claude reads. It is handed the board and what happened since its
// last look (the person's requests, Claude's tool calls in one line each, Claude's answers)
// and answers with the same ops the board has always run.
import type { Board } from './board'
import type { PlanOp } from './plan-tool'
import { STATUSES } from './plan'
import { PLAN_RULES, TOOL_DESCRIPTION, describeBoard, parseOp } from './plan-tool'

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
// Claude's words carry where the work stands, and about half its answers run past 800 characters,
// so they reach the planner whole up to MAX_ANSWER; a call stays one line.
const MAX_PROMPT_LOG = 24_000
const MAX_LINE = 160
const MAX_ANSWER = 4_000

const cut = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}
const base = (p: unknown): string => (typeof p === 'string' ? (p.split('/').pop() ?? p) : '')

// A tool call in one line: what it is for where the call says so, else what it touches.
export const toolLine = (tool: string, input: Record<string, unknown>): string => {
  const said = typeof input.description === 'string' ? input.description : ''
  if (tool === 'Bash') return cut(said || String(input.command ?? ''), MAX_LINE)
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read'].includes(tool)) return cut(`${tool} ${base(input.file_path ?? input.notebook_path)}`, MAX_LINE)
  if (said !== '') return cut(`${tool}: ${said}`, MAX_LINE)
  if (typeof input.pattern === 'string') return cut(`${tool} ${input.pattern}`, MAX_LINE)

  return tool
}

// The log kept short: the newest lines, each request and answer cut to fit.
// Where a prompt comes from when the person sent it; the rest (a task's notice, another session) is news, not a request.
export const PERSON: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk', 'scheduled-trigger', 'channel'])

// A notice in one line: a task notification's summary where it has one.
export const noticeLine = (text: string): string => /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1] ?? text

export const remember = (log: readonly Happened[], h: Happened): Happened[] => {
  const text = cut(h.text, h.kind === 'request' || h.kind === 'answer' || h.kind === 'said' ? MAX_ANSWER : MAX_LINE)
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

// The one question put to a fork of the main conversation: Claude, who does the work, designs the plan.
export const designPrompt = (board: Board): string =>
  [
    'This message comes from plan-flow, the plan board drawn beside this session, not from the person. Nothing you write here reaches the person or the session and no tool runs: answer from what this conversation already holds, at once.',
    `A smaller model drew this board from the calls it saw:\n${describeBoard(board)}`,
    'Design the plan of this work as you, who are doing it, see it. The goal is the end the person is after: what will be true or exist for them once the work is done, never the steps or what was done so far. The stages run the whole way to that end, the ones not started yet included, so the person sees what is left; the work after them that waits on the person or someone else goes in "expected" with op "update".',
    OP_SHAPES,
    PLAN_RULES,
    'Reshape the board with op "update" (the goal, the title, a step\'s title or detail), "add", "remove" and "move" only, by the ids it shows, and leave every status as it is. Write in the language the person writes in.',
    'Answer with only a JSON array of op objects, and [] when the board already fits. No prose, no code fence.',
  ].join('\n\n')

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
