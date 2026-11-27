// When the planner's ops need a next step, when Claude is asked to design the plan, and whether a
// design still fits the plan in hand. Pure; the mod and the Paseo plugin decide by the same rules.
import { currentLeaf, hasOpenWork } from './plan'
import type { PlanOp } from './plan-tool'
import type { Plan } from './types'

// The planner often marks steps done without starting the next; open work keeps a step running, so it is drawn as running.
export const startsNext = (plan: Plan): boolean => hasOpenWork(plan) && currentLeaf(plan)?.status === 'pending'

// The planner started a plan or rewrote its goal: Claude is asked to design it.
export const asksDesign = (ops: readonly PlanOp[]): boolean => ops.some(op => op.op === 'set' || (op.op === 'update' && op.goal !== undefined))

// One plan among the session's: its start and title.
export const planKey = (plan: Plan): string => `${plan.startedAt ?? 0} ${plan.title}`

// The plan a design was asked about is still the one in hand: the same title and start, and every
// step it saw still under its id, since the design's ops name steps by id.
export const isSamePlan = (asked: Plan, now: Plan): boolean =>
  now.title === asked.title && now.startedAt === asked.startedAt && asked.nodes.every(n => now.nodes.find(m => m.id === n.id)?.title === n.title)

// The plan in hand at the last answer.
export type Hand = { key: string; startedAt: number }

// Whether an answer leaves the board off, so Claude is asked to set it right: an older plan than the
// one in hand came back from the shelf (as the planner left it, before the work done meanwhile), the
// look at this answer changed nothing, or a design asked before gave no answer.
export const leftOff = (plan: Plan, hand: Hand, idleLook: boolean, owed: boolean): boolean =>
  (planKey(plan) !== hand.key && (plan.startedAt ?? 0) < hand.startedAt) || idleLook || owed
