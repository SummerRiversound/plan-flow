import { expect, test } from 'claude-code/testing'
import { emptyPlan } from './plan'
import type { Plan } from './plan'
import type { Board } from './board'
import { DETOUR_HINT, FINISHED_ADD_HINT, FLAT_HINT, GOAL_DRIFT_HINT, NO_GOAL, missingDetail, routineHint, describeBoard, describePlan, parseOp, runOp, TOOL_DESCRIPTION } from './plan-tool'
import { PLANNER_SYSTEM } from './planner'
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

const SET = { op: 'set', title: '로그인 기능 추가', nodes: [{ title: '조사' }, { title: '로그인 동작', children: [{ title: '화면' }, { title: 'API' }] }] }

test('every op the board runs is described for the planner', () => {
  for (const op of ['set', 'next', 'update', 'add', 'remove', 'move', 'resume', 'cancel']) expect(TOOL_DESCRIPTION).toContain(`op "${op}"`)
  expect(PLANNER_SYSTEM).toContain(TOOL_DESCRIPTION)
})

test('set answers the plan with ids, statuses and the done count', () => {
  const { text } = apply(emptyPlan(), SET)
  expect(text).toBe(['Plan: 로그인 기능 추가 (0/3 done)', '1 조사 - pending', '2 로그인 동작 - pending', '  2.1 화면 - pending', '  2.2 API - pending', missingDetail(['1', '2', '2.1', '2.2']), NO_GOAL].join('\n'))
})

test('the goal is set with the plan, kept when the plan is resent, rewritten or cleared by update, and read back', () => {
  let { plan, text } = apply(emptyPlan(), { ...SET, goal: '아이디로 로그인되게 하기' })
  expect(plan.goal).toBe('아이디로 로그인되게 하기')
  expect(text.split('\n').slice(0, 2)).toEqual(['Plan: 로그인 기능 추가 (0/3 done)', 'Goal: 아이디로 로그인되게 하기'])
  expect(text).not.toContain(NO_GOAL)
  plan = apply(plan, SET).plan
  expect(plan.goal).toBe('아이디로 로그인되게 하기')
  plan = apply(plan, { op: 'update', goal: '로그인과 회원가입까지 열기' }).plan
  expect(plan.goal).toBe('로그인과 회원가입까지 열기')
  expect(apply(plan, { op: 'update', goal: '' }).plan.goal).toBeUndefined()
  expect(error(plan, { op: 'update', goal: 3 })).toMatch(/goal must be text/)
  expect(error(plan, { op: 'update', goal: 'ㄱ'.repeat(161) })).toMatch(/goal is longer than 160/)
})

test('update renames the plan once its subject is known, keeping its steps and goal', () => {
  let plan = apply(emptyPlan(), { ...SET, title: '현재 PR 머지', goal: '현재 PR을 머지하기' }).plan
  plan = apply(plan, { op: 'update', updates: [{ id: '1', status: 'completed' }] }).plan
  const { plan: renamed, text } = apply(plan, { op: 'update', title: '로그인 PR 머지', goal: '로그인 기능 PR을 머지하기' })
  expect(renamed.title).toBe('로그인 PR 머지')
  expect(renamed.goal).toBe('로그인 기능 PR을 머지하기')
  expect(renamed.nodes).toEqual(plan.nodes)
  expect(text.split('\n')[0]).toBe('Plan: 로그인 PR 머지 (1/3 done)')
  expect(error(plan, { op: 'update', title: '' })).toMatch(/plan title is empty/)
  expect(error(plan, { op: 'update', title: 3 })).toMatch(/title must be text/)
})

test('the planner is told to name the work by its subject, not by "current" or a bare number', () => {
  expect(PLANNER_SYSTEM).toMatch(/never "this" or "current"/)
  expect(TOOL_DESCRIPTION).toMatch(/its "title" renames the plan/)
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

test('the planner is told to keep titles short, in the language the person writes in, and to answer with ops alone', () => {
  expect(PLANNER_SYSTEM).toContain('4 words')
  expect(PLANNER_SYSTEM).toContain('language the person writes in')
  expect(PLANNER_SYSTEM).toMatch(/only a JSON array/)
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

test('the planner sees the plans this session finished and can bring one back when the work returns to it', () => {
  let board = run({ plan: emptyPlan(), shelf: [] }, SET).board
  for (let i = 0; i < 4; i++) board = run(board, { op: 'next' }).board
  board = run(board, { op: 'set', title: '버그', nodes: [{ title: '재현' }] }).board
  expect(describeBoard(board)).toContain('Finished: "로그인 기능 추가" (3/3 done)')
  const back = run(board, { op: 'resume', title: '로그인 기능 추가', previous: 'park' }).board
  expect(back.plan.title).toBe('로그인 기능 추가')
  expect(back.shelf.map(s => [s.plan.title, s.state])).toEqual([['버그', 'parked']])
  expect(PLANNER_SYSTEM).toContain('parked or finished')
})

test('move, resume and previous are read and checked', () => {
  expect(parseOp({ op: 'move', id: '2', before: '1' })).toEqual({ op: { op: 'move', id: '2', before: '1' } })
  expect(parseOp({ op: 'resume', title: '로그인' })).toEqual({ op: { op: 'resume', title: '로그인' } })
  const bad = parseOp({ op: 'set', title: 'x', nodes: [{ title: 'a' }], previous: 'drop' })
  expect('error' in bad && bad.error).toContain('"park" or "cancel"')
})

test('the planner is told to put continuing work under the stage it continues and to park a detour', () => {
  const board = run(run(run({ plan: emptyPlan(), shelf: [] }, SET).board, { op: 'next' }).board, { op: 'next' }).board
  expect(board.plan.nodes.find(n => n.id === '2')?.status).toBe('in_progress')
  expect(PLANNER_SYSTEM).toContain('under the stage it continues')
  expect(PLANNER_SYSTEM).toContain('previous "park"')
})

test('a goal rewritten a second time suggests a new plan; the first rewrite, a resend and a clear do not', () => {
  let { plan, text } = apply(emptyPlan(), { ...SET, goal: '로그인' })
  expect(text).not.toContain(GOAL_DRIFT_HINT)
  ;({ plan, text } = apply(plan, { op: 'update', goal: '로그인과 회원가입' }))
  expect(text).not.toContain(GOAL_DRIFT_HINT)
  ;({ plan, text } = apply(plan, { op: 'update', goal: '로그인과 회원가입' }))
  expect(text).not.toContain(GOAL_DRIFT_HINT)
  ;({ plan, text } = apply(plan, { op: 'update', goal: '계정 전체 관리' }))
  expect(text).toContain(GOAL_DRIFT_HINT)
  expect(apply(plan, { op: 'update', goal: '' }).text).not.toContain(GOAL_DRIFT_HINT)
})

test('work added to a finished plan suggests a new plan once, while the plan still reads as finished', () => {
  let { plan } = apply(emptyPlan(), { op: 'set', title: 'T', goal: 'g', nodes: [{ title: '조사', detail: 'd' }] })
  plan = apply(plan, { op: 'update', updates: [{ id: '1', status: 'completed' }], summary: { goal: 'g', result: 'r' } }).plan
  const added = apply(plan, { op: 'add', nodes: [{ title: '후속', detail: 'd' }] })
  expect(added.text).toContain(FINISHED_ADD_HINT)
  expect(apply(added.plan, { op: 'add', nodes: [{ title: '하나 더', detail: 'd' }] }).text).not.toContain(FINISHED_ADD_HINT)
})

test('a new top-level stage on a plan with open work asks whether it is a detour to park; a step under a stage does not', () => {
  const plan = apply(emptyPlan(), { ...SET, goal: 'g' }).plan
  expect(apply(plan, { op: 'add', nodes: [{ title: '버그 수정', detail: 'd' }] }).text).toContain(DETOUR_HINT)
  expect(apply(plan, { op: 'add', parent: '2', nodes: [{ title: '소셜 로그인', detail: 'd' }] }).text).not.toContain(DETOUR_HINT)
  expect(DETOUR_HINT).toContain('previous "park"')
})

test('work added to a finished plan gets the new-plan hint, not the detour one', () => {
  let { plan } = apply(emptyPlan(), { op: 'set', title: 'T', goal: 'g', nodes: [{ title: '조사', detail: 'd' }] })
  plan = apply(plan, { op: 'update', updates: [{ id: '1', status: 'completed' }], summary: { goal: 'g', result: 'r' } }).plan
  const text = apply(plan, { op: 'add', nodes: [{ title: '후속', detail: 'd' }] }).text
  expect(text).toContain(FINISHED_ADD_HINT)
  expect(text).not.toContain(DETOUR_HINT)
})

test('steps carry a one-line detail, set with the step or by update, and an empty one clears it', () => {
  const { plan } = apply(emptyPlan(), { op: 'set', title: 'T', nodes: [{ title: '조사', detail: '기존 로그인 코드를 읽고 바꿀 곳을 찾기' }] })
  expect(plan.nodes[0]?.detail).toBe('기존 로그인 코드를 읽고 바꿀 곳을 찾기')
  const changed = apply(plan, { op: 'update', updates: [{ id: '1', detail: '다른 설명' }] }).plan
  expect(changed.nodes[0]?.detail).toBe('다른 설명')
  expect(apply(changed, { op: 'update', updates: [{ id: '1', detail: '' }] }).plan.nodes[0]?.detail).toBeUndefined()
  expect(error(emptyPlan(), { op: 'set', title: 'T', nodes: [{ title: 'a', detail: 3 }] })).toMatch(/^Error: .*detail must be text/)
  expect(PLANNER_SYSTEM).toContain('detail')
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
  expect(PLANNER_SYSTEM).toContain('"links"')
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
  expect(PLANNER_SYSTEM).toContain('2 to 5 stages')
})

test('the planner rules keep stages to parts of the outcome: no stage named for the routine, the routine inside a stage, no lump, no stage holding a single task', () => {
  const t = PLANNER_SYSTEM
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

test('the planner rules keep steps at the level of following the work, not the code', () => {
  const t = PLANNER_SYSTEM
  expect(t).toMatch(/not the edits/)
  expect(t).toMatch(/no file names, code or commands/)
})

test('stages named only for the repo routine are named back, so Claude renames them for what the task produces', () => {
  const nodes = [
    { title: '결정 기록', detail: '왜', children: [{ title: '이슈에 결정 남기기', detail: '왜' }] },
    { title: '재시작해도 메모 유지', detail: '왜', children: [{ title: '파일 저장', detail: '왜' }, { title: '테스트로 확인', detail: '왜' }] },
    { title: 'PR로 마무리', detail: '왜' },
  ]
  expect(apply(emptyPlan(), { op: 'set', title: '메모 저장', nodes }).text).toContain(routineHint(['1', '3']))
  const en = [{ title: 'Set up the worktree', detail: 'w' }, { title: 'Each memo shows a button', detail: 'w' }, { title: 'Commit and open the PR', detail: 'w' }]
  expect(apply(emptyPlan(), { op: 'set', title: 'Delete', nodes: en }).text).toContain(routineHint(['1', '3']))
})

test('stages named for an outcome, a plan of one stage and steps added later carry no routine hint', () => {
  const outcome = [
    { title: '원인 확인', detail: '왜' },
    { title: '메모가 글자 그대로 보임', detail: '왜', children: [{ title: '실패하는 테스트', detail: '왜' }, { title: 'PR 열기', detail: '왜' }] },
  ]
  expect(apply(emptyPlan(), { op: 'set', title: '메모 표시', nodes: outcome }).text).not.toContain('named for the routine')
  expect(apply(emptyPlan(), { op: 'set', title: 'PR', nodes: [{ title: 'PR 열기', detail: '왜' }] }).text).not.toContain('named for the routine')
  const set = apply(emptyPlan(), { op: 'set', title: '메모 표시', nodes: outcome })
  expect(apply(set.plan, { op: 'add', nodes: [{ title: '커밋', detail: '왜' }] }).text).not.toContain('named for the routine')
})

test('expected steps ride after the plan: at most two, never counted, gone once one is on the plan, kept once the plan is done', () => {
  let { plan, text } = apply(emptyPlan(), { op: 'set', title: '헤더 다듬기', goal: 'g', nodes: [{ title: '헤더 적용' }, { title: '변경 올리기' }], expected: ['리뷰 반영', '릴리즈', '배포 확인', 7] })
  expect(plan.expected).toEqual(['리뷰 반영', '릴리즈'])
  expect(text).toContain('Expected after the plan, not counted: 리뷰 반영; 릴리즈')
  expect(text).toContain('(0/2 done)')
  // A step of the same title on the plan takes its place.
  plan = apply(plan, { op: 'add', nodes: [{ title: '리뷰 반영', detail: 'd' }] }).plan
  expect(plan.expected).toEqual(['릴리즈'])
  // Op update replaces the list; an empty one clears it.
  plan = apply(plan, { op: 'update', expected: ['릴리즈 노트'] }).plan
  expect(plan.expected).toEqual(['릴리즈 노트'])
  expect(apply(plan, { op: 'update', expected: [] }).plan.expected).toBeUndefined()
  // A finished plan keeps what is expected next, since that work is still to come.
  plan = apply(plan, { op: 'update', updates: ['1', '2', '3'].map(id => ({ id, status: 'completed' })) }).plan
  expect(plan.expected).toEqual(['릴리즈 노트'])
})
