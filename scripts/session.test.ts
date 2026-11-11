import { expect, test } from 'claude-code/testing'
import { costScore, costShare, heard } from './session'

const line = (o: Record<string, unknown>): string => JSON.stringify({ timestamp: '2026-11-09T00:00:00.000Z', ...o })

test('a transcript reads back as what the planner hears: requests, calls with failures marked, words along the way and the answer', () => {
  const jsonl = [
    line({ type: 'user', message: { content: 'Fix the total' } }),
    line({ type: 'user', message: { content: [{ type: 'text', text: 'Look at [Image #1]' }, { type: 'image' }] } }),
    line({ type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'Base directory for this skill' }] } }),
    line({ type: 'user', message: { content: '<command-name>/clear</command-name>' } }),
    line({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Running the tests.' }] } }),
    line({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }] } }),
    line({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't2', name: 'ToolSearch', input: {} }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } }),
    line({ type: 'assistant', isSidechain: true, message: { id: 's1', content: [{ type: 'tool_use', id: 't3', name: 'Read', input: {} }] } }),
    line({ type: 'user', message: { content: '<task-notification><summary>Build finished</summary></task-notification>' } }),
    line({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Fixed.' }] } }),
    'not json',
  ].join('\n')

  expect(heard(jsonl).map(h => [h.kind, h.text, h.guarded])).toEqual([
    ['request', 'Fix the total', undefined],
    ['request', 'Look at [Image #1]', undefined],
    ['said', 'Running the tests.', undefined],
    ['tool', 'Run the tests (failed)', true],
    ['notice', 'Build finished', undefined],
    ['answer', 'Fixed.', undefined],
  ])
})

test('a delegated session reads back with the subagent calls merged in time order, failures marked and state-changing ones counted', () => {
  const at = (s: number): string => `2026-11-09T00:00:0${s}.000Z`
  const main = [
    line({ type: 'user', timestamp: at(0), message: { content: 'Check the build' } }),
    line({ type: 'assistant', timestamp: at(1), message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Task', input: { description: 'Look around' } }] } }),
    line({ type: 'assistant', timestamp: at(5), message: { id: 'm2', content: [{ type: 'text', text: 'Done.' }] } }),
  ].join('\n')
  const sub = [
    line({ type: 'user', timestamp: at(2), isSidechain: true, message: { content: 'Look around' } }),
    line({ type: 'assistant', timestamp: at(3), isSidechain: true, message: { id: 's1', content: [{ type: 'tool_use', id: 'u1', name: 'Bash', input: { command: 'ls', description: 'List files' } }, { type: 'tool_use', id: 'u2', name: 'ToolSearch', input: {} }] } }),
    line({ type: 'user', timestamp: at(4), isSidechain: true, message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: true }] } }),
  ].join('\n')

  const out = heard(main, [sub])
  expect(out.map(h => h.kind)).toEqual(['request', 'tool', 'subagent', 'answer'])
  expect(out[2].text).toBe('List files (failed)')
  expect(out[2].guarded).toBe(true)
})

test("the cost item is the mod's model calls against the session's own, on the strict bar", () => {
  const turn = (id: string, output: number) => line({ type: 'assistant', message: { id, usage: { input_tokens: 1000, output_tokens: output } } })
  // The work: 2 requests of 1000 in and 200 out, one written twice in the log = 4000.
  const jsonl = [turn('a', 200), turn('a', 200), turn('b', 200)].join('\n')
  const at = Date.parse('2026-11-09T00:00:00.000Z')
  const use = (input: number) => ({ input, cacheRead: 0, cacheWrite: 0, output: 0 })
  // A design call of 100 and a planner call of 100 at a fifth of the price = 120, so 3%.
  expect(Math.round(costShare([{ at, call: 'design', usage: use(100) }, { at, call: 'look', usage: use(100) }, { at, call: 'look' }], jsonl) ?? 0)).toBe(3)
  expect(costShare([{ at, call: 'look' }], jsonl)).toBeUndefined()
  expect([0.5, 1, 1.5, 3, 4.1, 8, 20].map(costScore)).toEqual([5, 5, 4, 3, 2, 2, 1])
})
