// The optional rule "no state-changing tool before a plan" (the `enforce` setting).
// It fails open: off, a subagent's call, a reading tool, a plan tool the model was
// never offered, or a third refusal in one turn all let the call through.
import type { GateState } from '../types'
import type { Plan } from './plan'
import { hasOpenWork } from './plan'

export type { GateState }

export const GUARDED: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'Agent', 'Task', 'Workflow'])

export const MAX_DENIES = 3

export type GateAsk = { tool: string; agentId?: string; enforce: boolean; toolOffered: boolean; gate: GateState }

// `pause` lets the call through and is said once; `gate` is the state to keep.
export type GateVerdict = { verdict: 'allow' | 'deny' | 'pause'; gate: GateState }

export const decide = (ask: GateAsk): GateVerdict => {
  const { gate } = ask
  const free = !ask.enforce || (ask.agentId ?? '') !== '' || !GUARDED.has(ask.tool) || !ask.toolOffered || gate.planned
  if (free) return { verdict: 'allow', gate }
  if (gate.denies < MAX_DENIES) return { verdict: 'deny', gate: { ...gate, denies: gate.denies + 1 } }
  if (gate.denies === MAX_DENIES) return { verdict: 'pause', gate: { ...gate, denies: gate.denies + 1 } }

  return { verdict: 'allow', gate }
}

// A new turn counts afresh; a plan with open work still counts as the task's plan.
export const onTurnStart = (plan: Plan): GateState => ({ planned: hasOpenWork(plan), denies: 0 })

export const onPlanWritten = (gate: GateState): GateState => ({ ...gate, planned: true })

export const denyReason = (tool: string): string =>
  `plan-flow wants a plan before edits and commands. Send one first: ${tool} {"op":"set","title":"<what you are doing>","nodes":[{"title":"<first stage>"}]}. ` +
  `(${tool} may need loading through ToolSearch: "select:${tool}".)`

export const PAUSE_NOTICE = '세 번 막았지만 계획이 없어서, 이번 턴은 계획 없이 진행해요'
