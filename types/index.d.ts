// The state contract. `claude plugin validate` refuses a PluginState entry that
// points at an alias, so the atoms below spell their shapes out; the named types
// are what the code uses.
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
}

export type Summary = { goal: string; result: string }

export type ActivityPhase = 'idle' | 'working' | 'tool' | 'permission' | 'question' | 'compacting' | 'interrupted' | 'error'

export type Activity = {
  phase: ActivityPhase
  tool?: string
  detail?: string
  running: Array<{ id: string; tool: string }>
}

// A plan set aside: parked to come back to, cancelled, or done. The shelf is newest first.
export type Shelved = { plan: Plan; state: 'parked' | 'cancelled' | 'done'; at: number }
// The session's board: the plan in hand and the shelf.
export type Board = { plan: Plan; shelf: Shelved[] }

// Folds the person set in the drawer (true open, false closed; absent follows the
// running item), the box holding the focus ring, and the first body row the person
// scrolled to (absent: the drawer follows the running step), and whether the person
// asked for the list instead of the flowchart.
// `pick`: the step whose row was pressed, with its buttons under it.
export type DrawerState = { open: Record<string, boolean>; focus: string | null; top?: number; list?: boolean; pick?: string }

declare module 'claude-code' {
  interface PluginState {
    'plan-flow': {
      plan: {
        title: string
        goal?: string
        goalEdits?: number
        nodes: Array<{
          id: string
          parentId: string | null
          title: string
          status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped' | 'needs_check'
          note?: string
          detail?: string
          links?: string[]
          parallel?: boolean
          startedAt?: number
          doneAt?: number
        }>
        lastChild: Record<string, number>
        startedAt: number
        marks?: Record<string, 'new' | 'redo'>
        summary?: { goal: string; result: string }
      }
      activity: {
        phase: 'idle' | 'working' | 'tool' | 'permission' | 'question' | 'compacting' | 'interrupted' | 'error'
        tool?: string
        detail?: string
        running: Array<{ id: string; tool: string }>
      }
      shelf: Array<{
        plan: {
          title: string
          goal?: string
          goalEdits?: number
          nodes: Array<{
            id: string
            parentId: string | null
            title: string
            status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped' | 'needs_check'
            note?: string
            detail?: string
            links?: string[]
            parallel?: boolean
            startedAt?: number
            doneAt?: number
          }>
          lastChild: Record<string, number>
          startedAt: number
          marks?: Record<string, 'new' | 'redo'>
          summary?: { goal: string; result: string }
        }
        state: 'parked' | 'cancelled' | 'done'
        at: number
      }>
      drawer: { open: Record<string, boolean>; focus: string | null; top?: number; list?: boolean; pick?: string }
      // True once /flow has been run: with autoShow off, the tree waits for it.
      asked: boolean
      // Where /flow demo stands; null while the real board shows.
      demo: { scenario: number; frame: number } | null
      // True while the drawer is open: the band above the prompt steps aside.
      pane: boolean
      // The band folded to its title and progress lines.
      fold: boolean
      // A newer plan-flow installed beside this one, or out in its repository; null when this one is the newest.
      newer: { kind: 'installed' | 'released'; version: string } | null
    }
  }
}
