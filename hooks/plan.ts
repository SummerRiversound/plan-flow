// The plan as data: a flat node list in tree order with path ids, and pure
// operations on it. Each operation answers `{ plan }` or `{ error }` and throws
// nothing; one that fails leaves the plan as it was.
//
// Levels: stage, task, checkpoint. A `parallel` node is a group, not a level of its
// own: its children sit at the group's level and run at the same time, and the
// step after the group waits for all of them.
import type { Plan, PlanNode, PlanStatus, Summary } from '../types'
import { clean } from './sanitize'

export type { Plan, PlanNode, PlanStatus }

export const MAX_LEVELS = 3
// Steps under a finished top-level stage do not count: a long session keeps room.
export const MAX_NODES = 100
export const MAX_TITLE = 120
export const MAX_NOTE = 200
export const MAX_DETAIL = 160
export const MAX_RESULT = 300
export const MAX_LINKS = 5
const MAX_LINK = 2048

export type PlanInput = { title: string; detail?: string; links?: readonly string[]; parallel?: boolean; children?: PlanInput[] }
export type NodeUpdate = { id: string; status?: PlanStatus; title?: string; note?: string; detail?: string; links?: readonly string[]; parallel?: boolean }
export type PlanResult = { plan: Plan } | { error: string }

export const STATUSES: readonly PlanStatus[] = ['pending', 'in_progress', 'completed', 'blocked', 'skipped', 'needs_check']

export const emptyPlan = (): Plan => ({ title: '', nodes: [], lastChild: {}, startedAt: 0 })

export const isFinished = (s: PlanStatus): boolean => s === 'completed' || s === 'skipped' || s === 'needs_check'

export const childrenOf = (nodes: readonly PlanNode[], id: string | null): PlanNode[] => nodes.filter(n => n.parentId === id)

export const hasChildren = (nodes: readonly PlanNode[], id: string): boolean => nodes.some(n => n.parentId === id)

export const leavesOf = (plan: Plan): PlanNode[] => plan.nodes.filter(n => !hasChildren(plan.nodes, n.id))

// The steps the cap counts: all but those under a top-level stage whose every leaf is finished.
export const countedNodes = (nodes: readonly PlanNode[]): number => {
  const doneStages = nodes.filter(n => n.parentId === null && hasChildren(nodes, n.id) && leavesUnder(nodes, n.id).every(l => isFinished(l.status)))

  return nodes.filter(n => !doneStages.some(s => n.id.startsWith(`${s.id}.`))).length
}

// The leaves at or under `id`, in tree order.
export const leavesUnder = (nodes: readonly PlanNode[], id: string): PlanNode[] =>
  nodes.filter(n => (n.id === id || n.id.startsWith(`${id}.`)) && !hasChildren(nodes, n.id))

const ancestorIds = (id: string): string[] => {
  const parts = id.split('.')

  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.'))
}

const idList = (plan: Plan): string => (plan.nodes.length === 0 ? 'the plan has no steps' : `valid ids: ${plan.nodes.map(n => n.id).join(', ')}`)

const text = (label: string, raw: unknown, max: number, mayBeEmpty: boolean): { value: string } | { error: string } => {
  if (typeof raw !== 'string') return { error: `${label} must be text` }
  const value = clean(raw)
  if (value === '' && !mayBeEmpty) return { error: `${label} is empty` }
  if (value.length > max) return { error: `${label} is longer than ${max} characters` }

  return { value }
}

// Links added after a step's own, in order and without repeats; an empty list clears them.
const joinLinks = (have: readonly string[] | undefined, add: readonly unknown[]): { value: string[] } | { error: string } => {
  if (add.length === 0) return { value: [] }
  const out = [...(have ?? [])]
  for (const raw of add) {
    const t = text('a link', raw, MAX_LINK, false)
    if ('error' in t) return t
    if (/\s/.test(t.value)) return { error: `a link has no spaces: "${t.value}"` }
    if (!out.includes(t.value)) out.push(t.value)
  }

  return out.length > MAX_LINKS ? { error: `a step holds at most ${MAX_LINKS} links` } : { value: out }
}

// Turns nested input into nodes under `parentId`. `level` is the level the input sits at;
// a group passes its own level on to its children.
const build = (
  input: readonly PlanInput[],
  parentId: string | null,
  level: number,
  lastChild: Record<string, number>,
): { nodes: PlanNode[] } | { error: string } => {
  const out: PlanNode[] = []
  for (const item of input) {
    const title = text('a step title', item?.title, MAX_TITLE, false)
    if ('error' in title) return title
    if (level > MAX_LEVELS) return { error: `"${title.value}" is too deep: a plan has at most ${MAX_LEVELS} levels (stage, task, checkpoint); a parallel group does not count as one` }
    const key = parentId ?? ''
    const n = (lastChild[key] ?? 0) + 1
    lastChild[key] = n
    const id = parentId === null ? `${n}` : `${parentId}.${n}`
    const node: PlanNode = { id, parentId, title: title.value, status: 'pending' }
    if (item.detail !== undefined) {
      const detail = text('a step detail', item.detail, MAX_DETAIL, true)
      if ('error' in detail) return detail
      if (detail.value !== '') node.detail = detail.value
    }
    if (item.links !== undefined) {
      const links = joinLinks(undefined, item.links)
      if ('error' in links) return links
      if (links.value.length > 0) node.links = links.value
    }
    const kids = item.children ?? []
    if (item.parallel === true) {
      if (kids.length === 0) return { error: `"${title.value}" is parallel but has no children; parallel marks a group of steps` }
      node.parallel = true
    }
    out.push(node)
    if (kids.length > 0) {
      const made = build(kids, id, node.parallel === true ? level : level + 1, lastChild)
      if ('error' in made) return made
      out.push(...made.nodes)
    }
  }

  return { nodes: out }
}

// The level `id` would give its children: one deeper than the parent, except under a group.
const levelUnder = (nodes: readonly PlanNode[], parentId: string | null): number => {
  if (parentId === null) return 1
  const chain = [...ancestorIds(parentId), parentId]

  return 1 + chain.filter(id => nodes.find(n => n.id === id)?.parallel !== true).length
}

// Parents follow their children: running if any child runs, blocked if any is blocked,
// waiting for a check once all are finished and some wait for one, completed once all are
// finished, running once some are, else pending. A parent's
// times span its children's.
export const rollup = (plan: Plan): Plan => {
  const nodes = plan.nodes.map(n => ({ ...n }))
  const deepestFirst = [...nodes].filter(n => hasChildren(nodes, n.id)).sort((a, b) => b.id.split('.').length - a.id.split('.').length)
  for (const parent of deepestFirst) {
    const kids = childrenOf(nodes, parent.id)
    const s = kids.map(k => k.status)
    parent.status = s.includes('in_progress')
      ? 'in_progress'
      : s.includes('blocked')
        ? 'blocked'
        : s.every(isFinished)
          ? s.includes('needs_check')
            ? 'needs_check'
            : 'completed'
          : s.some(isFinished)
            ? 'in_progress'
            : 'pending'
    const starts = kids.flatMap(k => (k.startedAt === undefined ? [] : [k.startedAt]))
    const ends = kids.flatMap(k => (k.doneAt === undefined ? [] : [k.doneAt]))
    if (starts.length > 0) parent.startedAt = Math.min(...starts)
    else delete parent.startedAt
    if (parent.status === 'completed' && ends.length > 0) parent.doneAt = Math.max(...ends)
    else delete parent.doneAt
  }

  return { ...plan, nodes }
}

// Moves a leaf to `status`, stamping when it starts and when it is done.
const setStatus = (node: PlanNode, status: PlanStatus, now: number): void => {
  if (status === 'in_progress' && node.startedAt === undefined) node.startedAt = now
  if (status === 'completed') node.doneAt = now
  else delete node.doneAt
  if (status === 'pending') delete node.startedAt
  node.status = status
}

// Two leaves may run at once only when the nearest parent they share is a parallel group.
const canRunTogether = (plan: Plan, a: string, b: string): boolean => {
  const up = new Set(ancestorIds(a))
  const shared = ancestorIds(b).reverse().find(id => up.has(id))

  return shared !== undefined && plan.nodes.find(n => n.id === shared)?.parallel === true
}

const running = (plan: Plan): PlanNode[] => leavesOf(plan).filter(n => n.status === 'in_progress')

const concurrencyError = (plan: Plan): string | null => {
  const active = running(plan)
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      if (a !== undefined && b !== undefined && !canRunTogether(plan, a.id, b.id)) {
        return `"${a.id}" and "${b.id}" cannot both be in_progress: only steps under the same parallel group run at once. Finish one first`
      }
    }
  }

  return null
}

const guarded = (op: () => PlanResult): PlanResult => {
  try {
    return op()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'the plan input could not be read' }
  }
}

// Finished leaves of `prev`, by lower-cased title, oldest first.
const finishedByTitle = (prev: Plan): Map<string, PlanNode[]> => {
  const out = new Map<string, PlanNode[]>()
  for (const leaf of leavesOf(prev).filter(n => isFinished(n.status))) {
    const key = leaf.title.toLowerCase()
    out.set(key, [...(out.get(key) ?? []), leaf])
  }

  return out
}

// A new plan. Resent under the title it already has, it is the same plan revised: every
// leaf whose title matches a finished one keeps that one's status, note and times.
export const setPlan = (prev: Plan, rawTitle: string, input: readonly PlanInput[], now: number): PlanResult =>
  guarded(() => {
    const title = text('the plan title', rawTitle, MAX_TITLE, false)
    if ('error' in title) return title
    if (!Array.isArray(input) || input.length === 0) return { error: 'the plan has no steps' }
    const lastChild: Record<string, number> = {}
    const made = build(input, null, 1, lastChild)
    if ('error' in made) return made
    // shortcut: a whole plan sent at once counts every step, finished or not; count like addNodes if long sessions resend whole plans.
    if (made.nodes.length > MAX_NODES) return { error: `the plan has ${made.nodes.length} steps; at most ${MAX_NODES} fit` }
    const same = prev.nodes.length > 0 && prev.title.toLowerCase() === title.value.toLowerCase()
    if (same) {
      const finished = finishedByTitle(prev)
      for (const node of made.nodes) {
        if (hasChildren(made.nodes, node.id)) continue
        const was = finished.get(node.title.toLowerCase())?.shift()
        if (was === undefined) continue
        node.status = was.status
        if (was.note !== undefined) node.note = was.note
        if (was.startedAt !== undefined) node.startedAt = was.startedAt
        if (was.doneAt !== undefined) node.doneAt = was.doneAt
      }
    }

    return { plan: rollup({ title: title.value, nodes: made.nodes, lastChild, startedAt: same ? prev.startedAt : now }) }
  })

// New steps go after the last step under `parentId`, in the order given; each added
// subtree is marked new. A running leaf that gains children hands its run to the first.
export const addNodes = (prev: Plan, parentId: string | null, input: readonly PlanInput[], now: number): PlanResult =>
  guarded(() => {
    if (!Array.isArray(input) || input.length === 0) return { error: 'no steps to add' }
    if (parentId !== null && !prev.nodes.some(n => n.id === parentId)) return { error: `unknown parent "${clean(parentId)}"; ${idList(prev)}` }
    const lastChild = { ...prev.lastChild }
    // A node that exists counts as handed out even if lastChild never saw it.
    for (const n of childrenOf(prev.nodes, parentId)) {
      const last = Number(n.id.split('.').pop())
      if (last > (lastChild[parentId ?? ''] ?? 0)) lastChild[parentId ?? ''] = last
    }
    const made = build(input, parentId, levelUnder(prev.nodes, parentId), lastChild)
    if ('error' in made) return made
    const nodes = prev.nodes.map(n => ({ ...n }))
    const counted = countedNodes(nodes) + made.nodes.length
    if (counted > MAX_NODES) return { error: `the plan would have ${counted} open steps; at most ${MAX_NODES} fit (steps under finished stages do not count)` }
    const at = parentId === null ? nodes.length : lastUnder(nodes, parentId) + 1
    nodes.splice(at, 0, ...made.nodes)
    const parent = parentId === null ? undefined : nodes.find(n => n.id === parentId)
    const first = made.nodes.find(n => !hasChildren(made.nodes, n.id))
    if (parent?.status === 'in_progress' && !hasChildren(prev.nodes, parent.id) && first !== undefined) {
      first.status = 'in_progress'
      if (parent.startedAt !== undefined) first.startedAt = parent.startedAt
    }
    const marks = { ...prev.marks }
    for (const n of made.nodes.filter(n => n.parentId === parentId)) marks[n.id] = 'new'
    // A leaf that gains children stops being a leaf: its own status and times go.
    const plan = rollup({ ...prev, nodes, lastChild, marks })
    if (prev.nodes.length === 0) plan.startedAt = now

    return { plan }
  })

// Index of the last node at or under `id` (the list is in tree order, so a subtree is a run).
const lastUnder = (nodes: readonly PlanNode[], id: string): number => {
  let last = nodes.findIndex(n => n.id === id)
  while (last + 1 < nodes.length && nodes[last + 1]?.id.startsWith(`${id}.`)) last++

  return last
}

// Moves a step, with everything under it, before its sibling `before`, or after the last sibling.
export const moveNode = (prev: Plan, id: string, before: string | undefined, _now: number): PlanResult =>
  guarded(() => {
    const node = prev.nodes.find(n => n.id === id)
    if (node === undefined) return { error: `unknown id "${clean(String(id))}"; ${idList(prev)}` }
    const sibs = childrenOf(prev.nodes, node.parentId).filter(n => n.id !== id)
    if (before !== undefined && !sibs.some(n => n.id === before)) {
      return { error: `"${clean(String(before))}" is not a sibling of "${id}"; steps move among their siblings (${sibs.map(n => n.id).join(', ') || 'none'})` }
    }
    const nodes = prev.nodes.map(n => ({ ...n }))
    const from = nodes.findIndex(n => n.id === id)
    const block = nodes.splice(from, lastUnder(prev.nodes, id) - from + 1)
    const lastSib = sibs[sibs.length - 1]
    const at = before !== undefined ? nodes.findIndex(n => n.id === before) : lastSib === undefined ? from : lastUnder(nodes, lastSib.id) + 1
    nodes.splice(at, 0, ...block)

    return { plan: rollup({ ...prev, nodes }) }
  })

// The marks a new request starts without.
export const clearMarks = (plan: Plan): Plan => {
  if (plan.marks === undefined) return plan
  const { marks: _marks, ...rest } = plan

  return rest
}

// All updates apply or none does. Status is set on leaves only; `note: ''` clears a note.
export const updateNodes = (prev: Plan, updates: readonly NodeUpdate[], now: number): PlanResult =>
  guarded(() => {
    if (!Array.isArray(updates) || updates.length === 0) return { error: 'no updates given' }
    const nodes = prev.nodes.map(n => ({ ...n }))
    const marks = { ...prev.marks }
    for (const u of updates) {
      const node = nodes.find(n => n.id === u.id)
      if (node === undefined) return { error: `unknown id "${clean(String(u.id))}"; ${idList(prev)}` }
      const isParent = hasChildren(nodes, node.id)
      if (u.status !== undefined) {
        if (!STATUSES.includes(u.status)) return { error: `unknown status "${clean(String(u.status))}"; use ${STATUSES.join(', ')}` }
        // Reopening a parent reopens every finished leaf under it.
        if (isParent && u.status !== 'pending') return { error: `"${node.id}" has children, so its status follows them; update a leaf, or set "pending" to reopen all of it` }
        const leaves = isParent ? leavesUnder(nodes, node.id).filter(n => isFinished(n.status)) : [node]
        if (leaves.some(n => isFinished(n.status)) && !isFinished(u.status)) marks[node.id] = 'redo'
        for (const leaf of leaves) setStatus(leaf, u.status, now)
      }
      if (u.title !== undefined) {
        const t = text('a step title', u.title, MAX_TITLE, false)
        if ('error' in t) return t
        node.title = t.value
      }
      if (u.note !== undefined) {
        const t = text('a note', u.note, MAX_NOTE, true)
        if ('error' in t) return t
        if (t.value === '') delete node.note
        else node.note = t.value
      }
      if (u.detail !== undefined) {
        const t = text('a step detail', u.detail, MAX_DETAIL, true)
        if ('error' in t) return t
        if (t.value === '') delete node.detail
        else node.detail = t.value
      }
      if (u.links !== undefined) {
        const links = joinLinks(node.links, u.links)
        if ('error' in links) return links
        if (links.value.length === 0) delete node.links
        else node.links = links.value
      }
      if (u.parallel === true) {
        if (!isParent) return { error: `"${node.id}" has no children, so it cannot be a parallel group` }
        node.parallel = true
      } else if (u.parallel === false) delete node.parallel
    }
    const plan = rollup({ ...prev, nodes, marks })
    const clash = concurrencyError(plan)

    return clash === null ? { plan } : { error: clash }
  })

export const removeNode = (prev: Plan, id: string, _now: number): PlanResult =>
  guarded(() => {
    const node = prev.nodes.find(n => n.id === id)
    if (node === undefined) return { error: `unknown id "${clean(String(id))}"; ${idList(prev)}` }
    const nodes = prev.nodes.filter(n => n.id !== id && !n.id.startsWith(`${id}.`)).map(n => ({ ...n }))
    // A parent left with no children is a leaf again, waiting.
    const parent = node.parentId === null ? undefined : nodes.find(n => n.id === node.parentId)
    if (parent !== undefined && !hasChildren(nodes, parent.id)) {
      parent.status = 'pending'
      delete parent.parallel
      delete parent.startedAt
      delete parent.doneAt
    }

    return { plan: rollup({ ...prev, nodes }) }
  })

// Starts `leaf`, and every branch of each parallel group it enters that has nothing
// running yet, so a group starts as one.
const start = (plan: Plan, leaf: PlanNode, now: number): void => {
  setStatus(leaf, 'in_progress', now)
  for (const groupId of ancestorIds(leaf.id)) {
    const group = plan.nodes.find(n => n.id === groupId)
    if (group?.parallel !== true) continue
    for (const branch of childrenOf(plan.nodes, groupId)) {
      if (leaf.id === branch.id || leaf.id.startsWith(`${branch.id}.`)) continue
      const under = leavesUnder(plan.nodes, branch.id)
      if (under.some(n => n.status === 'in_progress')) continue
      const first = under.find(n => n.status === 'pending')
      if (first !== undefined) start(plan, first, now)
    }
  }
}

// "This step is done, start the next": the running leaf (`id`, else the first one running)
// is completed, then the first waiting leaf in tree order that may run beside whatever
// still runs is started. With nothing running, it only starts the first waiting leaf.
export const nextStep = (prev: Plan, id: string | undefined, now: number): PlanResult =>
  guarded(() => {
    const plan: Plan = { ...prev, nodes: prev.nodes.map(n => ({ ...n })) }
    const active = running(plan)
    if (id !== undefined) {
      const node = plan.nodes.find(n => n.id === id)
      if (node === undefined) return { error: `unknown id "${clean(String(id))}"; ${idList(prev)}` }
      if (!active.includes(node)) return { error: `"${node.id}" is not in_progress; next finishes a running leaf (running: ${active.map(n => n.id).join(', ') || 'none'})` }
    }
    const done = id === undefined ? active[0] : active.find(n => n.id === id)
    if (done !== undefined) setStatus(done, 'completed', now)
    const still = running(plan)
    const candidate = leavesOf(plan).find(n => n.status === 'pending' && still.every(r => canRunTogether(plan, r.id, n.id)))
    if (done === undefined && candidate === undefined) return { error: 'nothing left to start: every step is finished or blocked' }
    if (candidate !== undefined) start(plan, candidate, now)

    return { plan: rollup(plan) }
  })

// Leaves finished (completed, skipped or waiting for a check) out of all leaves.
export const progress = (plan: Plan): { done: number; total: number } => {
  const all = leavesOf(plan)

  return { done: all.filter(n => isFinished(n.status)).length, total: all.length }
}

// The leaf Claude is on: the first running, else the first waiting, else the first blocked.
export const currentLeaf = (plan: Plan): PlanNode | null => {
  const all = leavesOf(plan)

  return all.find(n => n.status === 'in_progress') ?? all.find(n => n.status === 'pending') ?? all.find(n => n.status === 'blocked') ?? null
}

export const runningLeaves = running

// Leaves waiting for the person to check, in tree order.
export const checksOf = (plan: Plan): PlanNode[] => leavesOf(plan).filter(n => n.status === 'needs_check')

// Open work: a leaf waiting, running or blocked.
export const hasOpenWork = (plan: Plan): boolean => leavesOf(plan).some(n => !isFinished(n.status))

// When the last leaf finished, or null while work is open.
export const finishedAt = (plan: Plan): number | null => {
  if (plan.nodes.length === 0 || hasOpenWork(plan)) return null

  return Math.max(plan.startedAt, ...leavesOf(plan).map(n => n.doneAt ?? 0))
}

// The closing note on what an op made of the plan: `summary` is taken only once no step is
// open, and a note left from before goes when a step opens again.
export const closing = (r: PlanResult, summary?: { goal: unknown; result: unknown }): PlanResult => {
  if ('error' in r) return r
  if (summary === undefined) {
    if (!hasOpenWork(r.plan) || r.plan.summary === undefined) return r
    const { summary: _gone, ...plan } = r.plan
    return { plan }
  }
  if (hasOpenWork(r.plan)) return { error: 'a summary goes with the op that finishes the last step, and steps are still open' }
  const goal = text('summary.goal', summary.goal, MAX_DETAIL, false)
  if ('error' in goal) return goal
  const result = text('summary.result', summary.result, MAX_RESULT, false)
  if ('error' in result) return result
  const note: Summary = { goal: goal.value, result: result.value }

  return { plan: { ...r.plan, summary: note } }
}
