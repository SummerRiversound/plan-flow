import { useRpc } from '@getpaseo/plugin/client'
import { useQuery } from '@tanstack/react-query'
import { boardRpc, boardsRpc } from '../shared/rpc'

// A board changes when a turn ends; a few seconds behind is close enough.
// shortcut: polling, not a subscription; push from the server once boards change mid-turn.
export const BOARD_POLL_MS = 3000
export const LIST_POLL_MS = 5000
export const BOARDS_KEY = ['plan-flow', 'boards'] as const

export const useBoard = (agentId: string) => {
  const read = useRpc(boardRpc)
  return useQuery({ queryKey: ['plan-flow', 'board', agentId], queryFn: () => read({ agentId }), refetchInterval: BOARD_POLL_MS })
}

// One read for every workspace row: the plugin's query client is shared by all its components.
export const useBoards = () => {
  const list = useRpc(boardsRpc)
  return useQuery({ queryKey: BOARDS_KEY, queryFn: () => list({}), refetchInterval: LIST_POLL_MS })
}
