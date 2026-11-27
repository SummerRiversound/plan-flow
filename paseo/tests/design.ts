import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyBoard } from '../shared/board'
import { type Happened, replayDesignPrompt } from '../shared/planner'

test('a replayed design reads the newest of the session in full and, before it, only the requests and answers, with the rules a log shows less plainly', () => {
  const log: Happened[] = [{ kind: 'request', text: 'the first request' }, { kind: 'answer', text: `the first answer ${'z'.repeat(1000)}` }, ...Array.from({ length: 400 }, (_, i): Happened => ({ kind: 'tool', text: `call ${i} ${'y'.repeat(200)}` })), { kind: 'answer', text: 'the last answer' }]

  const prompt = replayDesignPrompt(emptyBoard(), log)
  // The oldest calls fell off; what was asked and answered then stays, cut short.
  assert.ok(!prompt.includes('call 0 '))
  assert.ok(prompt.indexOf('- The person asked: the first request') < prompt.indexOf('call 399'))
  assert.ok(prompt.includes('the first answer'))
  assert.ok(!prompt.includes('z'.repeat(400)))
  assert.ok(prompt.includes('- Claude answered: the last answer'))
  assert.ok(prompt.indexOf('call 399') < prompt.indexOf('the last answer'))
  assert.ok(prompt.includes('"parallel": true'))
  assert.ok(prompt.includes('a pull request ready for review) is "completed"'))
  assert.ok(prompt.includes('("needs_check")'))
})
