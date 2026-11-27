import type { PluginServerContext } from '@getpaseo/plugin/server'
import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types'
import { claudeAsk, designAsk } from './server/ask'
import { loadBoard, loadBoards, saveBoard } from './server/store'
import { afterTurn, type DesignCall, designNow, freshDesign, SETTLE_MS, type TurnDeps } from './server/turn'
import { PASEO_ENV } from './shared/host'
import { boardRpc, boardsRpc } from './shared/rpc'
import { summaryOf } from './shared/view'

// The session a design reads: this many of the newest timeline entries, whole turns.
const SESSION_ENTRIES = 2000

// Timeline entries as one list of items per turn, in order.
const turnsOf = (entries: readonly { turnId?: string | null; item: AgentTimelineItem }[]): AgentTimelineItem[][] =>
  entries.reduce<{ id: string | null | undefined; items: AgentTimelineItem[] }[]>((turns, e) => {
    const last = turns.at(-1)
    if (last !== undefined && last.id === e.turnId) last.items.push(e.item)
    else turns.push({ id: e.turnId, items: [e.item] })
    return turns
  }, []).map(t => t.items)

export default function contribute(server: PluginServerContext) {
  // One look or design at a time per agent: what comes while one runs waits its turn.
  const queue = new Map<string, Promise<void>>()
  // The design due once an agent rests after a turn that did work; the agent's next turn cancels it.
  const resting = new Map<string, ReturnType<typeof setTimeout>>()
  // Agents in a turn now: a look that ends while its agent works again leaves the rest to that turn's end.
  const working = new Set<string>()
  const wake = (id: string) => {
    clearTimeout(resting.get(id))
    resting.delete(id)
  }
  const enqueue = (id: string, what: string, run: () => Promise<void>) => {
    // The hook returns at once; the work runs after the one before it, and a failure only logs.
    const next = (queue.get(id) ?? Promise.resolve()).then(run).catch(err => console.error(`[plan-flow] ${what} ${id.slice(0, 8)} failed:`, err))
    queue.set(id, next)
    void next.finally(() => queue.get(id) === next && queue.delete(id))
  }
  const designed = (call: DesignCall | undefined, started: number): string =>
    call !== undefined && call.at >= started ? `, design ${call.result}${call.cost === undefined ? '' : ` ($${call.cost.toFixed(3)}, ${call.input} in)`}` : ''

  // Claude sessions this plugin plans for carry the mark, so the plan-flow mod in them rests.
  server.addHook('agent.open.before', async ({ request }) => (request.provider === 'claude' ? { ...request, env: { ...request.env, [PASEO_ENV]: '1' } } : request))

  server.addHook('agent.turn.before', async ({ agent }) => {
    working.add(agent.id)
    wake(agent.id)
  })

  server.addHook('agent.turn.after', async (event, { paseo }) => {
    if (event.outcome.kind === 'canceled' || event.agent.background) return
    const id = event.agent.id
    working.delete(id)
    wake(id)
    const timeline = paseo.agents.ref(id).timeline
    const deps: TurnDeps = {
      look: claudeAsk(event.agent.cwd),
      design: designAsk(event.agent.cwd),
      // shortcut: the newest SESSION_ENTRIES entries only; a longer session's oldest turns are not read.
      session: async () => turnsOf((await timeline.refetch({ direction: 'tail', limit: SESSION_ENTRIES, wholeTurns: true })).entries),
      now: Date.now,
    }
    const rest = async () => {
      const { board, design } = await loadBoard(id)
      const started = Date.now()
      const out = await designNow(board, design ?? freshDesign(), deps)
      console.log(`[plan-flow] rest ${id.slice(0, 8)}${designed(out.design.calls.at(-1), started)} in ${Date.now() - started} ms`)
      await saveBoard(id, out.board, Date.now(), event.agent.workspaceId, out.design)
    }
    enqueue(id, 'look', async () => {
      const page = await timeline.refetch({ direction: 'tail', limit: 1, wholeTurns: true })
      const turn = page.entries.filter(e => e.turnId === event.turnId).map(e => e.item)
      const { board, design } = await loadBoard(id)
      const started = Date.now()
      const out = await afterTurn(board, design ?? freshDesign(), turn, deps)
      console.log(`[plan-flow] look ${id.slice(0, 8)}: ${out.looked === null ? 'no answer' : `${out.looked} ops`}${designed(out.design.calls.at(-1), started)} in ${Date.now() - started} ms`)
      await saveBoard(id, out.board, Date.now(), event.agent.workspaceId, out.design)
      if (out.settles && !working.has(id)) resting.set(id, setTimeout(() => (resting.delete(id), enqueue(id, 'rest', rest)), SETTLE_MS))
    })
  })

  server.handle(boardRpc, async ({ agentId }) => {
    const { board, savedAt } = await loadBoard(agentId)
    return { plan: board.plan.nodes.length === 0 ? null : board.plan, savedAt }
  })

  server.handle(boardsRpc, async () =>
    Object.entries(await loadBoards())
      .flatMap(([agentId, { board, savedAt, workspaceId }]) => {
        const s = summaryOf(board.plan)
        return s === null ? [] : [{ agentId, workspaceId: workspaceId ?? null, savedAt, ...s }]
      })
      .sort((a, b) => b.savedAt - a.savedAt),
  )

  return () => {
    for (const t of resting.values()) clearTimeout(t)
    resting.clear()
  }
}
