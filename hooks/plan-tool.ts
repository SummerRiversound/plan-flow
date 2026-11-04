// The tool Claude keeps the plan with: its description and schema, reading its
// untrusted input, running an op on the plan, and the plain text it answers.
import type { Board, Previous } from './board'
import { cancelBoard, resumeBoard, setBoard, settle } from './board'
import type { NodeUpdate, Plan, PlanInput } from './plan'
import { addNodes, currentLeaf, hasOpenWork, MAX_DETAIL, MAX_LINKS, MAX_NOTE, MAX_TITLE, moveNode, nextStep, progress, removeNode, STATUSES, updateNodes } from './plan'
import { clean } from './sanitize'

export const TOOL_NAME = 'plan'
export const OPS = ['set', 'next', 'update', 'add', 'remove', 'move', 'resume', 'cancel', 'show'] as const
export type OpName = (typeof OPS)[number]

export type PlanOp =
  | { op: 'set'; title: string; nodes: PlanInput[]; previous?: Previous }
  | { op: 'next'; id?: string }
  | { op: 'update'; updates: NodeUpdate[] }
  | { op: 'add'; parent: string | null; nodes: PlanInput[] }
  | { op: 'remove'; id: string }
  | { op: 'move'; id: string; before?: string }
  | { op: 'resume'; title?: string; previous?: Previous }
  | { op: 'cancel' }
  | { op: 'show' }

export const ANSWER_LIMIT = 4000

export const TOOL_DESCRIPTION = [
  'The plan board for the current task; the person watches it on screen while you work.',
  'op "set" starts it: a title and the steps, nested as stages, tasks and checkpoints (3 levels at most).',
  'Each step has a short title and a "detail": one plain sentence on what it does and why, shown under the step while it runs.',
  'Steps that do not depend on each other go under one node with "parallel": true and are worked on together; the step after the group waits for all of them.',
  'op "next" says the running step is done and starts the one after it (give "id" when several run and a particular one finished).',
  'op "update" changes steps by id: status, title, detail, links, or a note (say why a step is blocked or skipped, or what the person should check).',
  'op "add" puts new steps under "parent" (or at the top; a leaf may get children when a step turns out bigger), op "remove" drops a step with everything under it, op "move" puts a step before its sibling "before" (or last), op "show" answers the plan with its ids.',
  'A step with children takes its status from them, so only leaves get a status; status "pending" on a finished step or parent reopens it to redo.',
  'The board keeps one plan in hand and a shelf: op "set" with a different title while steps are open needs "previous": "park" (set it aside; it comes back when the new plan finishes) or "cancel" (start over).',
  'op "resume" brings back a shelved plan ("title", else the newest parked), op "cancel" drops the plan in hand and brings back the newest parked one.',
].join(' ')

// JSON Schema, written out level by level because it may not use $ref. Groups do not
// count as levels, so the nesting goes deeper than three.
type Schema = Record<string, unknown>
const LINKS_HELP = `What the step produced that the person may open: a PR, issue, commit, artifact or doc URL, or an absolute file path (${MAX_LINKS} at most)`
const stepSchema = (depth: number): Schema => {
  const properties: Record<string, Schema> = {
    title: { type: 'string', description: `At most 4 words, in the user's language (${MAX_TITLE} characters at most)` },
    detail: { type: 'string', description: `One plain sentence: what this step does and why, in words the person already uses (${MAX_DETAIL} characters at most)` },
    links: { type: 'array', items: { type: 'string' }, description: LINKS_HELP },
    parallel: { type: 'boolean', description: 'This node groups steps that run at the same time' },
  }
  if (depth > 1) properties.children = { type: 'array', items: stepSchema(depth - 1) }

  return { type: 'object', properties, required: ['title'] }
}

export const TOOL_SCHEMA: Schema = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: [...OPS] },
    title: { type: 'string', description: 'The task, for op set; the shelved plan, for op resume' },
    previous: { type: 'string', enum: ['park', 'cancel'], description: 'For op set and resume while the plan in hand has open steps: park it to come back to, or cancel it' },
    before: { type: 'string', description: 'For op move: the sibling to move in front of; leave out to move last' },
    nodes: { type: 'array', description: 'Steps, for op set and add', items: stepSchema(5) },
    parent: { type: 'string', description: 'Id to add under, for op add; leave out for the top level' },
    id: { type: 'string', description: 'For op remove: the step to drop. For op move: the step to move. For op next: the running step that finished' },
    updates: {
      type: 'array',
      description: 'For op update',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: [...STATUSES] },
          title: { type: 'string' },
          note: { type: 'string', description: `Why, for blocked or skipped; what to look at, for needs_check (${MAX_NOTE} characters at most); empty clears it` },
          detail: { type: 'string', description: 'The step\'s one-sentence detail; empty clears it' },
          links: { type: 'array', items: { type: 'string' }, description: 'Links to add after the step\'s own; an empty list clears them' },
          parallel: { type: 'boolean' },
        },
        required: ['id'],
      },
    },
  },
  required: ['op'],
}

// The section the system prompt carries while the tool is offered.
export const instruction = (tool: string): string =>
  [
    `Plan board: the board follows the session's work, not each prompt. For a task that needs more than a couple of tool calls, call ${tool} with op "set" first: a short task title and its steps.`,
    "Every title is at most 4 words, in the user's language.",
    'Give every step a detail: one plain sentence saying what it does and why, so the person follows without asking; use words the person already uses, never labels coined in this session.',
    'When a step produces something the person may open (a PR, an issue, a commit, an artifact, a doc, a file), attach it to that step with op "update" and "links": the full URL or an absolute path.',
    'Put steps that do not depend on each other under one node with "parallel": true and work on them together (several tool calls or agents in one message).',
    'When a step is done call op "next"; it finishes that step and starts the following one. Use op "update" for blocked or skipped steps, with a note saying why.',
    'Check your own work right after each change, inside that step (run it, look at it, take the screenshot); never plan a catch-all check step for the end. When a step is done but only the person can confirm it (a device in hand, a sign-in, a taste call), set it to "needs_check" with a note naming what to look at, and move on: it counts as done and shows in a "확인할 것" line. Set it to "completed" when the person confirms, or "pending" to redo it.',
    'While a plan is on the board, each request carries a plan-flow note: follow it to decide what the request does to the board before acting.',
    'The person sees the board drawn on screen, so never describe, list or redraw the plan in your reply.',
    'A plain question needs no plan.',
    `If the tool is not loaded yet, load it with ToolSearch (query "select:${tool}").`,
  ].join(' ')

// The note each request carries while the board has a plan: where things stand, and the
// cases to sort the request into before acting.
export const boardNote = (board: Board): string | undefined => {
  const parked = board.shelf.filter(s => s.state === 'parked')
  if (board.plan.nodes.length === 0 && parked.length === 0) return undefined
  const lines = ['plan-flow: the board before this request.']
  if (board.plan.nodes.length > 0) {
    const { done, total } = progress(board.plan)
    const leaf = currentLeaf(board.plan)
    const state = hasOpenWork(board.plan) ? (leaf === null ? '' : `, in hand: ${leaf.title} (id ${leaf.id})`) : ', finished'
    lines.push(`In hand: "${board.plan.title}" (${done}/${total} done${state}).`)
  }
  if (parked.length > 0) lines.push(`Parked: ${parked.map(s => `"${s.plan.title}" (${progress(s.plan).done}/${progress(s.plan).total})`).join(', ')}.`)
  lines.push(
    'Decide what this request does to the board, change the board first, then work:',
    '- a question, or a quick side job that does not change the task: leave the board alone;',
    '- more work for this task, a follow-up after it finished, or a step that turned out bigger: op "add" (under the step it belongs to; a leaf may get children);',
    '- redo finished work: op "update" with status "pending" and a note why;',
    '- a different approach, dropped scope or a new order: update titles, op "remove" or status "skipped" with a note, op "move";',
    '- the person is needed before work can go on (sign-in, a decision): status "blocked" with a note;',
    '- the person confirms a "확인할 것" step: status "completed" (or "pending" with a note if it needs redoing);',
    '- a detour that shares this context: op "set" with previous "park"; the parked plan comes back when the detour finishes;',
    '- unrelated work: first suggest doing it in a fresh session and ask; if the person stays here, op "set" with previous "park";',
    '- start over: op "set" with previous "cancel";',
    '- back to parked work: op "resume".',
    'When the request reads as more than one of these, ask the person before changing the board.',
  )

  return lines.join('\n')
}

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

      return { op: previous.value === undefined ? { op, title: raw.title, nodes: nodes.value } : { op, title: raw.title, nodes: nodes.value, previous: previous.value } }
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
      const updates = readUpdates(raw.updates)

      return 'error' in updates ? updates : { op: { op, updates: updates.value } }
    }
    case 'remove':
      return typeof raw.id === 'string' ? { op: { op, id: raw.id } } : bad('op remove needs the "id" of the step to drop')
    case 'next': {
      const id = optionalText(raw, 'id', '')
      if ('error' in id) return id

      return { op: id.value === undefined || id.value === '' ? { op } : { op, id: id.value } }
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

// The plan as the model reads it: one step per line, indented by depth, kept under the limit.
export const describePlan = (plan: Plan): string => {
  if (plan.nodes.length === 0) return 'No plan yet. Start one with op "set": a title and the steps.'
  const { done, total } = progress(plan)
  const out = [`Plan: ${plan.title} (${done}/${total} done)`]
  let size = out[0]?.length ?? 0
  for (let i = 0; i < plan.nodes.length; i++) {
    const row = line(plan.nodes[i] as Plan['nodes'][number])
    const tail = `... ${plan.nodes.length - i} more steps not shown`
    const last = i === plan.nodes.length - 1
    if (size + 1 + row.length + (last ? 0 : 1 + tail.length) > ANSWER_LIMIT) {
      out.push(tail)
      break
    }
    out.push(row)
    size += 1 + row.length
  }

  return out.join('\n')
}

// The board as the model reads it: the plan in hand, then the shelf in one line.
export const describeBoard = (board: Board): string => {
  const parked = board.shelf.filter(s => s.state === 'parked')
  const plan = describePlan(board.plan)

  return parked.length === 0 ? plan : `${plan}\nParked: ${parked.map(s => `"${s.plan.title}" (${progress(s.plan).done}/${progress(s.plan).total} done)`).join(', ')}`
}

// Runs one op: the new plan and the answer, or the refusal with the plan unchanged.
export const runOp = (board: Board, op: PlanOp, now: number): { board: Board; text: string; notice?: string } | { error: string } => {
  if (op.op === 'show') return { board, text: describeBoard(board) }
  const plan = board.plan
  const result =
    op.op === 'set'
      ? setBoard(board, op.title, op.nodes, op.previous, now)
      : op.op === 'resume'
        ? resumeBoard(board, op.title, op.previous, now)
        : op.op === 'cancel'
          ? cancelBoard(board, now)
          : settle(
              board,
              op.op === 'next'
                ? nextStep(plan, op.id, now)
                : op.op === 'update'
                  ? updateNodes(plan, op.updates, now)
                  : op.op === 'add'
                    ? addNodes(plan, op.parent, op.nodes, now)
                    : op.op === 'move'
                      ? moveNode(plan, op.id, op.before, now)
                      : removeNode(plan, op.id, now),
              now,
            )
  if ('error' in result) return bad(result.error)
  const text = describeBoard(result.board)

  return result.notice === undefined ? { board: result.board, text } : { board: result.board, text: `${result.notice}\n${text}`, notice: result.notice }
}
