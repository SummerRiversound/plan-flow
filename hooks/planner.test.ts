import { expect, test } from 'claude-code/testing'
import { emptyPlan } from './plan'
import { describeBoard, EXPECTED_RULE, runOp } from './plan-tool'
import { designPrompt, MAX_LOG, PLANNER_SYSTEM, parseOps, plannerPrompt, remember, runDesign, toolLine } from './planner'
import type { Happened } from './planner'

test('a tool call is one line: what it says it is for, else the file it touches, never a whole command or file', () => {
  expect(toolLine('Bash', { command: 'npm test -- --watch=false', description: 'Run the tests' })).toBe('Run the tests')
  // A command with no description is cut short: words inside it (a prompt sent elsewhere) are not this session's work.
  expect(toolLine('Bash', { command: `tmux send-keys -t test "add a divide function and run the tests ${'x'.repeat(400)}"` }).length).toBeLessThanOrEqual(80)
  expect(toolLine('Edit', { file_path: '/repo/src/cart.js', old_string: 'secret', new_string: 'b' })).toBe('Edit cart.js')
  expect(toolLine('Agent', { description: 'Review the diff', prompt: 'long brief' })).toBe('Agent: Review the diff')
  expect(toolLine('WebFetch', { url: 'https://example.com' })).toBe('WebFetch')
})

test('a call to a connected tool says what it did in its short fields, never an id, an address or a long text', () => {
  expect(toolLine('mcp__notes__update-page', { page_id: 'a1b2c3', command: 'update_properties', properties: { 상태: '완료', 진행률: 50 } })).toBe('update-page: command update_properties, properties 상태 완료')
  expect(toolLine('mcp__browser__batch', { actions: [{ action: 'left_click', tabId: 7, action_summary: '저장 버튼 누르기' }, { action: 'screenshot', tabId: 7 }] })).toBe('batch: actions action left_click, action_summary 저장 버튼 누르기; action screenshot')
  // A message sent elsewhere reads like a request of this session: only its short summary is carried.
  expect(toolLine('SendMessage', { to: 'reviewer', summary: '리뷰 요청', message: `please deploy the app and then ${'x'.repeat(200)}` })).toBe('SendMessage: to reviewer, summary 리뷰 요청')
  expect(toolLine('mcp__drive__delete_item', { driveId: 'b!abc', itemId: '01XYZ' })).toBe('delete_item')
  expect(toolLine('mcp__notes__search', { query: 'ㄱ'.repeat(40), filters: { a: { b: { c: 'deep' } } } }).length).toBeLessThanOrEqual(120)
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

test('Claude, designing, says where each step stands: its statuses land, and a step it adds as done is done', () => {
  const prompt = designPrompt({ plan: emptyPlan(), shelf: [] })
  expect(prompt).toContain('give each the status that is true now')
  expect(prompt).not.toContain('leave every status as it is')
  // What the last answer left with the person stays on the board, a finished plan's included.
  expect(prompt).toContain('go back over your last answer for every question you asked')
  // A name Claude writes may run a few words longer than the planner's.
  expect(prompt).not.toContain('Every title is at most 4 words.')
  expect(PLANNER_SYSTEM).toContain('Every title is at most 4 words.')

  const start = runOp({ plan: emptyPlan(), shelf: [] }, { op: 'set', title: 'Coupons', nodes: [{ title: 'Fixed coupon' }, { title: 'Percent coupon' }] }, 1)
  if ('error' in start) throw new Error(start.error)
  const answer = JSON.stringify([
    { op: 'update', updates: [{ id: '1', status: 'completed' }] },
    { op: 'set', title: 'Another plan', nodes: [{ title: 'x' }], previous: 'cancel' },
    { op: 'add', parent: '2', nodes: [{ title: 'Its test', status: 'completed' }, { title: 'Rounding', status: 'skipped', note: 'whole amounts only' }, { title: 'Stacking' }] },
  ])
  const ran = runDesign(start.board, answer, 2)
  // The fork never swaps the plan in hand; the two ops it may use ran.
  expect(ran.applied).toBe(2)
  const board = describeBoard(ran.board)
  expect(board).toContain('Plan: Coupons')
  expect(board).toContain('1 Fixed coupon - completed')
  expect(board).toContain('2.1 Its test - completed')
  expect(board).toContain('2.2 Rounding - skipped')
  expect(board).toContain('2.3 Stacking - pending')
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
