// The state contract. `claude plugin validate` refuses a PluginState entry that
// points at an alias, so the atoms below spell their shapes out; the named types
// are what the code uses.
export type ActivityPhase = 'idle' | 'working' | 'tool' | 'permission' | 'question' | 'compacting' | 'interrupted' | 'error'

export type Activity = {
  phase: ActivityPhase
  tool?: string
  detail?: string
  running: Array<{ id: string; tool: string }>
  // Background work (agents, workflows, shells) still running when the turn ended: Claude waits on it, not on the person.
  background?: number
}

declare module 'claude-code' {
  interface PluginState {
    'plan-flow': {
      activity: {
        phase: 'idle' | 'working' | 'tool' | 'permission' | 'question' | 'compacting' | 'interrupted' | 'error'
        tool?: string
        detail?: string
        running: Array<{ id: string; tool: string }>
        background?: number
      }
      // True once /flow has been run: with autoShow off, the band waits for it.
      asked: boolean
      // Where /flow demo stands; null while the real board shows.
      demo: { scenario: number; frame: number } | null
      // True while the drawer is open: the band above the prompt steps aside.
      pane: boolean
      // The band folded to its title and goal.
      fold: boolean
      // Three minutes passed after an answer with no input: the note for the person coming back shows until they type.
      away: boolean
      // A newer plan-flow installed beside this one, or out in its repository; null when this one is the newest.
      newer: { kind: 'installed' | 'released'; version: string } | null
      chapters: {
        base: {
          title: string
          goal: string
          chapters: Array<{
            request: string
            title: string
            result: string
            links: string[]
            done: boolean
            left: Array<{ text: string; kind: 'mine' | 'claude' | 'others' | 'optional' | 'unverified' }>
            receipts: Array<{ what: 'opened' | 'merged' | 'ready' | 'release'; ref: string; url?: string }>
          }>
        }
        cut: number
        seq: number
        since: Array<{
          seq: number
          heard:
            | { kind: 'request'; text: string }
            | { kind: 'receipt'; receipt: { what: 'opened' | 'merged' | 'ready' | 'release'; ref: string; url?: string } }
            | { kind: 'asked'; id: string; question: string }
            | { kind: 'answered'; id: string }
            | { kind: 'background'; id: string }
            | { kind: 'backgroundDone'; id: string }
            | { kind: 'status'; result: string; left: Array<{ text: string; kind: 'mine' | 'claude' | 'others' | 'optional' | 'unverified' }> }
        }>
        asked: Array<{ id: string; question: string }>
        running: string[]
      }
    }
  }
}
