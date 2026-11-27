import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types'
import { emptyBoard } from '../shared/board'
import { runOp } from '../shared/plan-tool'
import { REPLAY_SYSTEM } from '../shared/planner'
import type { Board } from '../shared/types'
import type { Printed } from '../server/ask'
import { afterTurn, DESIGN_BUDGET_USD, type DesignState, freshDesign, type TurnDeps } from '../server/turn'

const start = (): Board => {
  const r = runOp(emptyBoard(), { op: 'set', title: 'Dark theme', nodes: [{ title: 'Read the theme' }, { title: 'Add the palette' }] }, 1)
  if ('error' in r) throw new Error(r.error)
  const n = runOp(r.board, { op: 'next' }, 1)
  if ('error' in n) throw new Error(n.error)
  return n.board
}

const worked: AgentTimelineItem[] = [
  { type: 'user_message', text: 'Add a dark theme' },
  { type: 'tool_call', callId: 'b1', name: 'Bash', detail: { type: 'shell', command: 'npm test', output: '12 passed' }, status: 'completed', error: null },
  { type: 'assistant_message', text: 'The palette is in and the tests pass.' },
]
const talked: AgentTimelineItem[] = [
  { type: 'user_message', text: 'What does the palette look like?' },
  { type: 'assistant_message', text: 'Dark grey with a green accent.' },
]

const finished = JSON.stringify([{ op: 'update', updates: [{ id: '1', status: 'completed' }, { id: '2', status: 'completed' }] }])
const printed = (text: string, cost = 0.12): Printed => ({ text, cost, input: 37_000, output: 3_000 })

// A planner that changes nothing and a designer that finishes the plan, counting the designs asked.
const deps = (over: Partial<TurnDeps> = {}) => {
  const asked: { system: string; prompt: string }[] = []
  const d: TurnDeps = {
    look: async () => '[]',
    design: async (system, prompt) => (asked.push({ system, prompt }), printed(finished)),
    session: async () => [worked],
    now: () => 5_000,
    ...over,
  }
  return { d, asked }
}

test('after a turn that did work and that the planner changed nothing for, the design reads the session and its ops land', async () => {
  const { d, asked } = deps()
  const out = await afterTurn(start(), freshDesign(), worked, d)

  assert.equal(asked.length, 1)
  assert.equal(asked[0]?.system, REPLAY_SYSTEM)
  assert.match(asked[0]?.prompt ?? '', /- Claude ran: npm test → 12 passed/)
  assert.deepEqual(out.board.plan.nodes.map(n => n.status), ['completed', 'completed'])
  // Each design's size and cost is kept, and counts toward the budget.
  assert.deepEqual(out.design.calls.map(c => [c.result, c.input, c.output, c.cost]), [['answered', 37_000, 3_000, 0.12]])
  assert.equal(out.design.spent, 0.12)
})

test('no design after a question answered with no work, or after a look that moved the board', async () => {
  const quiet = deps()
  await afterTurn(start(), freshDesign(), talked, quiet.d)
  assert.equal(quiet.asked.length, 0)

  const moved = deps({ look: async () => JSON.stringify([{ op: 'update', updates: [{ id: '1', status: 'completed' }] }]) })
  const out = await afterTurn(start(), freshDesign(), worked, moved.d)
  assert.equal(moved.asked.length, 0)
  assert.deepEqual(out.design.calls, [])
  // A prompt from another agent comes as a call, but it is news, not work.
  const told: AgentTimelineItem[] = [
    { type: 'tool_call', callId: 'm1', name: 'agent_message', detail: { type: 'plain_text', text: 'Add a dark theme', icon: 'bot' }, agentMessage: { text: 'Add a dark theme' }, status: 'completed', error: null } as AgentTimelineItem,
    { type: 'assistant_message', text: '[System Error] Your access token could not be refreshed.' },
  ]
  const news = deps()
  await afterTurn(start(), freshDesign(), told, news.d)
  assert.equal(news.asked.length, 0)
})

test('a design that gives no answer is owed: the next turn with work asks again though the planner moved the board', async () => {
  const silent = deps({ design: async () => null })
  const first = await afterTurn(start(), freshDesign(), worked, silent.d)
  assert.equal(first.design.owed, true)
  assert.deepEqual(first.design.calls.map(c => c.result), ['no answer'])

  const moved = deps({ look: async () => JSON.stringify([{ op: 'update', updates: [{ id: '1', status: 'completed' }] }]) })
  const second = await afterTurn(first.board, first.design, worked, moved.d)
  assert.equal(moved.asked.length, 1)
  assert.equal(second.design.owed, false)
})

test("once an agent's designs reach the budget, no design is asked and the board is the planner's", async () => {
  const spent: DesignState = { ...freshDesign(), spent: DESIGN_BUDGET_USD }
  const { d, asked } = deps()
  const out = await afterTurn(start(), spent, worked, d)

  assert.equal(asked.length, 0)
  assert.deepEqual(out.board.plan.nodes.map(n => n.status), ['in_progress', 'pending'])
  assert.deepEqual(out.design.calls.map(c => c.result), ['over budget'])

  // Just under the budget, one more design is asked.
  const under = deps()
  await afterTurn(start(), { ...freshDesign(), spent: DESIGN_BUDGET_USD - 0.01 }, worked, under.d)
  assert.equal(under.asked.length, 1)
})
