// The drawer as cards, for surfaces that draw real boxes (the desktop app, the editor):
// the stages on one axis, a parallel stage split into cards side by side, each open card
// holding its tasks and checkpoints. Pure: register.tsx turns it into elements. The
// terminal keeps the character flowchart in drawer.ts.
import type { DrawerState } from '../types'
import type { Plan, PlanNode, PlanStatus } from './plan'
import { checksOf, childrenOf, hasChildren, hasOpenWork, isFinished, leavesOf, progress, runningLeaves } from './plan'
import type { Activity } from './activity'
import { activityLabel } from './activity'
import type { Seg } from './tree'
import { glyphColor, glyphSeg, noteText } from './tree'
import { ASK, CONFIRM, isOpen, stepRight } from './drawer'
import { t } from './i18n'

export type CardStep = {
  id: string
  title: string
  status: PlanStatus
  glyph: Seg
  running: boolean
  // A step just reopened.
  redo: boolean
  // Has steps under it; `open` when they show.
  parent: boolean
  open: boolean
  right: Seg | null
  detail?: string
  note?: string
  links: string[]
  // The buttons under a picked step.
  actions: Array<[string, string]>
  children: CardItem[]
}

// A step, or tasks that run together.
export type CardItem = { kind: 'step'; step: CardStep } | { kind: 'together'; items: CardItem[] }

export type AxisItem =
  | { kind: 'stage'; stage: CardStep }
  | { kind: 'split'; stages: CardStep[] }
  | { kind: 'summary'; goal: string; result: string; links: string[] }
  | { kind: 'expected'; title: string }

// The terminal draws these labels' brackets as text; a real button needs none.
const bare = (label: string): string => label.replace(/^\[ (.*) \]$/, '$1')

const step = (plan: Plan, drawer: DrawerState, n: PlanNode): CardStep => {
  const parent = hasChildren(plan.nodes, n.id)
  const open = parent && isOpen(plan, drawer, n.id)
  const picked = !parent && drawer.pick === n.id
  const running = n.status === 'in_progress'
  // As in the character drawer: the detail under an open box, a picked step and the running one.
  const detail = n.detail !== undefined && (open || picked || running) ? n.detail : undefined

  return {
    id: n.id,
    title: n.title,
    status: n.status,
    glyph: glyphSeg(n),
    running,
    redo: plan.marks?.[n.id] === 'redo',
    parent,
    open,
    right: stepRight(plan, drawer, n),
    ...(detail === undefined ? {} : { detail }),
    ...(n.note === undefined || n.note === '' ? {} : { note: n.note }),
    links: parent && !open ? [] : (n.links ?? []),
    actions: picked ? [...(n.status === 'needs_check' ? [[CONFIRM, bare(t().confirm)] as [string, string]] : []), [ASK, bare(t().discuss)]] : [],
    children: open ? items(plan, drawer, n.id) : [],
  }
}

const items = (plan: Plan, drawer: DrawerState, id: string): CardItem[] =>
  childrenOf(plan.nodes, id).map(n => (n.parallel === true ? { kind: 'together', items: items(plan, drawer, n.id) } : { kind: 'step', step: step(plan, drawer, n) }))

export const cardsOf = (plan: Plan, drawer: DrawerState): AxisItem[] => {
  const axis: AxisItem[] = childrenOf(plan.nodes, null).map(n =>
    n.parallel === true ? { kind: 'split', stages: childrenOf(plan.nodes, n.id).map(c => step(plan, drawer, c)) } : { kind: 'stage', stage: step(plan, drawer, n) },
  )
  const s = plan.summary
  if (s !== undefined && !hasOpenWork(plan)) axis.push({ kind: 'summary', goal: s.goal, result: s.result, links: [...new Set(plan.nodes.flatMap(n => n.links ?? []))] })
  if (hasOpenWork(plan)) for (const title of plan.expected ?? []) axis.push({ kind: 'expected', title })

  return axis
}

// The steps a press can reach, in drawing order: the keys of their Buttons.
export const cardButtons = (axis: readonly AxisItem[]): string[] => {
  const walk = (is: readonly CardItem[]): string[] => is.flatMap(i => (i.kind === 'step' ? [i.step.id, ...walk(i.step.children)] : walk(i.items)))
  const of = (s: CardStep) => [s.id, ...walk(s.children)]

  return axis.flatMap(a => (a.kind === 'stage' ? of(a.stage) : a.kind === 'split' ? a.stages.flatMap(of) : []))
}

// Done, waiting for a check, or skipped: drawn dim, as in the character drawer.
export const isDone = (s: CardStep): boolean => isFinished(s.status) && s.status !== 'needs_check'

// The drawer's head for the same surfaces: title, goal, one progress slot per step in plan
// order (done, waiting for a check, still to do), the steps to check and what Claude is doing.
export type ProgressSlot = 'done' | 'check' | 'todo'
export type CardHead = {
  title: string
  goal?: string
  done: number
  total: number
  pct: number
  parked: number
  slots: ProgressSlot[]
  checks: string[]
  activity?: { text: string; color: string }
}

export const headOf = (plan: Plan, parked: number, activity: Activity): CardHead => {
  const { done, total } = progress(plan)
  const words = activityLabel(activity)
  const run = runningLeaves(plan)[0]

  return {
    title: plan.title,
    ...(plan.goal === undefined ? {} : { goal: plan.goal }),
    done,
    total,
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
    parked,
    slots: leavesOf(plan).map(n => (n.status === 'needs_check' ? 'check' : isFinished(n.status) ? 'done' : 'todo')),
    checks: checksOf(plan).map(n => `${n.title}${noteText(n)}`),
    ...(words === undefined ? {} : { activity: { text: words, color: activity.phase === 'error' ? 'error' : run === undefined ? 'text' : glyphColor(run) } }),
  }
}
