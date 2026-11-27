import type { PluginButtonRegistration, PluginClientContext } from '@getpaseo/plugin/client'
import { boardsRpc } from '../shared/rpc'
import { LIST_POLL_MS } from './boards'
import { messages } from './messages'

// Longer step titles are cut so the pill stays one short line beside Tasks and Subagents.
const MAX_LABEL = 24
const cut = (s: string): string => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s)

// One pill above each agent's composer: the step Claude is on and the progress, pressed to open
// the panel. Hidden while the agent has no plan with work open, and after a failed read.
export const contributePills = (client: PluginClientContext): (() => void) => {
  const pills = new Map<string, PluginButtonRegistration<string>>()
  const lifetime = new AbortController()
  let stopped = false

  const register = (agent: { id: string; workspaceId?: string | null }) => {
    if (stopped || !agent.workspaceId || pills.has(agent.id)) return
    const workspaceId = agent.workspaceId
    pills.set(
      agent.id,
      client.addComposerPill({
        id: 'plan',
        workspaceId,
        agentId: agent.id,
        button: {
          title: client.i18n.t(messages, 'open'),
          icon: 'ListTree',
          label: client.i18n.t(messages, 'title'),
          visible: false,
          behavior: { kind: 'action', onPress: () => client.openPanel('plan', { workspaceId, agentId: agent.id, location: 'explorer' }) },
        },
      }),
    )
  }
  const drop = (agentId: string) => {
    pills.get(agentId)?.remove()
    pills.delete(agentId)
  }

  const refresh = async () => {
    if (pills.size === 0) return
    const boards = await client.rpc(boardsRpc, {}).catch(() => [])
    if (stopped) return
    const byAgent = new Map(boards.map(b => [b.agentId, b]))
    for (const [agentId, pill] of pills) {
      const b = byAgent.get(agentId)
      pill.update(b === undefined || !b.open ? { visible: false } : { visible: true, label: `${cut(b.current ?? b.title)} · ${b.done}/${b.total}` })
    }
  }
  const timer = setInterval(() => void refresh(), LIST_POLL_MS)

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          for (const id of [...pills.keys()]) drop(id)
          for (const { agent } of entries) register(agent)
          void refresh()
        },
        update: message => {
          if (message.type !== 'agent_update') return
          if (message.payload.kind === 'remove') drop(message.payload.agentId)
          else register(message.payload.agent)
        },
      })
      return undefined
    })
    .catch(err => {
      if (!stopped) console.error('[plan-flow] agent list failed', err)
    })

  return () => {
    stopped = true
    clearInterval(timer)
    lifetime.abort()
    for (const id of [...pills.keys()]) drop(id)
  }
}
