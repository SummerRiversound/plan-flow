import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types'
import { emptyBoard } from '../shared/board'
import { PLANNER_SYSTEM } from '../shared/planner'
import { look } from '../server/look'

const turn: AgentTimelineItem[] = [
  { type: 'user_message', text: 'Add a dark theme' },
  { type: 'tool_call', callId: 'r1', name: 'Read', detail: { type: 'read', filePath: '/repo/src/theme.ts' }, status: 'completed', error: null },
  { type: 'assistant_message', text: 'I read the theme file; the palette comes next.' },
]

const setOp = JSON.stringify([
  { op: 'set', title: 'Dark theme', goal: 'The app can switch to a dark palette.', nodes: [
    { title: 'Read the theme', detail: 'Find where colours are defined.' },
    { title: 'Add the palette', detail: 'Write the dark colour set.' },
  ] },
])

test('a turn goes to the planner with its system prompt, and the board it answers starts its first open step', async () => {
  const asked: { system: string; prompt: string }[] = []
  const r = await look(emptyBoard(), turn, async (system, prompt) => (asked.push({ system, prompt }), setOp), 1_000)

  assert.equal(asked.length, 1)
  assert.equal(asked[0]?.system, PLANNER_SYSTEM)
  assert.match(asked[0]?.prompt ?? '', /The board is empty\./)
  assert.match(asked[0]?.prompt ?? '', /The person asked: Add a dark theme/)
  assert.ok(r !== null)
  assert.equal(r.applied, 1)
  assert.equal(r.board.plan.title, 'Dark theme')
  assert.deepEqual(r.board.plan.nodes.map(n => [n.title, n.status]), [['Read the theme', 'in_progress'], ['Add the palette', 'pending']])
})

test('ops the board refuses are skipped and the rest still land', async () => {
  const answer = JSON.stringify([{ op: 'next', id: '9' }, ...JSON.parse(setOp)])
  const r = await look(emptyBoard(), turn, async () => answer, 1_000)

  assert.equal(r?.applied, 1)
  assert.equal(r?.board.plan.title, 'Dark theme')
})

test('a planner that gives no answer leaves the board alone', async () => {
  assert.equal(await look(emptyBoard(), turn, async () => null, 1_000), null)
})

test('a turn with nothing the planner hears does not call it', async () => {
  let calls = 0
  const quiet: AgentTimelineItem[] = [{ type: 'reasoning', text: 'thinking' }]
  const r = await look(emptyBoard(), quiet, async () => (calls++, setOp), 1_000)

  assert.equal(calls, 0)
  assert.deepEqual(r, { board: emptyBoard(), applied: 0 })
})
