// The rule "no state-changing tool before a plan": refused with the `enforce` setting,
// otherwise reminded once a turn. It fails open: off, a subagent's call, a reading tool, a plan tool the model was
// never offered, or a third refusal in one turn all let the call through.
import type { GateState } from '../types'
import type { Plan } from './plan'
import { hasOpenWork } from './plan'

export type { GateState }

export const GUARDED: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'Agent', 'Task', 'Workflow'])

export const MAX_DENIES = 3

export type GateAsk = { tool: string; agentId?: string; enforce: boolean; toolOffered: boolean; gate: GateState }

// `pause` lets the call through and is said once; `remind` lets it through with one
// note for the model (enforcement off); `gate` is the state to keep.
export type GateVerdict = { verdict: 'allow' | 'deny' | 'pause' | 'remind'; gate: GateState }

export const REMINDER =
  'plan-flow: this changes something while no plan is running (the board is empty or its plan is finished), so the person cannot follow the work. If the task takes more than a couple of tool calls, set the plan now (op "set"), or add the steps to the finished plan when it continues that work (op "add"); for a one-step job, carry on.'

export const decide = (ask: GateAsk): GateVerdict => {
  const { gate } = ask
  const free = (ask.agentId ?? '') !== '' || !GUARDED.has(ask.tool) || !ask.toolOffered || gate.planned
  if (free) return { verdict: 'allow', gate }
  if (!ask.enforce) return gate.reminded === true ? { verdict: 'allow', gate } : { verdict: 'remind', gate: { ...gate, reminded: true } }
  if (gate.denies < MAX_DENIES) return { verdict: 'deny', gate: { ...gate, denies: gate.denies + 1 } }
  if (gate.denies === MAX_DENIES) return { verdict: 'pause', gate: { ...gate, denies: gate.denies + 1 } }

  return { verdict: 'allow', gate }
}

// A new turn counts afresh; a plan with open work still counts as the task's plan.
export const onTurnStart = (plan: Plan): GateState => ({ planned: hasOpenWork(plan), denies: 0, reminded: false })

export const onPlanWritten = (gate: GateState): GateState => ({ ...gate, planned: true })

export const denyReason = (tool: string): string =>
  `plan-flow wants a plan before edits and commands. Send one first: ${tool} {"op":"set","title":"<what you are doing>","nodes":[{"title":"<first stage>"}]}. ` +
  `(${tool} may need loading through ToolSearch: "select:${tool}".)`

// A step that keeps changing things with the plan untouched may hold several parts the
// person would check one by one; after LONG_STEP changes Claude hears so, once per step.
export type StepWatch = { id: string | null; changes: number; nudged: boolean }

export const LONG_STEP = 8

export const idleWatch = (): StepWatch => ({ id: null, changes: 0, nudged: false })

// One state-changing call while `running` is the step Claude is on (null: none).
export const watchStep = (w: StepWatch, running: string | null): { watch: StepWatch; nudge: boolean } => {
  if (running === null) return { watch: idleWatch(), nudge: false }
  const base = w.id === running ? w : { id: running, changes: 0, nudged: false }
  const changes = base.changes + 1
  const nudge = changes >= LONG_STEP && !base.nudged

  return { watch: { id: running, changes, nudged: base.nudged || nudge }, nudge }
}

// A plan write counts as Claude looking at the board again; the step keeps its one note.
export const onStepPlanWritten = (w: StepWatch): StepWatch => ({ ...w, changes: 0 })

export const longStepNote = (id: string, title: string): string =>
  `plan-flow: step ${id} "${title}" has run through ${LONG_STEP} changes with the plan unchanged. If it holds parts the person checks one by one (each draft, screen or file they open), add them under it with op "add" (parent "${id}") and mark the finished ones completed; if it is one piece of work, carry on.`
