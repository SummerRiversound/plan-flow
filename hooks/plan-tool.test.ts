import { expect, test } from 'claude-code/testing'
import { emptyPlan } from './plan'
import type { Plan } from './plan'
import { describePlan, instruction, parseOp, runOp, TOOL_DESCRIPTION, TOOL_SCHEMA } from './plan-tool'

const apply = (plan: Plan, raw: unknown, now = 0): { plan: Plan; text: string } => {
  const parsed = parseOp(raw)
  if ('error' in parsed) throw new Error(parsed.error)
  const out = runOp(plan, parsed.op, now)
  if ('error' in out) throw new Error(out.error)

  return out
}
const error = (plan: Plan, raw: unknown): string => {
  const parsed = parseOp(raw)
  if ('error' in parsed) return parsed.error
  const out = runOp(plan, parsed.op, 0)

  return 'error' in out ? out.error : 'no error'
}

const SET = { op: 'set', title: '로그인 기능 추가', nodes: [{ title: '조사' }, { title: '구현', children: [{ title: '화면' }, { title: 'API' }] }] }

test('every op is offered in the schema, next among them', () => {
  const op = (TOOL_SCHEMA.properties as Record<string, { enum?: string[] }>).op
  expect(op?.enum).toEqual(['set', 'next', 'update', 'add', 'remove', 'show'])
  expect(TOOL_DESCRIPTION).toContain('"next"')
})

test('set answers the plan with ids, statuses and the done count', () => {
  const { text } = apply(emptyPlan(), SET)
  expect(text).toBe(['Plan: 로그인 기능 추가 (0/3 done)', '1 조사 - pending', '2 구현 - pending', '  2.1 화면 - pending', '  2.2 API - pending'].join('\n'))
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
