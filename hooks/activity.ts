// What Claude is doing right now, as one line under the plan's progress. A pure
// reducer: register.tsx turns hook events into these and stores the result.
//
// Waiting on the person (a question, then a permission dialog) outranks compaction,
// which outranks a running tool, which outranks plain work. When the higher phase
// ends the line falls back to the newest running tool, else to work.
import type { Activity, ActivityPhase } from '../types'
import { clean } from './sanitize'
import { t } from './i18n'

export type { Activity, ActivityPhase }

export type ActivityEvent =
  | { type: 'turnStart' }
  | { type: 'turnEnd'; reason: string }
  | { type: 'toolStart'; id: string; tool: string }
  | { type: 'toolEnd'; id: string }
  | { type: 'permissionAsk'; tool: string }
  | { type: 'permissionEnd' }
  | { type: 'questionOpen' }
  | { type: 'questionClose' }
  | { type: 'compactStart' }
  | { type: 'compactEnd' }
  | { type: 'failure'; detail: string }

export const idleActivity = (): Activity => ({ phase: 'idle', running: [] })

const RANK: Record<ActivityPhase, number> = { idle: 0, interrupted: 0, error: 0, working: 1, tool: 2, compacting: 3, permission: 4, question: 5 }

const settled = (running: Activity['running']): Activity => {
  const last = running[running.length - 1]

  return last === undefined ? { phase: 'working', running } : { phase: 'tool', tool: last.tool, running }
}

const endOf = (a: Activity, phase: ActivityPhase): Activity => (a.phase === phase ? settled(a.running) : a)

export const step = (a: Activity, e: ActivityEvent): Activity => {
  const running = Array.isArray(a.running) ? a.running : []
  switch (e.type) {
    case 'turnStart':
      return { phase: 'working', running: [] }
    case 'turnEnd':
      return { phase: e.reason === 'aborted' ? 'interrupted' : e.reason === 'error' || e.reason === 'refusal' ? 'error' : 'idle', running: [] }
    case 'toolStart': {
      const next = [...running, { id: e.id, tool: clean(e.tool) || 'tool' }]

      return RANK[a.phase] > RANK.tool ? { ...a, running: next } : settled(next)
    }
    case 'toolEnd': {
      if (!running.some(r => r.id === e.id)) return a
      const next = running.filter(r => r.id !== e.id)

      return a.phase === 'tool' ? settled(next) : { ...a, running: next }
    }
    case 'permissionAsk':
      return RANK[a.phase] > RANK.permission ? a : { phase: 'permission', tool: clean(e.tool) || 'tool', running }
    case 'permissionEnd':
      return endOf(a, 'permission')
    case 'questionOpen':
      return { phase: 'question', running }
    case 'questionClose':
      return endOf(a, 'question')
    case 'compactStart':
      return RANK[a.phase] >= RANK.compacting ? a : { phase: 'compacting', running }
    case 'compactEnd':
      return endOf(a, 'compacting')
    case 'failure':
      return { phase: 'error', detail: clean(e.detail), running }
  }
}

// The words for the line; undefined when there is nothing to say.
export const activityLabel = (a: Activity): string | undefined => {
  switch (a.phase) {
    case 'working':
      return t().activity.working
    case 'tool':
      return t().activity.tool(a.tool ?? 'tool')
    case 'permission':
      return t().activity.permission(a.tool ?? 'tool')
    case 'question':
      return t().activity.question
    case 'compacting':
      return t().activity.compacting
    case 'interrupted':
      return t().activity.interrupted
    case 'error':
      return a.detail === undefined || a.detail === '' ? t().activity.error : t().activity.errorWith(a.detail)
    case 'idle':
      return undefined
  }
}
