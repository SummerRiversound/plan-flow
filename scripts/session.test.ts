import { expect, test } from 'claude-code/testing'
import { heard } from './session'

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
