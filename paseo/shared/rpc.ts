import { defineRpc } from '@getpaseo/plugin'
import { z } from 'zod'

const node = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'skipped', 'needs_check']),
  note: z.string().optional(),
  detail: z.string().optional(),
  links: z.array(z.string()).optional(),
  parallel: z.boolean().optional(),
  startedAt: z.number().optional(),
  doneAt: z.number().optional(),
})

// The plan as shared/types spells it, so the panel draws it with the same rules as the mod.
const plan = z.object({
  title: z.string(),
  goal: z.string().optional(),
  goalEdits: z.number().optional(),
  nodes: z.array(node),
  lastChild: z.record(z.string(), z.number()),
  startedAt: z.number(),
  marks: z.record(z.string(), z.enum(['new', 'redo'])).optional(),
  summary: z.object({ goal: z.string(), result: z.string() }).optional(),
  expected: z.array(z.string()).optional(),
})

// The board one agent's panel draws; null until the planner has looked at that agent.
export const boardRpc = defineRpc({
  name: 'board.read',
  input: z.object({ agentId: z.string() }),
  output: z.object({ plan: plan.nullable(), savedAt: z.number().nullable() }),
})

// One line per agent with a plan, newest first: what the pills above the composers and the
// workspace badges say. Every row and pill shares this one read.
export const boardsRpc = defineRpc({
  name: 'boards.list',
  input: z.object({}),
  output: z.array(
    z.object({
      agentId: z.string(),
      workspaceId: z.string().nullable(),
      savedAt: z.number(),
      title: z.string(),
      done: z.number(),
      total: z.number(),
      current: z.string().nullable(),
      open: z.boolean(),
    }),
  ),
})
