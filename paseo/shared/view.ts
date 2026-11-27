// The plan panel as data: stages on one axis, a parallel stage split into stages side by side,
// each open box holding its tasks. Pure, so the rules are tested without React Native; the
// fold and count rules are the mod drawer's, from plan.ts. The server reads summaryOf for the pill and badges.
import type { Plan, PlanNode, PlanStatus } from './types'
import { childrenOf, currentLeaf, checksOf, defaultOpen, hasChildren, hasOpenWork, progress, unitCount } from './plan'

export type ViewStep = {
  id: string
  title: string
  status: PlanStatus
  // Has steps under it; `open` when they show.
  parent: boolean
  open: boolean
  // A box's finished units out of all of them (`1/3`); null for a step with nothing under it.
  count: string | null
  detail?: string
  note?: string
  links: string[]
  // Reopened by this request.
  redo: boolean
  children: ViewItem[]
}

// A step, or tasks that run together.
export type ViewItem = { kind: 'step'; step: ViewStep } | { kind: 'together'; items: ViewItem[] }

export type ViewAxis =
  | { kind: 'stage'; stage: ViewStep }
  | { kind: 'split'; stages: ViewStep[] }
  | { kind: 'summary'; goal: string; result: string; links: string[] }
  | { kind: 'expected'; title: string }

// The folds the person made, by node id: true open, false folded. A box they never touched follows the plan.
export type Folds = Readonly<Record<string, boolean>>

const step = (plan: Plan, folds: Folds, shown: Set<string>, n: PlanNode): ViewStep => {
  const parent = hasChildren(plan.nodes, n.id)
  const open = parent && (folds[n.id] ?? shown.has(n.id))
  const detail = n.detail !== undefined && (open || n.status === 'in_progress') ? n.detail : undefined

  return {
    id: n.id,
    title: n.title,
    status: n.status,
    parent,
    open,
    count: parent ? unitCount(plan, n.id) : null,
    ...(detail === undefined ? {} : { detail }),
    ...(n.note === undefined || n.note === '' ? {} : { note: n.note }),
    links: parent && !open ? [] : (n.links ?? []),
    redo: plan.marks?.[n.id] === 'redo',
    children: open ? items(plan, folds, shown, n.id) : [],
  }
}

const items = (plan: Plan, folds: Folds, shown: Set<string>, id: string): ViewItem[] =>
  childrenOf(plan.nodes, id).map(n => (n.parallel === true ? { kind: 'together', items: items(plan, folds, shown, n.id) } : { kind: 'step', step: step(plan, folds, shown, n) }))

export const axisOf = (plan: Plan, folds: Folds): ViewAxis[] => {
  const shown = defaultOpen(plan)
  const axis: ViewAxis[] = childrenOf(plan.nodes, null).map(n =>
    n.parallel === true ? { kind: 'split', stages: childrenOf(plan.nodes, n.id).map(c => step(plan, folds, shown, c)) } : { kind: 'stage', stage: step(plan, folds, shown, n) },
  )
  const s = plan.summary
  if (s !== undefined && !hasOpenWork(plan)) axis.push({ kind: 'summary', goal: s.goal, result: s.result, links: [...new Set(plan.nodes.flatMap(n => n.links ?? []))] })
  for (const title of plan.expected ?? []) axis.push({ kind: 'expected', title })

  return axis
}

export type Head = { title: string; goal?: string; done: number; total: number; pct: number; current: string | null; checks: number }

export const headOf = (plan: Plan): Head => {
  const { done, total } = progress(plan)

  return {
    title: plan.title,
    ...(plan.goal === undefined ? {} : { goal: plan.goal }),
    done,
    total,
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
    current: hasOpenWork(plan) ? (currentLeaf(plan)?.title ?? null) : null,
    checks: checksOf(plan).length,
  }
}

// The agent as Paseo reports it; the plan alone cannot tell working from waiting.
export type AgentState = { status: 'initializing' | 'idle' | 'running' | 'error' | 'closed'; attentionReason: 'finished' | 'error' | 'permission' | null }
// `turn`: Claude stopped with work open, so the next move is the person's.
export type Now = { kind: 'running' | 'turn' | 'permission' | 'error'; step?: string } | { kind: 'done' }

export const nowOf = (plan: Plan, agent: AgentState): Now => {
  if (!hasOpenWork(plan) && agent.status !== 'running') return { kind: 'done' }
  const leaf = hasOpenWork(plan) ? currentLeaf(plan) : null
  const at = leaf === null ? {} : { step: leaf.title }
  if (agent.attentionReason === 'permission') return { kind: 'permission', ...at }
  if (agent.status === 'error') return { kind: 'error', ...at }

  return { kind: agent.status === 'running' ? 'running' : 'turn', ...at }
}

// What the pill above the composer and the workspace badge say about one board.
export type Summary = { title: string; done: number; total: number; current: string | null; open: boolean }

export const summaryOf = (plan: Plan): Summary | null => {
  if (plan.nodes.length === 0) return null
  const h = headOf(plan)

  return { title: h.title, done: h.done, total: h.total, current: h.current, open: hasOpenWork(plan) }
}
