// The tool Claude keeps the plan with: its description and schema, reading its
// untrusted input, running an op on the plan, and the plain text it answers.
import type { Board, Previous } from './board'
import { cancelBoard, resumeBoard, setBoard, settle } from './board'
import type { NodeUpdate, Plan, PlanInput } from './plan'
import { addNodes, closing, finishedAt, hasOpenWork, moveNode, nextStep, progress, removeNode, STATUSES, updateNodes, withGoal, withTitle } from './plan'
import { clean } from './sanitize'

export const TOOL_NAME = 'plan'
export const OPS = ['set', 'next', 'update', 'add', 'remove', 'move', 'resume', 'cancel', 'show'] as const
export type OpName = (typeof OPS)[number]

export type PlanOp =
  | { op: 'set'; title: string; nodes: PlanInput[]; previous?: Previous; goal?: string }
  | { op: 'next'; id?: string; summary?: SummaryInput }
  | { op: 'update'; updates: NodeUpdate[]; summary?: SummaryInput; goal?: string; title?: string }
  | { op: 'add'; parent: string | null; nodes: PlanInput[] }
  | { op: 'remove'; id: string }
  | { op: 'move'; id: string; before?: string }
  | { op: 'resume'; title?: string; previous?: Previous }
  | { op: 'cancel' }
  | { op: 'show' }

export type SummaryInput = { goal: string; result: string }

export const ANSWER_LIMIT = 4000

export const TOOL_DESCRIPTION = [
  'The plan board for the current task; the person watches it on screen while you work.',
  'op "set" starts it: a title, a "goal" (one sentence on what the work is for, shown under the title) and the steps, nested as stages, tasks and checkpoints (3 levels at most): a few stages in order, each holding its tasks, never one flat list.',
  'Each step has a short title and a "detail": one plain sentence on what it does and why, shown under the step while it runs.',
  'Steps that do not depend on each other go under one node with "parallel": true and are worked on together; the step after the group waits for all of them.',
  'op "next" says the running step is done and starts the one after it (give "id" when several run and a particular one finished).',
  'op "update" changes steps by id: status, title, detail, links, or a note (say why a step is blocked or skipped, or what the person should check); its "goal" rewrites the plan\'s goal when the work widens, and its "title" renames the plan.',
  'op "add" puts new steps under "parent" (or at the top; a leaf may get children when a step turns out bigger), op "remove" drops a step with everything under it, op "move" puts a step before its sibling "before" (or last), op "show" answers the plan with its ids.',
  'A step with children takes its status from them, so only leaves get a status; status "pending" on a finished step or parent reopens it to redo.',
  'The board keeps one plan in hand and a shelf: op "set" with a different title while steps are open needs "previous": "park" (set it aside; it comes back when the new plan finishes) or "cancel" (start over).',
  'op "resume" brings back a shelved plan ("title", else the newest parked), op "cancel" drops the plan in hand and brings back the newest parked one.',
  'With the op that finishes the last step (op "next", or op "update" alone), give "summary": what the plan was for and how that was reached; it closes the plan at the end of the drawer.',
].join(' ')

// How a good plan is shaped, for whoever keeps the board.
export const PLAN_RULES = [
  'Shape a plan as 2 to 5 stages, the parts of the outcome in order, each holding the tasks that make it up; a task gets checkpoints when it has parts worth seeing: one for each thing the person checks on its own (each draft, screen or file they open), never one step for several of them. A flat list of steps hides the shape of the work, so group the steps even when the task is small.',
  "Name stages for what will exist when they are done, in this task's own words, not phases: a name that would fit any other task unchanged (setup, decision record, implement, test, commit, PR, wrap-up) is a phase, so rename it. The repo's routine (an issue comment, a worktree, test-first, a commit, the pull request) goes inside the stage it serves, never a stage of its own. When one stage holds more than half of five or more tasks, split it by what each part delivers. A stage holding a single task is just that task: leave it a step with no children.",
  'Every title is at most 4 words.',
  'Steps are checkpoints for following where the work stands, not the edits: the deepest level is something the person would recognise as done (a screen works, a test proves it), and the file-by-file changes stay out of the plan.',
  'Give every step a detail: one plain sentence saying what it does and why, with no file names, code or commands, in words the person already uses.',
  'The goal is one sentence on what the work is for; rewrite it with op "update" and "goal" when the work widens.',
  'The title and the goal name the work by its subject (what the change does, the feature, the bug), never "this" or "current" and never a bare number, so the person can tell the session apart from the others; when the request names its subject only that way, rename the plan with op "update" and "title" and "goal" once the calls or answers show it.',
  'When a step produced something the person may open (a PR, an issue, a commit, an artifact, a file), attach it with op "update" and "links": the full URL or an absolute path, only as it appears in what happened.',
  'A step only the person can confirm (a device in hand, a sign-in, a taste call) goes to "needs_check" with a note naming what to look at.',
].join(' ')

type Raw = Record<string, unknown>
type Parsed<T> = { value: T } | { error: string }

const bad = (message: string): { error: string } => ({ error: `Error: ${message}` })
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const kind = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v)

const optionalText = (raw: Raw, key: string, at: string): Parsed<string | undefined> => {
  const v = raw[key]
  if (v === undefined) return { value: undefined }

  return typeof v === 'string' ? { value: v } : bad(`${at}${key} must be text, not ${kind(v)}`)
}

const optionalLinks = (raw: Raw, at: string): Parsed<string[] | undefined> => {
  const v = raw.links
  if (v === undefined) return { value: undefined }
  if (!Array.isArray(v)) return bad(`${at}links must be a list of text, not ${kind(v)}`)
  const which = v.findIndex(l => typeof l !== 'string')

  return which < 0 ? { value: v.map(String) } : bad(`${at}links[${which}] must be text, not ${kind(v[which])}`)
}

const optionalFlag = (raw: Raw, key: string, at: string): Parsed<boolean | undefined> => {
  const v = raw[key]
  if (v === undefined) return { value: undefined }

  return typeof v === 'boolean' ? { value: v } : bad(`${at}${key} must be true or false, not ${kind(v)}`)
}

const readSteps = (raw: unknown, at: string): Parsed<PlanInput[]> => {
  if (!Array.isArray(raw)) return bad(`${at} must be a list of steps, not ${kind(raw)}`)
  const steps: PlanInput[] = []
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i]
    const here = `${at}[${i}]`
    if (!isObject(item)) return bad(`${here} must be an object with a title`)
    if (typeof item.title !== 'string') return bad(`${here}.title must be text, not ${kind(item.title)}`)
    const step: PlanInput = { title: item.title }
    const detail = optionalText(item, 'detail', `${here}.`)
    if ('error' in detail) return detail
    if (detail.value !== undefined) step.detail = detail.value
    const links = optionalLinks(item, `${here}.`)
    if ('error' in links) return links
    if (links.value !== undefined) step.links = links.value
    const parallel = optionalFlag(item, 'parallel', `${here}.`)
    if ('error' in parallel) return parallel
    if (parallel.value !== undefined) step.parallel = parallel.value
    if (item.children !== undefined) {
      const kids = readSteps(item.children, `${here}.children`)
      if ('error' in kids) return kids
      if (kids.value.length > 0) step.children = kids.value
    }
    steps.push(step)
  }

  return { value: steps }
}

const readUpdates = (raw: unknown): Parsed<NodeUpdate[]> => {
  if (!Array.isArray(raw)) return bad(`updates must be a list, not ${kind(raw)}`)
  const out: NodeUpdate[] = []
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i]
    const here = `updates[${i}].`
    if (!isObject(item)) return bad(`updates[${i}] must be an object with an id`)
    if (typeof item.id !== 'string') return bad(`${here}id must be text, not ${kind(item.id)}`)
    const u: NodeUpdate = { id: item.id }
    if (item.status !== undefined) {
      const status = STATUSES.find(s => s === item.status)
      if (status === undefined) return bad(`${here}status "${clean(String(item.status))}" is not one of ${STATUSES.join(', ')}`)
      u.status = status
    }
    const title = optionalText(item, 'title', here)
    if ('error' in title) return title
    if (title.value !== undefined) u.title = title.value
    const note = optionalText(item, 'note', here)
    if ('error' in note) return note
    if (note.value !== undefined) u.note = note.value
    const detail = optionalText(item, 'detail', here)
    if ('error' in detail) return detail
    if (detail.value !== undefined) u.detail = detail.value
    const links = optionalLinks(item, here)
    if ('error' in links) return links
    if (links.value !== undefined) u.links = links.value
    const parallel = optionalFlag(item, 'parallel', here)
    if ('error' in parallel) return parallel
    if (parallel.value !== undefined) u.parallel = parallel.value
    out.push(u)
  }

  return { value: out }
}

const readPrevious = (raw: Raw): Parsed<Previous | undefined> => {
  const v = raw.previous
  if (v === undefined) return { value: undefined }

  return v === 'park' || v === 'cancel' ? { value: v } : bad(`"previous" must be "park" or "cancel", not ${clean(String(v))}`)
}

const readSummary = (raw: Raw): Parsed<SummaryInput | undefined> => {
  const v = raw.summary
  if (v === undefined) return { value: undefined }
  if (!isObject(v)) return bad(`summary must be an object with a goal and a result, not ${kind(v)}`)
  if (typeof v.goal !== 'string') return bad(`summary.goal must be text, not ${kind(v.goal)}`)

  return typeof v.result === 'string' ? { value: { goal: v.goal, result: v.result } } : bad(`summary.result must be text, not ${kind(v.result)}`)
}

// Reads the tool's input, which comes from the model and is checked field by field.
export const parseOp = (raw: unknown): { op: PlanOp } | { error: string } => {
  if (!isObject(raw)) return bad(`the plan tool takes an object with an "op", not ${kind(raw)}`)
  if (raw.op === undefined) return bad(`"op" is missing; use one of ${OPS.join(', ')}`)
  const op = OPS.find(o => o === raw.op)
  if (op === undefined) return bad(`unknown op "${clean(String(raw.op))}"; use one of ${OPS.join(', ')}`)
  switch (op) {
    case 'set': {
      if (typeof raw.title !== 'string') return bad('op set needs a "title"')
      const previous = readPrevious(raw)
      if ('error' in previous) return previous
      const nodes = readSteps(raw.nodes, 'nodes')
      if ('error' in nodes) return nodes
      const goal = optionalText(raw, 'goal', '')
      if ('error' in goal) return goal

      return {
        op: {
          op,
          title: raw.title,
          nodes: nodes.value,
          ...(previous.value === undefined ? {} : { previous: previous.value }),
          ...(goal.value === undefined ? {} : { goal: goal.value }),
        },
      }
    }
    case 'move': {
      if (typeof raw.id !== 'string') return bad('op move needs the "id" of the step to move')
      const before = optionalText(raw, 'before', '')
      if ('error' in before) return before

      return { op: before.value === undefined || before.value === '' ? { op, id: raw.id } : { op, id: raw.id, before: before.value } }
    }
    case 'resume': {
      const previous = readPrevious(raw)
      if ('error' in previous) return previous
      const title = optionalText(raw, 'title', '')
      if ('error' in title) return title

      return {
        op: {
          op,
          ...(title.value === undefined || title.value === '' ? {} : { title: title.value }),
          ...(previous.value === undefined ? {} : { previous: previous.value }),
        },
      }
    }
    case 'cancel':
      return { op: { op } }
    case 'add': {
      const parent = optionalText(raw, 'parent', '')
      if ('error' in parent) return parent
      const nodes = readSteps(raw.nodes, 'nodes')

      return 'error' in nodes ? nodes : { op: { op, parent: parent.value === undefined || parent.value === '' ? null : parent.value, nodes: nodes.value } }
    }
    case 'update': {
      const summary = readSummary(raw)
      if ('error' in summary) return summary
      const goal = optionalText(raw, 'goal', '')
      if ('error' in goal) return goal
      const title = optionalText(raw, 'title', '')
      if ('error' in title) return title
      const updates = raw.updates === undefined && (summary.value !== undefined || goal.value !== undefined || title.value !== undefined) ? { value: [] } : readUpdates(raw.updates)
      if ('error' in updates) return updates

      return {
        op: {
          op,
          updates: updates.value,
          ...(summary.value === undefined ? {} : { summary: summary.value }),
          ...(goal.value === undefined ? {} : { goal: goal.value }),
          ...(title.value === undefined ? {} : { title: title.value }),
        },
      }
    }
    case 'remove':
      return typeof raw.id === 'string' ? { op: { op, id: raw.id } } : bad('op remove needs the "id" of the step to drop')
    case 'next': {
      const id = optionalText(raw, 'id', '')
      if ('error' in id) return id
      const summary = readSummary(raw)
      if ('error' in summary) return summary

      return { op: { op, ...(id.value === undefined || id.value === '' ? {} : { id: id.value }), ...(summary.value === undefined ? {} : { summary: summary.value }) } }
    }
    case 'show':
      return { op: { op } }
  }
}

const line = (n: Plan['nodes'][number]): string => {
  const extra = [n.status, ...(n.parallel === true ? ['parallel'] : [])].join(', ')
  const note = n.note === undefined ? '' : ` (${n.note})`

  return `${'  '.repeat(n.id.split('.').length - 1)}${n.id} ${n.title} - ${extra}${note}`
}

// Room left under the limit for the hints that follow the plan (flat list or routine stages, missing details, summary).
const HINT_ROOM = 800

// The plan as the model reads it: one step per line, indented by depth, kept under the limit.
export const describePlan = (plan: Plan): string => {
  if (plan.nodes.length === 0) return 'No plan yet. Start one with op "set": a title and the steps.'
  const { done, total } = progress(plan)
  const out = [`Plan: ${plan.title} (${done}/${total} done)`, ...(plan.goal === undefined ? [] : [`Goal: ${plan.goal}`])]
  let size = out.join('\n').length
  for (let i = 0; i < plan.nodes.length; i++) {
    const row = line(plan.nodes[i] as Plan['nodes'][number])
    const tail = `... ${plan.nodes.length - i} more steps not shown`
    const last = i === plan.nodes.length - 1
    if (size + 1 + row.length + (last ? 0 : 1 + tail.length) > ANSWER_LIMIT - HINT_ROOM) {
      out.push(tail)
      break
    }
    out.push(row)
    size += 1 + row.length
  }

  if (plan.summary !== undefined) out.push(`Summary: ${plan.summary.goal} / ${plan.summary.result}`)

  return out.join('\n')
}

// The board as the model reads it: the plan in hand, then the shelf in one line.
export const describeBoard = (board: Board): string => {
  const parked = board.shelf.filter(s => s.state === 'parked')
  const plan = describePlan(board.plan)

  return parked.length === 0 ? plan : `${plan}\nParked: ${parked.map(s => `"${s.plan.title}" (${progress(s.plan).done}/${progress(s.plan).total} done)`).join(', ')}`
}

// A plan of five or more steps with no step holding others reads as a to-do list, not a plan.
const isFlat = (plan: Plan): boolean => plan.nodes.length >= 5 && plan.nodes.every(n => n.parentId === null)
export const FLAT_HINT =
  'These steps sit in one flat list. Group them under 2 to 5 stages and send op "set" again with the same title and the steps nested; steps keep their status.'

// Steps without a detail leave the person guessing what they do.
export const missingDetail = (ids: readonly string[]): string =>
  `Steps ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ` and ${ids.length - 8} more` : ''} have no detail: give each its one sentence with op "update".`

// A stage whose name is nothing but the repo's routine (setup, decision record, implement, PR)
// would fit any task, so it says nothing about where this one stands.
const ROUTINE =
  /set ?up|prepar\w*|decisions?|decide|records?|design|issues?|implement\w*|build|testing|tests?|verif\w*|checks?|commits?|pull requests?|pr|reviews?|wrap[- ]?up|finish\w*|clean[- ]?up|worktree|branch|open\w*|write|code|결정|기록|설계|이슈|구현|개발|테스트|검증|확인|커밋|마무리|준비|정리|리뷰|작업|공간|브랜치|워크트리|코드|생성|만들기|열기|열림|올리기|작성|파악|수정|남기기|먼저|제출|반영/giu
const isRoutine = (title: string): boolean => title.replace(ROUTINE, '').replace(/\b(and|the|a|an)\b|[\s·/&+,.\-과와으로를을에및]/giu, '') === ''
const routineStages = (plan: Plan): string[] => {
  const stages = plan.nodes.filter(n => n.parentId === null)

  return stages.length < 2 ? [] : stages.filter(n => isRoutine(n.title)).map(n => n.id)
}
export const routineHint = (ids: readonly string[]): string =>
  `${ids.length === 1 ? 'Stage' : 'Stages'} ${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} named for the routine (setup, decision record, implement, PR), not for what this task produces. Unless that routine is the task itself, rename each for what will exist when it is done, fold the routine into the stage it serves, and send op "set" again with the same title; steps keep their status.`

// A goal rewritten again and again, or a finished plan taking on more, means the board is
// turning into a log of the session rather than one piece of work.
export const GOAL_DRIFT_HINT =
  'The goal has now been rewritten more than once, so this plan may be holding more than one piece of work. If the new work serves a different outcome, close this plan (finish or skip its open steps, give the summary) and start a new one with op "set" under a new title; the finished plan goes to the shelf as done.'
export const FINISHED_ADD_HINT =
  'This plan had finished. Keep the added steps only if they serve the same outcome; for a new outcome, remove them and start a new plan with op "set" under a new title, and the finished plan goes to the shelf as done.'

// A stage added at the top level while the plan still has open work is where a detour gets
// mistaken for more of the same work, so the answer asks once.
export const DETOUR_HINT =
  'You added a new top-level stage while this plan still has open work. Keep it only if it is a new part of this plan\'s outcome. If it is a detour (other work done here before coming back), remove it and send op "set" with previous "park": the parked plan comes back when the detour finishes. If it continues a stage, move it under that stage.'

export const NO_GOAL = 'The plan has no goal: give it one sentence on what the work is for with op "update" and "goal".'

// Runs one op: the new plan and the answer, or the refusal with the plan unchanged.
export const runOp = (board: Board, op: PlanOp, now: number): { board: Board; text: string; notice?: string } | { error: string } => {
  if (op.op === 'show') return { board, text: describeBoard(board) }
  const plan = board.plan
  const result =
    op.op === 'set'
      ? setBoard(board, op.title, op.nodes, op.previous, now, op.goal)
      : op.op === 'resume'
        ? resumeBoard(board, op.title, op.previous, now)
        : op.op === 'cancel'
          ? cancelBoard(board, now)
          : settle(
              board,
              op.op === 'next'
                ? closing(nextStep(plan, op.id, now), op.summary)
                : op.op === 'update'
                  ? closing(withTitle(withGoal(op.updates.length === 0 ? { plan } : updateNodes(plan, op.updates, now), op.goal), op.title), op.summary)
                  : op.op === 'add'
                    ? closing(addNodes(plan, op.parent, op.nodes, now))
                    : op.op === 'move'
                      ? moveNode(plan, op.id, op.before, now)
                      : closing(removeNode(plan, op.id, now)),
              now,
            )
  if ('error' in result) return bad(result.error)
  const flat = (op.op === 'set' || op.op === 'add') && isFlat(result.board.plan) ? `\n${FLAT_HINT}` : ''
  const routine = op.op === 'set' && flat === '' ? routineStages(result.board.plan) : []
  const named = routine.length > 0 ? `\n${routineHint(routine)}` : ''
  const bare = op.op === 'set' || op.op === 'add' ? result.board.plan.nodes.filter(n => (n.detail ?? '') === '').map(n => n.id) : []
  const detail = bare.length > 0 ? `\n${missingDetail(bare)}` : ''
  const aim = op.op === 'set' && result.board.plan.goal === undefined ? `\n${NO_GOAL}` : ''
  const ask = finishedAt(result.board.plan) !== null && result.board.plan.summary === undefined ? '\nThe plan is finished: send op "update" with "summary" to close it.' : ''
  const drift = (result.board.plan.goalEdits ?? 0) >= 2 && (result.board.plan.goalEdits ?? 0) > (plan.goalEdits ?? 0) ? `\n${GOAL_DRIFT_HINT}` : ''
  const grown = op.op === 'add' && plan.nodes.length > 0 && !hasOpenWork(plan) ? `\n${FINISHED_ADD_HINT}` : ''
  const detour = op.op === 'add' && op.parent === null && hasOpenWork(plan) ? `\n${DETOUR_HINT}` : ''
  const text = describeBoard(result.board) + flat + named + detail + aim + ask + drift + grown + detour

  return result.notice === undefined ? { board: result.board, text } : { board: result.board, text: `${result.notice}\n${text}`, notice: result.notice }
}
