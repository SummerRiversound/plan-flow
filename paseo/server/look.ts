import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types'
import { runOp } from '../shared/plan-tool'
import { type Happened, PLANNER_SYSTEM, parseOps, plannerPrompt, remember } from '../shared/planner'
import { startsNext } from '../shared/schedule'
import type { Board } from '../shared/types'
import { happenedFrom } from './timeline'

// The planner's model call: its answer text, or null when it gave none.
export type Ask = (system: string, prompt: string) => Promise<string | null>

// One look, as the mod's: the board and one turn's events to the planner, then its ops on the board.
// Null when the planner gave no answer, so the board stays as it was.
export const look = async (board: Board, turn: readonly AgentTimelineItem[], ask: Ask, now: number): Promise<{ board: Board; applied: number } | null> => {
  const log = happenedFrom(turn).reduce<Happened[]>(remember, [])
  if (log.length === 0) return { board, applied: 0 }
  const text = await ask(PLANNER_SYSTEM, plannerPrompt(board, log))
  if (text === null) return null
  let next = board
  let applied = 0
  for (const op of parseOps(text)) {
    const r = runOp(next, op, now)
    if ('error' in r) continue
    next = r.board
    applied++
  }
  if (startsNext(next.plan)) {
    const r = runOp(next, { op: 'next' }, now)
    if (!('error' in r)) next = r.board
  }

  return { board: next, applied }
}
