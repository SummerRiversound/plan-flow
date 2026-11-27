import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answerOf, plannerArgs } from '../server/ask'

// The top-level shape `claude -p --output-format json` printed in Claude Code 2.1.332, trimmed.
const printed = (over: Record<string, unknown>) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, stop_reason: 'end_turn', result: '[{"op":"next"}]', total_cost_usd: 0.0013, usage: { input_tokens: 2, cache_read_input_tokens: 3465, output_tokens: 1871 }, ...over })

test("the planner's answer is the result of a successful print", () => {
  assert.equal(answerOf(printed({})), '[{"op":"next"}]')
})

test('an error, a cut-off print or output that is not JSON gives no answer', () => {
  assert.equal(answerOf(printed({ is_error: true, subtype: 'error_during_execution' })), null)
  assert.equal(answerOf(printed({ result: undefined })), null)
  assert.equal(answerOf('{"type":"res'), null)
  assert.equal(answerOf(''), null)
})

test('the planner runs with none of the person\'s setup, no tools, the small model at low effort, and saves no session', () => {
  const args = plannerArgs('SYSTEM', 'PROMPT')

  for (const flag of ['--print', '--safe-mode', '--strict-mcp-config', '--no-session-persistence']) assert.ok(args.includes(flag), flag)
  const value = (flag: string) => args[args.indexOf(flag) + 1]
  assert.equal(value('--tools'), '')
  assert.equal(value('--model'), 'claude-haiku-5-5')
  assert.equal(value('--effort'), 'low')
  assert.equal(value('--output-format'), 'json')
  assert.equal(value('--system-prompt'), 'SYSTEM')
  assert.equal(args.at(-1), 'PROMPT')
})
