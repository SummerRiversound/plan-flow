import { expect, test } from 'claude-code/testing'
import { emptyPlan } from './plan'
import { EXPECTED_RULE } from './plan-tool'
import { designPrompt, MAX_LOG, PLANNER_SYSTEM, parseOps, plannerPrompt, remember, toolLine } from './planner'
import type { Happened } from './planner'

test('a tool call is one line: what it says it is for, else the file it touches, never a whole command or file', () => {
  expect(toolLine('Bash', { command: 'npm test -- --watch=false', description: 'Run the tests' })).toBe('Run the tests')
  // A command with no description is cut short: words inside it (a prompt sent elsewhere) are not this session's work.
  expect(toolLine('Bash', { command: `tmux send-keys -t test "add a divide function and run the tests ${'x'.repeat(400)}"` }).length).toBeLessThanOrEqual(80)
  expect(toolLine('Edit', { file_path: '/repo/src/cart.js', old_string: 'secret', new_string: 'b' })).toBe('Edit cart.js')
  expect(toolLine('Agent', { description: 'Review the diff', prompt: 'long brief' })).toBe('Agent: Review the diff')
  expect(toolLine('WebFetch', { url: 'https://example.com' })).toBe('WebFetch')
})

test('the log keeps the newest lines and cuts long answers', () => {
  let log: Happened[] = []
  for (let i = 0; i < MAX_LOG + 5; i++) log = remember(log, { kind: 'tool', text: `call ${i}` })
  expect(log).toHaveLength(MAX_LOG)
  expect(log[0]?.text).toBe('call 5')
  expect(remember([], { kind: 'answer', text: 'ㄱ'.repeat(2000) })[0]?.text.length).toBeLessThanOrEqual(800)
  expect(remember([], { kind: 'answer', text: '   ' })).toEqual([])
})

test('the planner reads the board and what happened, oldest first', () => {
  const p = plannerPrompt({ plan: emptyPlan(), shelf: [] }, [
    { kind: 'request', text: '쿠폰 기능 추가해줘' },
    { kind: 'tool', text: 'Edit cart.js' },
    { kind: 'answer', text: '추가했어요' },
  ])
  expect(p).toContain('The board is empty.')
  expect(p.indexOf('The person asked: 쿠폰 기능 추가해줘')).toBeLessThan(p.indexOf('Claude ran: Edit cart.js'))
  expect(p).toContain('Claude answered: 추가했어요')
})

test("the planner's answer is read as ops; prose, fences, bad ops and show are left out", () => {
  expect(parseOps('```json\n[{"op":"next"},{"op":"show"},{"op":"fly"}]\n```')).toEqual([{ op: 'next' }])
  expect(parseOps('Sure! [{"op":"set","title":"T","nodes":[{"title":"a"}]}]')).toHaveLength(1)
  expect(parseOps('[]')).toEqual([])
  expect(parseOps('no ops here')).toEqual([])
  expect(parseOps('[{"op":')).toEqual([])
})

test('the planner is told the field names the board reads, so its steps are not dropped', () => {
  for (const field of ['"nodes"', '"children"', '"updates"', '"parent"', '"expected"']) expect(PLANNER_SYSTEM).toContain(field)
  const ops = parseOps('[{"op":"set","title":"Coupons","goal":"Carts take coupons.","nodes":[{"title":"Fixed coupon","detail":"Takes an amount off.","children":[{"title":"Its test","detail":"Proves it."}]}]}]')
  expect(ops).toHaveLength(1)
})

test('the planner keeps a step open while Claude waits for the person to answer, so the board can say it waits', () => {
  expect(PLANNER_SYSTEM).toContain('When Claude\'s answer asks the person to approve, choose or say whether to go on')
})

test('work Claude goes on with unasked is a step; only work waiting on the person or someone else hangs dotted', () => {
  const board = { plan: emptyPlan(), shelf: [] }
  for (const prompt of [PLANNER_SYSTEM, designPrompt(board as never)]) expect(prompt).toContain(EXPECTED_RULE)
  expect(EXPECTED_RULE).toContain('without asking')
  expect(EXPECTED_RULE).toContain('waits on the person')
  // The design no longer turns every merge or release into a step of its own.
  expect(designPrompt(board as never)).not.toContain('review, merge or release where')
})
