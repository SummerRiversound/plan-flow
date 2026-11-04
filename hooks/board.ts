// The session's board: the plan in hand and a shelf of plans set aside. A detour parks
// the plan in hand and it comes back when the detour ends; starting over cancels it.
// Pure: each op answers `{ board, notice? }` or `{ error }`, `notice` a line for the person.
import type { Board, Shelved } from '../types'
import type { Plan, PlanInput, PlanResult } from './plan'
import { clearMarks, emptyPlan, finishedAt, hasOpenWork, progress, setPlan } from './plan'
import { clean } from './sanitize'

export type { Board, Shelved }
export type Previous = 'park' | 'cancel'
export type BoardResult = { board: Board; notice?: string } | { error: string }

export const MAX_SHELF = 10

export const emptyBoard = (): Board => ({ plan: emptyPlan(), shelf: [] })

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const counted = (plan: Plan): string => {
  const { done, total } = progress(plan)

  return `"${plan.title}" (${done}/${total} done)`
}

// Newest first; past the cap the oldest finished or cancelled entries go before parked ones.
const shelve = (shelf: readonly Shelved[], plan: Plan, state: Shelved['state'], at: number): Shelved[] => {
  if (plan.nodes.length === 0) return [...shelf]
  const out = [{ plan: clearMarks(plan), state, at }, ...shelf]
  while (out.length > MAX_SHELF) {
    const oldestEnded = out.map(s => s.state !== 'parked').lastIndexOf(true)
    out.splice(oldestEnded === -1 ? out.length - 1 : oldestEnded, 1)
  }

  return out
}

// What happens to the plan in hand when another takes its place.
const outgoing = (plan: Plan, previous: Previous | undefined, action: string): { state: Shelved['state'] } | { error: string } => {
  if (!hasOpenWork(plan)) return { state: 'done' }
  if (previous === undefined) {
    return {
      error:
        `${counted(plan)} still has open steps. To ${action}, say what happens to it: previous "park" sets it aside to come back to ` +
        '(a detour, or other work the person chose to do here), previous "cancel" drops it (the person asked to start over). ' +
        'If the request continues this plan, use op "add" or "update" instead.',
    }
  }

  return { state: previous === 'park' ? 'parked' : 'cancelled' }
}

// A new plan in hand. Resent under the same title it is the same plan revised.
export const setBoard = (board: Board, title: string, nodes: readonly PlanInput[], previous: Previous | undefined, now: number): BoardResult => {
  const revised = board.plan.nodes.length > 0 && same(clean(title), board.plan.title)
  const made = setPlan(revised ? board.plan : emptyPlan(), title, nodes, now)
  if ('error' in made) return made
  if (revised || board.plan.nodes.length === 0) return { board: { ...board, plan: made.plan } }
  const out = outgoing(board.plan, previous, 'start a different plan')
  if ('error' in out) return out
  const verb = out.state === 'parked' ? '보관' : out.state === 'cancelled' ? '취소' : '완료'

  return { board: { plan: made.plan, shelf: shelve(board.shelf, board.plan, out.state, now) }, notice: `"${board.plan.title}" ${verb} · "${made.plan.title}" 시작` }
}

// A shelved plan back in hand: the one titled `title`, else the newest parked one.
export const resumeBoard = (board: Board, title: string | undefined, previous: Previous | undefined, now: number): BoardResult => {
  const at = title === undefined ? board.shelf.findIndex(s => s.state === 'parked') : board.shelf.findIndex(s => same(s.plan.title, clean(title)))
  const pick = board.shelf[at]
  if (pick === undefined) {
    const list = board.shelf.map(s => `${counted(s.plan)} ${s.state}`).join(', ')
    return { error: `${title === undefined ? 'no parked plan' : `no shelved plan titled "${clean(title)}"`}; the shelf holds: ${list || 'nothing'}` }
  }
  const out = outgoing(board.plan, previous, `resume "${pick.plan.title}"`)
  if ('error' in out) return out
  const shelf = board.shelf.filter((_, i) => i !== at)

  return { board: { plan: pick.plan, shelf: shelve(shelf, board.plan, out.state, now) }, notice: `"${pick.plan.title}" 다시 시작` }
}

// Drops the plan in hand; the newest parked plan, if any, comes back.
export const cancelBoard = (board: Board, now: number): BoardResult => {
  if (board.plan.nodes.length === 0) return { error: 'there is no plan in hand to cancel' }
  const shelf = shelve(board.shelf, board.plan, 'cancelled', now)
  const back = shelf.findIndex(s => s.state === 'parked')
  const pick = shelf[back]
  if (pick === undefined) return { board: { plan: emptyPlan(), shelf }, notice: `"${board.plan.title}" 취소` }

  return { board: { plan: pick.plan, shelf: shelf.filter((_, i) => i !== back) }, notice: `"${board.plan.title}" 취소 · "${pick.plan.title}"(으)로 돌아왔어요` }
}

// After a change to the plan in hand: once it is finished, the newest parked plan comes back.
export const settle = (board: Board, plan: PlanResult, now: number): BoardResult => {
  if ('error' in plan) return plan
  const next = { ...board, plan: plan.plan }
  const back = next.shelf.findIndex(s => s.state === 'parked')
  const pick = next.shelf[back]
  if (finishedAt(next.plan) === null || pick === undefined) return { board: next }
  const shelf = shelve(
    next.shelf.filter((_, i) => i !== back),
    next.plan,
    'done',
    now,
  )

  return { board: { plan: pick.plan, shelf }, notice: `"${next.plan.title}" 완료 · "${pick.plan.title}"(으)로 돌아왔어요` }
}
