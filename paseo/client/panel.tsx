import { type PluginAgentPanelProps, useRpc } from '@getpaseo/plugin/client'
import { useQuery } from '@tanstack/react-query'
import { ScrollView, Text, View } from 'react-native'
import { boardRpc } from '../shared/rpc'

const MARK: Record<string, string> = { completed: '●', in_progress: '◐', pending: '○', blocked: '✕', skipped: '–', needs_check: '◇' }
// The board changes when a turn ends; a few seconds behind is close enough for a first panel.
const POLL_MS = 3000

// shortcut: a plain indented list; the designed flowchart, band and badges come in their own milestone.
export function PlanPanel({ theme, layout, params }: PluginAgentPanelProps) {
  const read = useRpc(boardRpc)
  const q = useQuery({ queryKey: ['plan-flow', 'board', params.agentId], queryFn: () => read({ agentId: params.agentId }), refetchInterval: POLL_MS })
  const c = theme.colors
  const muted = { color: c.foregroundMuted }
  const plan = q.data?.plan ?? null

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: layout.compact ? 12 : 16, gap: 6 }}>
      {q.isPending ? <Text style={muted}>Loading the plan…</Text> : null}
      {q.isError ? <Text style={{ color: c.foreground }}>Could not read the plan: {String(q.error)}</Text> : null}
      {q.isSuccess && plan === null ? <Text style={muted}>The plan appears after this agent's next turn.</Text> : null}
      {plan !== null ? (
        <View style={{ gap: 4, marginBottom: 8 }}>
          <Text style={{ color: c.foreground, fontSize: 16, fontWeight: '600' }}>{plan.title}</Text>
          {plan.goal !== undefined ? <Text style={muted}>{plan.goal}</Text> : null}
        </View>
      ) : null}
      {plan?.nodes.map(n => (
        <View key={n.id} style={{ flexDirection: 'row', gap: 6, paddingLeft: (n.id.split('.').length - 1) * 16 }}>
          <Text style={{ color: n.status === 'in_progress' ? c.foreground : c.foregroundMuted }}>{MARK[n.status] ?? '○'}</Text>
          <Text style={{ flex: 1, color: c.foreground, fontWeight: n.status === 'in_progress' ? '600' : '400' }}>{n.title}</Text>
        </View>
      ))}
    </ScrollView>
  )
}
