import { type PluginWorkspaceRowBadgeItemProps, useTranslation } from '@getpaseo/plugin/client'
import { WorkspaceRowBadge } from '@getpaseo/plugin/client/ui'
import { useBoards } from './boards'
import { messages } from './messages'

// The workspace's newest plan with work open, as `3/13` on its sidebar row. A finished plan,
// an unread list or a failed read says nothing rather than a count that may be wrong.
export function PlanBadge({ workspaceId }: PluginWorkspaceRowBadgeItemProps) {
  const { t } = useTranslation(messages)
  const { data } = useBoards()
  const board = data?.find(b => b.workspaceId === workspaceId && b.open)
  if (board === undefined) return null

  return <WorkspaceRowBadge icon="ListTree" label={`${board.done}/${board.total}`} accessibilityLabel={t('badge', { done: board.done, total: board.total })} />
}
