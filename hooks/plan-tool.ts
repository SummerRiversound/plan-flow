// The tool Claude keeps the plan with: its description and schema, reading its
// untrusted input, running an op on the plan, and the plain text it answers.
import type { NodeUpdate, Plan, PlanInput } from './plan'
import { addNodes, MAX_NOTE, MAX_TITLE, nextStep, progress, removeNode, setPlan, STATUSES, updateNodes } from './plan'
import { clean } from './sanitize'

export const TOOL_NAME = 'plan'
export const OPS = ['set', 'next', 'update', 'add', 'remove', 'show'] as const
export type OpName = (typeof OPS)[number]

export type PlanOp =
  | { op: 'set'; title: string; nodes: PlanInput[] }
  | { op: 'next'; id?: string }
  | { op: 'update'; updates: NodeUpdate[] }
  | { op: 'add'; parent: string | null; nodes: PlanInput[] }
  | { op: 'remove'; id: string }
  | { op: 'show' }

export const ANSWER_LIMIT = 4000

export const TOOL_DESCRIPTION = [
  'The plan board for the current task; the person watches it on screen while you work.',
  'op "set" starts it: a title and the steps, nested as stages, tasks and checkpoints (3 levels at most).',
  'Steps that do not depend on each other go under one node with "parallel": true and are worked on together; the step after the group waits for all of them.',
  'op "next" says the running step is done and starts the one after it (give "id" when several run and a particular one finished).',
  'op "update" changes steps by id: status, title, or a note (say why a step is blocked or skipped).',
  'op "add" puts new steps under "parent" (or at the top), op "remove" drops a step with everything under it, op "show" answers the plan with its ids.',
  'A step with children takes its status from them, so only leaves get a status.',
].join(' ')

// JSON Schema, written out level by level because it may not use $ref. Groups do not
// count as levels, so the nesting goes deeper than three.
type Schema = Record<string, unknown>
const stepSchema = (depth: number): Schema => {
  const properties: Record<string, Schema> = {
    title: { type: 'string', description: `At most 4 words, in the user's language (${MAX_TITLE} characters at most)` },
    parallel: { type: 'boolean', description: 'This node groups steps that run at the same time' },
  }
  if (depth > 1) properties.children = { type: 'array', items: stepSchema(depth - 1) }

  return { type: 'object', properties, required: ['title'] }
}

export const TOOL_SCHEMA: Schema = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: [...OPS] },
    title: { type: 'string', description: 'The task, for op set' },
    nodes: { type: 'array', description: 'Steps, for op set and add', items: stepSchema(5) },
    parent: { type: 'string', description: 'Id to add under, for op add; leave out for the top level' },
    id: { type: 'string', description: 'For op remove: the step to drop. For op next: the running step that finished' },
    updates: {
      type: 'array',
      description: 'For op update',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: [...STATUSES] },
          title: { type: 'string' },
          note: { type: 'string', description: `Why, for blocked or skipped (${MAX_NOTE} characters at most); empty clears it` },
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
    `Plan board: for a task that needs more than a couple of tool calls, first call ${tool} with op "set": a short task title and its steps.`,
    "Every title is at most 4 words, in the user's language.",
    'Put steps that do not depend on each other under one node with "parallel": true and work on them together (several tool calls or agents in one message).',
    'When a step is done call op "next"; it finishes that step and starts the following one. Use op "update" for blocked or skipped steps, with a note saying why.',
    'The person sees the board drawn on screen, so never describe, list or redraw the plan in your reply.',
    'A plain question needs no plan.',
    `If the tool is not loaded yet, load it with ToolSearch (query "select:${tool}").`,
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
    const parallel = optionalFlag(item, 'parallel', here)
    if ('error' in parallel) return parallel
    if (parallel.value !== undefined) u.parallel = parallel.value
    out.push(u)
  }

  return { value: out }
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
      const nodes = readSteps(raw.nodes, 'nodes')

      return 'error' in nodes ? nodes : { op: { op, title: raw.title, nodes: nodes.value } }
    }
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

// Runs one op: the new plan and the answer, or the refusal with the plan unchanged.
export const runOp = (plan: Plan, op: PlanOp, now: number): { plan: Plan; text: string } | { error: string } => {
  if (op.op === 'show') return { plan, text: describePlan(plan) }
  const result =
    op.op === 'set'
      ? setPlan(plan, op.title, op.nodes, now)
      : op.op === 'next'
        ? nextStep(plan, op.id, now)
        : op.op === 'update'
          ? updateNodes(plan, op.updates, now)
          : op.op === 'add'
            ? addNodes(plan, op.parent, op.nodes, now)
            : removeNode(plan, op.id, now)
  if ('error' in result) return bad(result.error)

  return { plan: result.plan, text: describePlan(result.plan) }
}
