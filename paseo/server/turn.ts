import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types'
import { runOp } from '../shared/plan-tool'
import { REPLAY_SYSTEM, replayDesignPrompt, runDesign } from '../shared/planner'
import { type Hand, leftOff, planKey, startsNext } from '../shared/schedule'
import type { Board } from '../shared/types'
import type { Printed } from './ask'
import { type Ask, look } from './look'
import { happenedFrom } from './timeline'

// What the designs of one agent may cost; past it the planner alone keeps the board. Replayed over
// five sessions, a design cost about $0.05; the longest of them reached $1.
export const DESIGN_BUDGET_USD = 2
// How long an agent rests after a turn that did work before the plan is designed: the person looks at
// the board when the agent stops, and a turn's one look misses what the mod's looks during the work see.
export const SETTLE_MS = 180_000
const KEPT_CALLS = 50

// One design call: when, how long, how it ended, and what it read, wrote and cost.
export type DesignCall = { at: number; ms: number; result: 'answered' | 'no answer' | 'over budget'; ops?: number; input?: number; output?: number; cost?: number }
// Where an agent's designs stand: the plan in hand at the last answer, a design that gave no answer
// and is owed, what the designs cost so far, and the newest calls.
export type DesignState = { hand: Hand; owed: boolean; spent: number; calls: DesignCall[] }
export const freshDesign = (): DesignState => ({ hand: { key: '', startedAt: 0 }, owed: false, spent: 0, calls: [] })

export type TurnDeps = {
  look: Ask
  design: (system: string, prompt: string) => Promise<Printed | null>
  // The session so far, one list of timeline items per turn, oldest first.
  session: () => Promise<readonly (readonly AgentTimelineItem[])[]>
  now: () => number
}

// After an agent's turn: the planner looks at it, and when the turn did work and the board was left
// off (the look changed nothing, an older plan came back from the shelf, or a design is owed), a
// model that reads the session's log designs the plan, within the agent's budget: the mod's rules. A
// turn that did work and was not designed is designed once the agent rests (SETTLE_MS).
// The design runs before the next turn's look, so no look lands between the board it read and its ops.
// `settles`: the turn did work on a plan and no design followed it, so one is due once the agent rests.
export const afterTurn = async (board: Board, state: DesignState, turn: readonly AgentTimelineItem[], deps: TurnDeps): Promise<{ board: Board; design: DesignState; looked: number | null; settles: boolean }> => {
  const r = await look(board, turn, deps.look, deps.now())
  let next = r?.board ?? board
  // Work is a call Claude ran; a prompt from another agent or a task's notice comes as a call but is news.
  const worked = happenedFrom(turn).some(h => h.kind === 'tool')
  const offBoard = leftOff(next.plan, state.hand, r !== null && r.applied === 0, state.owed)
  const design: DesignState = { ...state, hand: { key: planKey(next.plan), startedAt: next.plan.startedAt ?? 0 } }
  const looked = r?.applied ?? null
  if (!worked || next.plan.nodes.length === 0) return { board: next, design, looked, settles: false }
  if (!offBoard) return { board: next, design, looked, settles: true }

  return { ...(await designNow(next, design, deps)), looked, settles: false }
}

// The design asked now, within the agent's budget: it reads the session's log and reshapes the plan.
export const designNow = async (board: Board, state: DesignState, deps: TurnDeps): Promise<{ board: Board; design: DesignState }> => {
  let next = board
  let design = state
  const at = deps.now()
  const record = (call: DesignCall): DesignState => ({ ...design, calls: [...design.calls, call].slice(-KEPT_CALLS) })
  if (design.spent >= DESIGN_BUDGET_USD) return { board: next, design: record({ at, ms: 0, result: 'over budget' }) }

  const log = (await deps.session()).flatMap(t => happenedFrom(t, true))
  const p = await deps.design(REPLAY_SYSTEM, replayDesignPrompt(next, log))
  const ms = deps.now() - at
  if (p === null) {
    design = { ...design, owed: true }
    return { board: next, design: record({ at, ms, result: 'no answer' }) }
  }
  const ran = runDesign(next, p.text, deps.now())
  next = ran.board
  if (startsNext(next.plan)) {
    const r2 = runOp(next, { op: 'next' }, deps.now())
    if (!('error' in r2)) next = r2.board
  }
  design = { ...design, owed: false, spent: design.spent + p.cost }

  return { board: next, design: record({ at, ms, result: 'answered', ops: ran.applied, input: p.input, output: p.output, cost: p.cost }) }
}
