import type { PluginClientContext } from '@getpaseo/plugin/client'
import { PlanPanel } from './client/panel'

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addAgentPanel({ id: 'plan', title: 'Plan Flow', icon: 'ListTree', locations: ['explorer'], Component: PlanPanel })
  const removeItem = client.addCommandCenterItem({
    id: 'open-plan',
    title: 'Open Plan Flow',
    icon: 'ListTree',
    context: 'agent',
    onSelect({ openPanel }) {
      openPanel('plan', { location: 'explorer' })
    },
  })

  return () => {
    removePanel()
    removeItem()
  }
}
