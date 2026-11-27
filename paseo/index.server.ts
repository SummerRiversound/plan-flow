import type { PluginServerContext } from '@getpaseo/plugin/server'
import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types'
import { claudeAsk, designAsk } from './server/ask'
import { loadBoard, loadBoards, saveBoard } from './server/store'
import { afterTurn, freshDesign } from './server/turn'
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
  // One look at a time per agent: a turn that ends while the last look runs waits its turn.
  const queue = new Map<string, Promise<void>>()

  // Claude sessions this plugin plans for carry the mark, so the plan-flow mod in them rests.
  server.addHook('agent.open.before', async ({ request }) => (request.provider === 'claude' ? { ...request, env: { ...request.env, [PASEO_ENV]: '1' } } : request))

  server.addHook('agent.turn.after', async (event, { paseo }) => {
    if (event.outcome.kind === 'canceled' || event.agent.background) return
    const id = event.agent.id
    const run = async () => {
      const timeline = paseo.agents.ref(id).timeline
      const page = await timeline.refetch({ direction: 'tail', limit: 1, wholeTurns: true })
      const turn = page.entries.filter(e => e.turnId === event.turnId).map(e => e.item)
      const { board, design } = await loadBoard(id)
      const started = Date.now()
      const out = await afterTurn(board, design ?? freshDesign(), turn, {
        look: claudeAsk(event.agent.cwd),
        design: designAsk(event.agent.cwd),
        // shortcut: the newest SESSION_ENTRIES entries only; a longer session's oldest turns are not read.
        session: async () => turnsOf((await timeline.refetch({ direction: 'tail', limit: SESSION_ENTRIES, wholeTurns: true })).entries),
        now: Date.now,
      })
      const call = out.design.calls.at(-1)
      const designed = call !== undefined && call.at >= started ? `, design ${call.result}${call.cost === undefined ? '' : ` ($${call.cost.toFixed(3)}, ${call.input} in)`}` : ''
      console.log(`[plan-flow] look ${id.slice(0, 8)}: ${out.looked === null ? 'no answer' : `${out.looked} ops`}${designed} in ${Date.now() - started} ms`)
      await saveBoard(id, out.board, Date.now(), event.agent.workspaceId, out.design)
    }
    // The hook returns at once; the look runs after the one before it, and a failure only logs.
    const next = (queue.get(id) ?? Promise.resolve()).then(run).catch(err => console.error(`[plan-flow] look ${id.slice(0, 8)} failed:`, err))
    queue.set(id, next)
    void next.finally(() => queue.get(id) === next && queue.delete(id))
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

  return () => {}
}
