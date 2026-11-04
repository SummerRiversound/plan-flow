// The state contract. `claude plugin validate` refuses a PluginState entry that
// points at an alias, so the atoms below spell their shapes out; the named types
// are what the code uses.
export type PlanStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped'

// One step. Ids are paths ("2", "2.1", "2.1.3"); a parent's status is derived from
// its children. `parallel` marks a group whose children run at the same time.
export type PlanNode = {
  id: string
  parentId: string | null
  title: string
  status: PlanStatus
  note?: string
  parallel?: boolean
  startedAt?: number
  doneAt?: number
}

// `lastChild` is the highest child number ever handed out under a parent ('' is the
// top level), so an id that was removed is never handed out again.
export type Plan = {
  title: string
  nodes: PlanNode[]
  lastChild: Record<string, number>
  startedAt: number
}

export type ActivityPhase = 'idle' | 'working' | 'tool' | 'permission' | 'question' | 'compacting' | 'interrupted' | 'error'

export type Activity = {
  phase: ActivityPhase
  tool?: string
  detail?: string
  running: Array<{ id: string; tool: string }>
}

export type GateState = { planned: boolean; denies: number }

// Folds the person set in the drawer (true open, false closed; absent follows the
// running item) and the box holding the focus ring.
export type DrawerState = { open: Record<string, boolean>; focus: string | null }

declare module 'claude-code' {
  interface PluginState {
    'plan-flow': {
      plan: {
        title: string
        nodes: Array<{
          id: string
          parentId: string | null
          title: string
          status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped'
          note?: string
          parallel?: boolean
          startedAt?: number
          doneAt?: number
        }>
        lastChild: Record<string, number>
        startedAt: number
      }
      activity: {
        phase: 'idle' | 'working' | 'tool' | 'permission' | 'question' | 'compacting' | 'interrupted' | 'error'
        tool?: string
        detail?: string
        running: Array<{ id: string; tool: string }>
      }
      gate: { planned: boolean; denies: number }
      drawer: { open: Record<string, boolean>; focus: string | null }
      // True once /flow has been run: with autoShow off, the tree waits for it.
      asked: boolean
      // True while the drawer is open: the band above the prompt steps aside.
      pane: boolean
      // The tree row the person scrolled the band to; null follows the current step.
      scroll: number | null
    }
  }
}
