// The plan's shapes, shared by the Claude Code mod and the Paseo plugin. The mod's PluginState
// in types/index.d.ts spells the same shapes out, since `claude plugin validate` refuses an alias there.
// `needs_check`: Claude did its part and the person has to look (a device, a taste call); it counts as done.
export type PlanStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped' | 'needs_check'

// One step. Ids are paths ("2", "2.1", "2.1.3"); a parent's status is derived from
// its children. `parallel` marks a group whose children run at the same time.
export type PlanNode = {
  id: string
  parentId: string | null
  title: string
  status: PlanStatus
  note?: string
  // One plain sentence on what the step does and why, shown while it runs or is open.
  detail?: string
  // What the step produced that the person may open: URLs or absolute file paths.
  links?: string[]
  parallel?: boolean
  startedAt?: number
  doneAt?: number
}

// `lastChild` is the highest child number ever handed out under a parent ('' is the
// top level), so an id that was removed is never handed out again.
export type Plan = {
  title: string
  // One sentence on what the work is for, shown under the title.
  goal?: string
  // How many times the goal was rewritten to a different sentence; the second rewrite suggests a new plan.
  goalEdits?: number
  nodes: PlanNode[]
  lastChild: Record<string, number>
  startedAt: number
  // Steps this request changed: added ('new') or reopened ('redo'); cleared on the next prompt.
  marks?: Record<string, 'new' | 'redo'>
  // The closing note Claude gives with the op that finishes the last step; dropped when a step reopens.
  summary?: Summary
  // Work likely to follow the plan, drawn dotted after its last stage and never counted.
  expected?: string[]
}

export type Summary = { goal: string; result: string }

// A plan set aside: parked to come back to, cancelled, or done. The shelf is newest first.
export type Shelved = { plan: Plan; state: 'parked' | 'cancelled' | 'done'; at: number }
// The session's board: the plan in hand and the shelf.
export type Board = { plan: Plan; shelf: Shelved[] }
