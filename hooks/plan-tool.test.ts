import { expect, test } from 'claude-code/testing'
import { emptyPlan } from './plan'
import type { Plan } from './plan'
import type { Board } from './board'
import { FLAT_HINT, NO_PLAN_NOTE, missingDetail, boardNote, describePlan, instruction, parseOp, runOp, TOOL_DESCRIPTION, TOOL_SCHEMA } from './plan-tool'
import { setLanguage } from './i18n'

// The expectations below are written in Korean.
setLanguage('ko')

const run = (board: Board, raw: unknown, now = 0): { board: Board; text: string; notice?: string } => {
  const parsed = parseOp(raw)
  if ('error' in parsed) throw new Error(parsed.error)
  const out = runOp(board, parsed.op, now)
  if ('error' in out) throw new Error(out.error)

  return out
}
const apply = (plan: Plan, raw: unknown, now = 0): { plan: Plan; text: string } => {
  const out = run({ plan, shelf: [] }, raw, now)

  return { plan: out.board.plan, text: out.text }
}
const error = (plan: Plan, raw: unknown): string => {
  const parsed = parseOp(raw)
  if ('error' in parsed) return parsed.error
  const out = runOp({ plan, shelf: [] }, parsed.op, 0)

  return 'error' in out ? out.error : 'no error'
}

const SET = { op: 'set', title: '로그인 기능 추가', nodes: [{ title: '조사' }, { title: '구현', children: [{ title: '화면' }, { title: 'API' }] }] }

test('every op is offered in the schema, next among them', () => {
  const op = (TOOL_SCHEMA.properties as Record<string, { enum?: string[] }>).op
  expect(op?.enum).toEqual(['set', 'next', 'update', 'add', 'remove', 'move', 'resume', 'cancel', 'show'])
  expect(TOOL_DESCRIPTION).toContain('"next"')
})

test('set answers the plan with ids, statuses and the done count', () => {
  const { text } = apply(emptyPlan(), SET)
  expect(text).toBe(['Plan: 로그인 기능 추가 (0/3 done)', '1 조사 - pending', '2 구현 - pending', '  2.1 화면 - pending', '  2.2 API - pending', missingDetail(['1', '2', '2.1', '2.2'])].join('\n'))
})

test('next and update change statuses by id', () => {
  let { plan } = apply(emptyPlan(), SET)
  plan = apply(plan, { op: 'next' }, 1).plan
  plan = apply(plan, { op: 'next' }, 2).plan
  const out = apply(plan, { op: 'update', updates: [{ id: '2.1', status: 'blocked', note: '디자인 대기' }] }, 3)
  expect(out.text).toContain('1 조사 - completed')
  expect(out.text).toContain('  2.1 화면 - blocked (디자인 대기)')
  expect(error(out.plan, { op: 'next', id: '2.1' })).toMatch(/^Error: "2.1" is not in_progress/)
})

test('next with an id finishes that step', () => {
  let { plan } = apply(emptyPlan(), SET)
  plan = apply(plan, { op: 'next' }, 1).plan
  expect(apply(plan, { op: 'next', id: '1' }, 2).text).toContain('  2.1 화면 - in_progress')
})

test('add, remove and show', () => {
  let { plan } = apply(emptyPlan(), SET)
  plan = apply(plan, { op: 'add', parent: '2', nodes: [{ title: '세션' }] }).plan
  expect(plan.nodes.map(n => n.id)).toEqual(['1', '2', '2.1', '2.2', '2.3'])
  plan = apply(plan, { op: 'remove', id: '2.2' }).plan
  expect(apply(plan, { op: 'show' }).text).toContain('  2.3 세션 - pending')
  expect(apply(emptyPlan(), { op: 'show' }).text).toContain('No plan yet')
})

test('a parallel group is tagged in the answer', () => {
  const { text } = apply(emptyPlan(), { op: 'set', title: 'T', nodes: [{ title: '검증', parallel: true, children: [{ title: '테스트' }, { title: '문서' }] }] })
  expect(text).toContain('1 검증 - pending, parallel')
})

test('malformed input is refused with an Error line that says what is wrong', () => {
  expect(error(emptyPlan(), 'set')).toMatch(/^Error: .*object/)
  expect(error(emptyPlan(), {})).toMatch(/^Error: .*"op"/)
  expect(error(emptyPlan(), { op: 'explode' })).toMatch(/^Error: .*unknown op/)
  expect(error(emptyPlan(), { op: 'set', title: 'T', nodes: 'a' })).toMatch(/^Error: .*nodes must be a list/)
  expect(error(emptyPlan(), { op: 'set', title: 'T', nodes: [{ name: 'a' }] })).toMatch(/^Error: .*nodes\[0\]\.title/)
  expect(error(emptyPlan(), { op: 'update', updates: [{ id: '1', status: 'done' }] })).toMatch(/^Error: .*status "done"/)
  expect(error(emptyPlan(), { op: 'remove' })).toMatch(/^Error: .*"id"/)
  expect(error(emptyPlan(), { op: 'next', id: 3 })).toMatch(/^Error: .*id must be text/)
  // A model's mistake on a real plan comes back the same way.
  expect(error(apply(emptyPlan(), SET).plan, { op: 'update', updates: [{ id: '7', status: 'completed' }] })).toMatch(/^Error: unknown id "7"/)
})

test('the answer stays under 4000 characters for the largest plan', () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({ title: `${'긴 단계 이름 '.repeat(10)}${i}`, children: [{ title: 'a'.repeat(110) }, { title: 'b'.repeat(110) }] }))
  const { text } = apply(emptyPlan(), { op: 'set', title: 'T', nodes })
  expect(text.length).toBeLessThanOrEqual(4000)
  expect(text).toContain('more steps not shown')
})

test('the instruction names the tool, next, short titles and leaving the drawing alone', () => {
  const t = instruction('mcp__plan-flow__plan')
  expect(t).toContain('mcp__plan-flow__plan')
  expect(t).toContain('"next"')
  expect(t).toContain('4 words')
  expect(t).toContain("user's language")
  expect(t).toMatch(/never describe/i)
})

test('describePlan of an empty plan tells how to start one', () => {
  expect(describePlan(emptyPlan())).toContain('"set"')
})

test('a detour parks the plan, the answer says so and lists the shelf', () => {
  const first = run({ plan: emptyPlan(), shelf: [] }, SET)
  expect(error(first.board.plan, { op: 'set', title: '버그', nodes: [{ title: '재현' }] })).toContain('previous "park"')
  const out = run(first.board, { op: 'set', title: '버그', nodes: [{ title: '재현' }], previous: 'park' })
  expect(out.notice).toBe('"로그인 기능 추가" 보관 · "버그" 시작')
  expect(out.text).toContain('Parked: "로그인 기능 추가" (0/3 done)')
  expect(run(out.board, { op: 'resume', previous: 'park' }).board.plan.title).toBe('로그인 기능 추가')
  expect(run(out.board, { op: 'cancel' }).board.plan.title).toBe('로그인 기능 추가')
})

test('move, resume and previous are read and checked', () => {
  expect(parseOp({ op: 'move', id: '2', before: '1' })).toEqual({ op: { op: 'move', id: '2', before: '1' } })
  expect(parseOp({ op: 'resume', title: '로그인' })).toEqual({ op: { op: 'resume', title: '로그인' } })
  const bad = parseOp({ op: 'set', title: 'x', nodes: [{ title: 'a' }], previous: 'drop' })
  expect('error' in bad && bad.error).toContain('"park" or "cancel"')
})

test('each request carries a note while a plan is on the board, with the cases to sort it into', () => {
  const board = run({ plan: emptyPlan(), shelf: [] }, SET).board
  const note = boardNote(board) ?? ''
  expect(note).toContain('In hand: "로그인 기능 추가" (0/3 done, in hand: 조사 (id 1))')
  for (const op of ['"add"', '"pending"', 'previous "park"', 'previous "cancel"', 'fresh session', '"resume"']) expect(note).toContain(op)
  const parked = run(board, { op: 'set', title: '버그', nodes: [{ title: '재현' }], previous: 'park' }).board
  expect(boardNote(parked)).toContain('Parked: "로그인 기능 추가" (0/3)')
})

test('steps carry a one-line detail, set with the step or by update, and an empty one clears it', () => {
  const { plan } = apply(emptyPlan(), { op: 'set', title: 'T', nodes: [{ title: '조사', detail: '기존 로그인 코드를 읽고 바꿀 곳을 찾기' }] })
  expect(plan.nodes[0]?.detail).toBe('기존 로그인 코드를 읽고 바꿀 곳을 찾기')
  const changed = apply(plan, { op: 'update', updates: [{ id: '1', detail: '다른 설명' }] }).plan
  expect(changed.nodes[0]?.detail).toBe('다른 설명')
  expect(apply(changed, { op: 'update', updates: [{ id: '1', detail: '' }] }).plan.nodes[0]?.detail).toBeUndefined()
  expect(error(emptyPlan(), { op: 'set', title: 'T', nodes: [{ title: 'a', detail: 3 }] })).toMatch(/^Error: .*detail must be text/)
  expect(instruction('t')).toContain('detail')
})

test('steps carry links: set with the step, added by update without repeats, cleared by an empty list', () => {
  const set = apply(emptyPlan(), { op: 'set', title: 'T', nodes: [{ title: 'a', links: ['https://github.com/o/r/pull/1'] }] }).plan
  expect(set.nodes[0]?.links).toEqual(['https://github.com/o/r/pull/1'])
  const more = apply(set, { op: 'update', updates: [{ id: '1', links: ['https://github.com/o/r/pull/1', '/tmp/out.md'] }] }).plan
  expect(more.nodes[0]?.links).toEqual(['https://github.com/o/r/pull/1', '/tmp/out.md'])
  expect(apply(more, { op: 'update', updates: [{ id: '1', links: [] }] }).plan.nodes[0]?.links).toBeUndefined()
  expect(error(emptyPlan(), { op: 'set', title: 'T', nodes: [{ title: 'a', links: 'x' }] })).toMatch(/links must be a list of text/)
  expect(error(emptyPlan(), { op: 'set', title: 'T', nodes: [{ title: 'a', links: ['a b'] }] })).toMatch(/a link has no spaces/)
  expect(error(emptyPlan(), { op: 'set', title: 'T', nodes: [{ title: 'a', links: ['1', '2', '3', '4', '5', '6'] }] })).toMatch(/at most 5 links/)
  expect(instruction('t')).toContain('"links"')
})

test('the op that finishes the last step carries the summary; it is refused while steps are open and goes when one reopens', () => {
  const summary = { goal: '로그인 기능을 앱에 붙이기', result: '화면과 API를 만들고 폰에서 확인했어요' }
  let { plan } = apply(emptyPlan(), SET)
  plan = apply(plan, { op: 'next' }).plan
  expect(error(plan, { op: 'next', summary })).toContain('steps are still open')
  plan = apply(plan, { op: 'next' }).plan
  plan = apply(plan, { op: 'next' }).plan
  const last = apply(plan, { op: 'next' })
  // Finished without one, the answer asks for it.
  expect(last.text).toContain('send op "update" with "summary"')
  const closed = apply(last.plan, { op: 'update', summary })
  expect(closed.plan.summary).toEqual(summary)
  expect(closed.text).not.toContain('send op "update"')
  expect(apply(plan, { op: 'next', summary }).plan.summary).toEqual(summary)
  expect(error(last.plan, { op: 'update', summary: { goal: '목적' } })).toContain('summary.result must be text')
  expect(apply(closed.plan, { op: 'update', updates: [{ id: '1', status: 'pending' }] }).plan.summary).toBeUndefined()
  expect(apply(closed.plan, { op: 'add', nodes: [{ title: '배포' }] }).plan.summary).toBeUndefined()
})

test('a flat list of five or more steps is answered with a hint to group them under stages', () => {
  const flat = apply(emptyPlan(), { op: 'set', title: '정리', nodes: ['가', '나', '다', '라', '마'].map(title => ({ title })) })
  expect(flat.text).toContain(FLAT_HINT)
  const nested = apply(emptyPlan(), { op: 'set', title: '정리', nodes: [{ title: '준비', children: [{ title: '가' }, { title: '나' }] }, { title: '작업', children: [{ title: '다' }, { title: '라' }, { title: '마' }] }] })
  expect(nested.text).not.toContain(FLAT_HINT)
  // Resent nested under the same title, the steps keep their status.
  const done = apply(apply(flat.plan, { op: 'next' }).plan, { op: 'next' }).plan
  const regrouped = apply(done, { op: 'set', title: '정리', nodes: [{ title: '준비', children: [{ title: '가' }, { title: '나' }] }, { title: '작업', children: [{ title: '다' }, { title: '라' }, { title: '마' }] }] })
  expect(regrouped.plan.nodes.find(n => n.title === '가')?.status).toBe('completed')
  expect(instruction('plan')).toContain('2 to 5 stages')
})

test('a request with no plan on the board is reminded to set one before working, and that a question needs none', () => {
  expect(boardNote({ plan: emptyPlan(), shelf: [] })).toBe(NO_PLAN_NOTE)
  expect(NO_PLAN_NOTE).toContain('op "set"')
  expect(NO_PLAN_NOTE).toMatch(/question/)
  expect(NO_PLAN_NOTE.split('\n')).toHaveLength(1)
})

test('the instruction keeps stages to parts of the outcome: no stage named for the routine, the routine inside a stage, no lump, no stage holding a single task', () => {
  const t = instruction('plan')
  expect(t).toMatch(/not phases/)
  expect(t).toMatch(/fit any other task unchanged/)
  expect(t).toMatch(/goes inside the stage it serves/)
  expect(t).toMatch(/more than half/)
  expect(t).toMatch(/single task/)
})

test('steps set or added without a detail are named back, so Claude fills them in', () => {
  const out = apply(emptyPlan(), { op: 'set', title: '정리', nodes: [{ title: '준비', detail: '왜 하는지', children: [{ title: '가' }, { title: '나', detail: '설명' }] }] })
  expect(out.text).toContain(missingDetail(['1.1']))
  const full = apply(emptyPlan(), { op: 'set', title: '정리', nodes: [{ title: '가', detail: '설명' }] })
  expect(full.text).not.toContain('no detail')
})

test('the instruction keeps steps at the level of following the work, not the code', () => {
  const t = instruction('plan')
  expect(t).toMatch(/not the edits/)
  expect(t).toMatch(/no file names, code or commands/)
})
