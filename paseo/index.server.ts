import type { PluginServerContext } from '@getpaseo/plugin/server'
import { claudeAsk } from './server/ask'
import { look } from './server/look'
import { loadBoard, saveBoard } from './server/store'
import { boardRpc } from './shared/rpc'

export default function contribute(server: PluginServerContext) {
  // One look at a time per agent: a turn that ends while the last look runs waits its turn.
  const queue = new Map<string, Promise<void>>()

  server.addHook('agent.turn.after', async (event, { paseo }) => {
    if (event.outcome.kind === 'canceled' || event.agent.background) return
    const id = event.agent.id
    const run = async () => {
      const page = await paseo.agents.ref(id).timeline.refetch({ direction: 'tail', limit: 1, wholeTurns: true })
      const turn = page.entries.filter(e => e.turnId === event.turnId).map(e => e.item)
      const { board } = await loadBoard(id)
      const started = Date.now()
      const r = await look(board, turn, claudeAsk(event.agent.cwd), started)
      console.log(`[plan-flow] look ${id.slice(0, 8)}: ${r === null ? 'no answer' : `${r.applied} ops`} in ${Date.now() - started} ms`)
      if (r !== null) await saveBoard(id, r.board, Date.now())
    }
    // The hook returns at once; the look runs after the one before it, and a failure only logs.
    const next = (queue.get(id) ?? Promise.resolve()).then(run).catch(err => console.error(`[plan-flow] look ${id.slice(0, 8)} failed:`, err))
    queue.set(id, next)
    void next.finally(() => queue.get(id) === next && queue.delete(id))
  })

  server.handle(boardRpc, async ({ agentId }) => {
    const { board, savedAt } = await loadBoard(agentId)
    const p = board.plan
    return {
      plan: p.nodes.length === 0 ? null : { title: p.title, ...(p.goal === undefined ? {} : { goal: p.goal }), nodes: p.nodes.map(n => ({ id: n.id, parentId: n.parentId, title: n.title, status: n.status, ...(n.detail === undefined ? {} : { detail: n.detail }) })) },
      savedAt,
    }
  })

  return () => {}
}
