// The state contract. `claude plugin validate` refuses a PluginState entry that
// points at an alias, so the atoms below spell their shapes out; the named types
// are what the code uses. The plan's own types live in paseo/shared/types.ts.

export type ActivityPhase = 'idle' | 'working' | 'tool' | 'permission' | 'question' | 'compacting' | 'interrupted' | 'error'

export type Activity = {
  phase: ActivityPhase
  tool?: string
  detail?: string
  running: Array<{ id: string; tool: string }>
  // Background work (agents, workflows, shells) still running when the turn ended: Claude waits on it, not on the person.
  background?: number
}

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
        expected?: string[]
      }
      activity: {
        phase: 'idle' | 'working' | 'tool' | 'permission' | 'question' | 'compacting' | 'interrupted' | 'error'
        tool?: string
        detail?: string
        running: Array<{ id: string; tool: string }>
        background?: number
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
          expected?: string[]
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
      // A finished plan's band was opened by a press; it folds again when the next plan finishes.
      doneOpen: boolean
      // A newer plan-flow installed beside this one, or out in its repository; null when this one is the newest.
      newer: { kind: 'installed' | 'released'; version: string } | null
    }
  }
}
