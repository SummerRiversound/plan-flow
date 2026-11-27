import type { PluginClientContext } from '@getpaseo/plugin/client'
import { PlanBadge } from './client/badge'
import { messages } from './client/messages'
import { PlanPanel } from './client/panel'
import { contributePills } from './client/pills'

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addAgentPanel({ id: 'plan', title: messages.message('title'), icon: 'ListTree', locations: ['explorer'], Component: PlanPanel })
  const removeItem = client.addCommandCenterItem({
    id: 'open-plan',
    title: messages.message('open'),
    icon: 'ListTree',
    context: 'agent',
    onSelect({ openPanel }) {
      openPanel('plan', { location: 'explorer' })
    },
  })
  const removeBadge = client.addWorkspaceRowBadgeItem({ id: 'plan', title: messages.message('title'), icon: 'ListTree', Component: PlanBadge })
  const removePills = contributePills(client)

  return () => {
    removePanel()
    removeItem()
    removeBadge()
    removePills()
  }
}
