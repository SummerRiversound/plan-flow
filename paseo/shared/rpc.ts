import { defineRpc } from '@getpaseo/plugin'
import { z } from 'zod'

const node = z.object({ id: z.string(), parentId: z.string().nullable(), title: z.string(), status: z.string(), detail: z.string().optional() })

// The board one agent's panel draws; null until the planner has looked at that agent.
export const boardRpc = defineRpc({
  name: 'board.read',
  input: z.object({ agentId: z.string() }),
  output: z.object({
    plan: z.object({ title: z.string(), goal: z.string().optional(), nodes: z.array(node) }).nullable(),
    savedAt: z.number().nullable(),
  }),
})
