import { expect, test } from 'claude-code/testing'
import type { Plan, PlanInput, PlanResult } from './plan'
import { MAX_NODES, addNodes, clearMarks, currentLeaf, emptyPlan, finishedAt, hasOpenWork, moveNode, nextStep, progress, removeNode, setPlan, updateNodes } from './plan'
import { setLanguage } from './i18n'

// The expectations below are written in Korean.
setLanguage('ko')

const ok = (r: PlanResult): Plan => {
  if ('error' in r) throw new Error(`expected a plan, got: ${r.error}`)

  return r.plan
}
const fails = (r: PlanResult): string => {
  if (!('error' in r)) throw new Error('expected an error')

  return r.error
}
const statusOf = (p: Plan, id: string): string | undefined => p.nodes.find(n => n.id === id)?.status
const running = (p: Plan): string[] =>
  p.nodes.filter(n => n.status === 'in_progress' && !p.nodes.some(c => c.parentId === n.id)).map(n => n.id)

// 1 research, 2 build (2.1 screen, 2.2 parallel group [API 2.2.1 with three checks, design 2.2.2
// with two], 2.3 session), 3 parallel [tests, docs], 4 ship.
const LOGIN: PlanInput[] = [
  { title: '조사' },
  {
    title: '구현',
    children: [
      { title: '로그인 화면' },
      {
        title: 'API와 디자인',
        parallel: true,
        children: [
          { title: 'API', children: [{ title: '주소 만들기' }, { title: '비밀번호 확인' }, { title: '에러 처리' }] },
          { title: '디자인 다듬기', children: [{ title: '색 맞추기' }, { title: '간격 정리' }] },
        ],
      },
      { title: '세션 저장' },
    ],
  },
  {
    title: '검증',
    parallel: true,
    children: [
      { title: '테스트', children: [{ title: '단위' }, { title: '통합' }, { title: '화면' }] },
      { title: '문서', children: [{ title: '사용법' }] },
    ],
  },
  { title: '배포', children: [{ title: '빌드' }, { title: '올리기' }] },
]

test('set hands out path ids in tree order and links parents', () => {
  const p = ok(setPlan(emptyPlan(), '로그인 기능 추가', LOGIN, 100))
  expect(p.title).toBe('로그인 기능 추가')
  expect(p.startedAt).toBe(100)
  expect(p.nodes.map(n => n.id).slice(0, 8)).toEqual(['1', '2', '2.1', '2.2', '2.2.1', '2.2.1.1', '2.2.1.2', '2.2.1.3'])
  expect(p.nodes.find(n => n.id === '2.2.1.1')?.parentId).toBe('2.2.1')
  expect(p.nodes.find(n => n.id === '2.2')?.parallel).toBe(true)
  expect(progress(p)).toEqual({ done: 0, total: 14 })
})

test('a parallel group is not a level: stage, task, checkpoint fit under it, a fourth level does not', () => {
  expect('plan' in setPlan(emptyPlan(), 'T', LOGIN, 0)).toBe(true)
  const tooDeep: PlanInput[] = [{ title: 'a', children: [{ title: 'b', children: [{ title: 'c', children: [{ title: 'd' }] }] }] }]
  expect(fails(setPlan(emptyPlan(), 'T', tooDeep, 0))).toContain('3 levels')
})

test('set refuses an empty title, no steps, a childless parallel node and more nodes than the cap', () => {
  expect(fails(setPlan(emptyPlan(), ' ', [{ title: 'a' }], 0))).toContain('title')
  expect(fails(setPlan(emptyPlan(), 'T', [], 0))).toContain('no steps')
  expect(fails(setPlan(emptyPlan(), 'T', [{ title: 'a', parallel: true }], 0))).toContain('parallel')
  const many = Array.from({ length: MAX_NODES + 1 }, (_, i) => ({ title: `s${i}` }))
  expect(fails(setPlan(emptyPlan(), 'T', many, 0))).toContain(`${MAX_NODES}`)
})

test('a parent takes its status from its children', () => {
  let p = ok(setPlan(emptyPlan(), 'T', LOGIN, 0))
  p = ok(updateNodes(p, [{ id: '2.1', status: 'completed' }], 10))
  expect(statusOf(p, '2')).toBe('in_progress')
  p = ok(updateNodes(p, [{ id: '1', status: 'blocked', note: '권한 없음' }], 11))
  expect(statusOf(p, '1')).toBe('blocked')
  p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a', children: [{ title: 'x' }, { title: 'y' }] }], 0))
  p = ok(updateNodes(p, [{ id: '1.1', status: 'completed' }, { id: '1.2', status: 'skipped' }], 5))
  expect(statusOf(p, '1')).toBe('completed')
  expect(statusOf(ok(updateNodes(p, [{ id: '1', status: 'in_progress' }], 6)), '1')).toBe('completed')
})

test('a task and its stage close on their own once every checkpoint under them is finished, and reopen with one', () => {
  const stage: PlanInput[] = [{ title: '수정 반영', children: [{ title: '리뷰 정리', children: [{ title: 'PR 머지' }, { title: '확인' }] }] }, { title: '배포' }]
  let p = ok(setPlan(emptyPlan(), 'T', stage, 0))
  p = ok(nextStep(p, undefined, 1))
  p = ok(nextStep(p, undefined, 2))
  p = ok(updateNodes(p, [{ id: '1.1.2', status: 'needs_check' }], 3))
  expect([statusOf(p, '1.1'), statusOf(p, '1')]).toEqual(['needs_check', 'needs_check'])
  p = ok(updateNodes(p, [{ id: '1.1.2', status: 'completed' }, { id: '2', status: 'skipped' }], 4))
  expect([statusOf(p, '1.1'), statusOf(p, '1')]).toEqual(['completed', 'completed'])
  expect(progress(p)).toEqual({ done: 3, total: 3 })
  expect(finishedAt(p)).toBe(4)
  p = ok(updateNodes(p, [{ id: '1.1.1', status: 'pending' }], 5))
  expect([statusOf(p, '1.1'), statusOf(p, '1')]).toEqual(['in_progress', 'in_progress'])
  expect(p.marks).toEqual({ '1.1.1': 'redo' })
  expect(finishedAt(p)).toBeNull()
})

test('updates stamp when a leaf starts and finishes, and parents span their children', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a', children: [{ title: 'x' }, { title: 'y' }] }], 0))
  p = ok(updateNodes(p, [{ id: '1.1', status: 'in_progress' }], 1000))
  p = ok(updateNodes(p, [{ id: '1.1', status: 'completed' }], 4000))
  p = ok(updateNodes(p, [{ id: '1.2', status: 'in_progress' }], 5000))
  p = ok(updateNodes(p, [{ id: '1.2', status: 'completed' }], 9000))
  const x = p.nodes.find(n => n.id === '1.1')
  const a = p.nodes.find(n => n.id === '1')
  expect([x?.startedAt, x?.doneAt]).toEqual([1000, 4000])
  expect([a?.startedAt, a?.doneAt]).toEqual([1000, 9000])
})

test('two leaves run together only under a parallel group', () => {
  const p = ok(setPlan(emptyPlan(), 'T', LOGIN, 0))
  expect(fails(updateNodes(p, [{ id: '1', status: 'in_progress' }, { id: '2.1', status: 'in_progress' }], 1))).toContain('parallel')
  const both = ok(updateNodes(p, [{ id: '2.2.1.1', status: 'in_progress' }, { id: '2.2.2.1', status: 'in_progress' }], 1))
  expect(running(both)).toEqual(['2.2.1.1', '2.2.2.1'])
})

test('unknown ids are refused with the valid ones listed, and nothing changes', () => {
  const p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a' }], 0))
  expect(fails(updateNodes(p, [{ id: '9', status: 'completed' }], 1))).toContain('valid ids: 1')
  expect(fails(removeNode(p, '9', 1))).toContain('valid ids: 1')
})

test('add appends under a parent and never reuses a removed id', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a', children: [{ title: 'x' }, { title: 'y' }] }], 0))
  p = ok(removeNode(p, '1.2', 1))
  p = ok(addNodes(p, '1', [{ title: 'z' }], 2))
  expect(p.nodes.map(n => n.id)).toEqual(['1', '1.1', '1.3'])
  p = ok(addNodes(p, null, [{ title: 'b' }], 3))
  expect(p.nodes.map(n => n.id)).toEqual(['1', '1.1', '1.3', '2'])
})

test('removing the last child turns its parent back into a pending leaf', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a', parallel: true, children: [{ title: 'x' }] }], 0))
  p = ok(updateNodes(p, [{ id: '1.1', status: 'completed' }], 1))
  p = ok(removeNode(p, '1.1', 2))
  const a = p.nodes.find(n => n.id === '1')
  expect(a?.status).toBe('pending')
  expect(a?.parallel).toBeUndefined()
})

test('next walks leaf to leaf across parents', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a', children: [{ title: 'x' }, { title: 'y' }] }, { title: 'b' }], 0))
  p = ok(nextStep(p, undefined, 1))
  expect(running(p)).toEqual(['1.1'])
  p = ok(nextStep(p, undefined, 2))
  expect([statusOf(p, '1.1'), running(p)]).toEqual(['completed', ['1.2']])
  p = ok(nextStep(p, undefined, 3))
  expect([statusOf(p, '1'), running(p)]).toEqual(['completed', ['2']])
  p = ok(nextStep(p, undefined, 4))
  expect(progress(p)).toEqual({ done: 3, total: 3 })
  expect(running(p)).toEqual([])
  expect(fails(nextStep(p, undefined, 5))).toContain('nothing left')
})

test('next into a parallel group starts every branch, and the step after waits for all of them', () => {
  let p = ok(setPlan(emptyPlan(), 'T', LOGIN, 0))
  p = ok(nextStep(p, undefined, 1)) // 1 starts
  p = ok(nextStep(p, undefined, 2)) // 1 done, 2.1 starts
  p = ok(nextStep(p, undefined, 3)) // 2.1 done, the group starts together
  expect(running(p)).toEqual(['2.2.1.1', '2.2.2.1'])
  // Finishing a branch's step moves that branch on, not the other.
  p = ok(nextStep(p, '2.2.2.1', 4))
  expect(running(p)).toEqual(['2.2.1.1', '2.2.2.2'])
  p = ok(nextStep(p, '2.2.2.2', 5))
  expect(running(p)).toEqual(['2.2.1.1'])
  // The design branch is done but API is not: 2.3 must wait.
  p = ok(nextStep(p, undefined, 6))
  p = ok(nextStep(p, undefined, 7))
  expect(running(p)).toEqual(['2.2.1.3'])
  p = ok(nextStep(p, undefined, 8))
  expect(running(p)).toEqual(['2.3'])
  // A top-level group: both stages start, ship waits for both.
  p = ok(nextStep(p, undefined, 9))
  expect(running(p)).toEqual(['3.1.1', '3.2.1'])
  p = ok(nextStep(p, '3.2.1', 10))
  expect(running(p)).toEqual(['3.1.1'])
  p = ok(nextStep(p, undefined, 11))
  p = ok(nextStep(p, undefined, 12))
  expect(running(p)).toEqual(['3.1.3'])
  p = ok(nextStep(p, undefined, 13))
  expect(running(p)).toEqual(['4.1'])
})

test('a waiting step the work went past is not started: the one after the finished step is, and none when nothing follows', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'PR', children: [{ title: '리뷰 지적 정리' }, { title: 'PR 머지' }] }, { title: '알리기' }], 0))
  p = ok(updateNodes(p, [{ id: '1.2', status: 'completed' }], 1))
  expect(currentLeaf(p)?.id).toBe('2')
  p = ok(nextStep(p, undefined, 2))
  expect(running(p)).toEqual(['2'])
  expect(statusOf(p, '1.1')).toBe('pending')
  // A whole task the work went past stays waiting too.
  let q = ok(setPlan(emptyPlan(), 'T', [{ title: 'a', children: [{ title: 'a1' }, { title: 'a2' }] }, { title: 'b', children: [{ title: 'b1' }] }], 0))
  q = ok(updateNodes(q, [{ id: '2.1', status: 'completed' }], 1))
  expect(fails(nextStep(q, undefined, 2))).toContain('nothing left')
  expect(statusOf(q, '1.1')).toBe('pending')
})

test('a done step keeps no note, whether the note came with the update that finished it or after', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a' }, { title: 'b' }], 0))
  p = ok(updateNodes(p, [{ id: '1', status: 'completed', note: '(긴 괄호 설명이 끝난 단계에 남는 경우)' }], 1))
  expect(p.nodes.find(n => n.id === '1')?.note).toBeUndefined()
  p = ok(updateNodes(p, [{ id: '1', note: '나중에 붙인 메모' }], 2))
  expect(p.nodes.find(n => n.id === '1')?.note).toBeUndefined()
  p = ok(updateNodes(p, [{ id: '2', status: 'skipped', note: '작업이 거치지 않음' }], 3))
  expect(p.nodes.find(n => n.id === '2')?.note).toBe('작업이 거치지 않음')
})

test('next with an id finishes that running leaf; a pending or unknown id is refused', () => {
  let p = ok(setPlan(emptyPlan(), 'T', LOGIN, 0))
  expect(fails(nextStep(p, '2.1', 1))).toContain('not in_progress')
  expect(fails(nextStep(p, '2', 1))).toContain('not in_progress')
  expect(fails(nextStep(p, '42', 1))).toContain('unknown')
  p = ok(nextStep(p, undefined, 1))
  expect(running(p)).toEqual(['1'])
})

test('resending set with the same title keeps finished leaves by title', () => {
  let p = ok(setPlan(emptyPlan(), '로그인 기능 추가', [{ title: '조사' }, { title: '구현' }, { title: '배포' }], 100))
  p = ok(nextStep(p, undefined, 200))
  p = ok(nextStep(p, undefined, 300))
  p = ok(updateNodes(p, [{ id: '3', status: 'skipped', note: '나중에' }], 400))
  const again = ok(setPlan(p, '로그인 기능 추가', [{ title: '조사' }, { title: '설계' }, { title: '구현' }, { title: '배포' }], 500))
  expect(again.nodes.map(n => `${n.title}:${n.status}`)).toEqual(['조사:completed', '설계:pending', '구현:pending', '배포:skipped'])
  expect(again.nodes[0]?.doneAt).toBe(300)
  expect(again.startedAt).toBe(100)
  // Another title is another plan: nothing carries over.
  const other = ok(setPlan(p, '다른 작업', [{ title: '조사' }], 600))
  expect([other.nodes[0]?.status, other.startedAt]).toEqual(['pending', 600])
})

test('the current leaf is the first running one, else the first pending one', () => {
  let p = ok(setPlan(emptyPlan(), 'T', LOGIN, 0))
  expect(currentLeaf(p)?.id).toBe('1')
  p = ok(updateNodes(p, [{ id: '2.2.1.2', status: 'in_progress' }], 1))
  expect(currentLeaf(p)?.id).toBe('2.2.1.2')
  expect(currentLeaf(emptyPlan())).toBeNull()
})

test('reopening finished work marks it redo, and pending on a parent reopens all of it', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a', children: [{ title: 'x' }, { title: 'y' }] }, { title: 'b' }], 0))
  p = ok(updateNodes(p, [{ id: '1.1', status: 'completed' }, { id: '1.2', status: 'completed' }], 5))
  const leaf = ok(updateNodes(p, [{ id: '1.2', status: 'pending', note: '형식 변경' }], 6))
  expect(statusOf(leaf, '1.2')).toBe('pending')
  expect(leaf.marks).toEqual({ '1.2': 'redo' })
  const whole = ok(updateNodes(p, [{ id: '1', status: 'pending' }], 6))
  expect(statusOf(whole, '1.1')).toBe('pending')
  expect(statusOf(whole, '1.2')).toBe('pending')
  expect(whole.marks).toEqual({ '1': 'redo' })
  expect(clearMarks(whole).marks).toBeUndefined()
})

test('a stage marked done or skipped closes every open step under it, keeps the finished ones, and the rest of the update applies', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a', children: [{ title: 'x' }, { title: 'y' }, { title: 'z' }] }, { title: 'b', children: [{ title: 'u' }, { title: 'v' }] }], 0))
  p = ok(updateNodes(p, [{ id: '1.2', status: 'skipped', note: '필요 없음' }], 1))
  p = ok(updateNodes(p, [{ id: '1', status: 'completed' }, { id: '2', status: 'skipped', note: '다른 PR이 대신함' }, { id: '1.1', title: '새 이름' }], 2))
  expect([statusOf(p, '1.1'), statusOf(p, '1.2'), statusOf(p, '1.3'), statusOf(p, '1')]).toEqual(['completed', 'skipped', 'completed', 'completed'])
  // A stage whose steps are all finished reads as done.
  expect([statusOf(p, '2.1'), statusOf(p, '2.2'), statusOf(p, '2')]).toEqual(['skipped', 'skipped', 'completed'])
  expect(p.nodes.find(n => n.id === '1.1')?.title).toBe('새 이름')
  // Running, blocked or waiting for a check is a step's own state: a stage keeps the one its steps give
  // it, and the rest of the update still applies.
  const q = ok(updateNodes(p, [{ id: '1', status: 'in_progress' }, { id: '1.3', title: '다른 이름' }], 3))
  expect(statusOf(q, '1')).toBe('completed')
  expect(q.nodes.find(n => n.id === '1.3')?.title).toBe('다른 이름')
})

test('a reopened step loses its redo mark once it is done again, by update or by next', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a', children: [{ title: 'x' }, { title: 'y' }] }, { title: 'b' }], 0))
  p = ok(updateNodes(p, [{ id: '1.1', status: 'needs_check' }], 1))
  p = ok(updateNodes(p, [{ id: '1.1', status: 'in_progress' }], 2))
  expect(p.marks).toEqual({ '1.1': 'redo' })
  expect(ok(updateNodes(p, [{ id: '1.1', status: 'completed' }], 3)).marks).toEqual({})
  expect(ok(nextStep(p, '1.1', 3)).marks).toEqual({})
  // A reopened parent keeps its mark while any step under it is open.
  let whole = ok(updateNodes(p, [{ id: '1.1', status: 'completed' }, { id: '1.2', status: 'completed' }], 3))
  whole = ok(updateNodes(whole, [{ id: '1', status: 'pending' }], 4))
  whole = ok(updateNodes(whole, [{ id: '1.1', status: 'completed' }], 5))
  expect(whole.marks).toEqual({ '1': 'redo' })
})

test('a step that is done drops the note it carried while it waited or was blocked', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a' }, { title: 'b' }], 0))
  p = ok(updateNodes(p, [{ id: '1', status: 'needs_check', note: '시안을 골라주세요' }, { id: '2', status: 'blocked', note: '권한 없음' }], 1))
  p = ok(updateNodes(p, [{ id: '1', status: 'completed' }], 2))
  expect(p.nodes.find(n => n.id === '1')?.note).toBeUndefined()
  expect(p.nodes.find(n => n.id === '2')?.note).toBe('권한 없음')
  p = ok(updateNodes(p, [{ id: '2', status: 'in_progress' }], 3))
  expect(ok(nextStep(p, '2', 4)).nodes.find(n => n.id === '2')?.note).toBeUndefined()
})

test('added steps go after what is already under their parent and are marked new', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a', children: [{ title: 'x' }] }, { title: 'b' }], 0))
  p = ok(addNodes(p, '1', [{ title: 'z', children: [{ title: 'z1' }] }], 1))
  expect(p.nodes.map(n => n.title)).toEqual(['a', 'x', 'z', 'z1', 'b'])
  expect(p.marks).toEqual({ '1.2': 'new' })
})

test('a running step that gains children hands its run to the first', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a' }, { title: 'b' }], 0))
  p = ok(nextStep(p, undefined, 100))
  p = ok(addNodes(p, '1', [{ title: 'a1' }, { title: 'a2' }], 200))
  expect(statusOf(p, '1.1')).toBe('in_progress')
  expect(statusOf(p, '1')).toBe('in_progress')
  expect(p.nodes.find(n => n.id === '1.1')?.startedAt).toBe(100)
})

test('a step moves among its siblings with everything under it', () => {
  let p = ok(setPlan(emptyPlan(), 'T', [{ title: 'a' }, { title: 'b', children: [{ title: 'b1' }] }, { title: 'c' }], 0))
  p = ok(moveNode(p, '2', '1', 1))
  expect(p.nodes.map(n => n.title)).toEqual(['b', 'b1', 'a', 'c'])
  p = ok(moveNode(p, '2', undefined, 2))
  expect(p.nodes.map(n => n.title)).toEqual(['a', 'c', 'b', 'b1'])
  expect(fails(moveNode(p, '2', '2.1', 3))).toContain('sibling')
})

test('a step waiting for the person to check counts as done, and the work moves on past it', () => {
  let p = ok(setPlan(emptyPlan(), '로그인', [{ title: '화면' }, { title: '저장' }], 0))
  p = ok(nextStep(p, undefined, 1))
  p = ok(updateNodes(p, [{ id: '1', status: 'needs_check', note: '폰에서 눌러 보기' }], 2))
  expect(progress(p)).toEqual({ done: 1, total: 2 })
  p = ok(nextStep(p, undefined, 3))
  expect(running(p)).toEqual(['2'])
  expect(currentLeaf(p)?.id).toBe('2')
})

test('a parent whose open work is only checks waits for them, and a plan left with only checks has no open work', () => {
  let p = ok(setPlan(emptyPlan(), '로그인', [{ title: '구현', children: [{ title: '화면' }, { title: 'API' }] }], 0))
  p = ok(updateNodes(p, [{ id: '1.1', status: 'needs_check' }, { id: '1.2', status: 'completed' }], 1))
  expect(statusOf(p, '1')).toBe('needs_check')
  expect(hasOpenWork(p)).toBe(false)
  p = ok(updateNodes(p, [{ id: '1.1', status: 'completed' }], 2))
  expect(statusOf(p, '1')).toBe('completed')
})

test('steps under a finished stage do not count toward the cap, so a long session keeps room', () => {
  const big = { title: '끝난 단계', children: Array.from({ length: MAX_NODES - 2 }, (_, i) => ({ title: `확인 ${i + 1}` })) }
  let p = ok(setPlan(emptyPlan(), '긴 세션', [big, { title: '다음' }], 0))
  p = ok(updateNodes(p, p.nodes.filter(n => n.parentId === '1').map(n => ({ id: n.id, status: 'completed' as const })), 1))
  p = ok(addNodes(p, null, Array.from({ length: 20 }, (_, i) => ({ title: `더 ${i + 1}` })), 2))
  expect(p.nodes.length).toBeGreaterThan(MAX_NODES)
  expect(fails(setPlan(emptyPlan(), '처음부터 큰 계획', Array.from({ length: MAX_NODES + 1 }, (_, i) => ({ title: `${i}` })), 0))).toContain(`at most ${MAX_NODES}`)
})

test('progress counts the steps only, never what is expected after them', () => {
  const p = { ...ok(setPlan(emptyPlan(), 'T', [{ title: 'a' }], 0)), expected: ['b'] }
  expect(progress(p)).toEqual({ done: 0, total: 1 })
})
